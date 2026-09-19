import type { LastMessage, Mention, Message, Room } from "@/lib/api/types.gen";

/**
 * この行がチャンネルのタイムラインに出るか（ADR 0039 の DB の `in_channel` と同じ意味）。
 *
 * チャンネルの投稿とシステムメッセージは常に出る。スレッドの返信は「チャンネルにも投稿する」を付けたものだけ。
 * タイムライン・未読・サイドバーの並びの判定をこの 1 つの関数にそろえ、条件が食い違わないようにする。
 */
export function inChannel(message: Pick<Message, "thread_root_id" | "also_in_channel">): boolean {
  return message.thread_root_id === null || message.also_in_channel;
}

/**
 * 手元のメッセージに、取得したメッセージを合わせる。
 *
 * - 並びは seq の昇順だけで決める（created_at を使わない。CLAUDE.md ルール 3）
 * - 同じメッセージが 2 回届いたら、change_seq の大きい方（新しい編集・削除を反映した方）を残す。
 *   REST のページと WebSocket のイベントが前後して届いても、古い内容で上書きしない
 *
 * 入力の配列は変更せず、新しい配列を返す（useSyncExternalStore のスナップショットとして比較できるように）。
 */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (!existing || existing.change_seq <= message.change_seq) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * 読み込んである範囲（いちばん古い seq から最新まで）にだけ合わせる。
 *
 * 差分の取得とイベントには、読み込んでいない古いメッセージの編集・削除も含まれる。それを足すと、手元の並びの途中に
 * 抜けができ、古いページの読み込み（before_seq = いちばん古い seq）がその抜けを飛ばしてしまう。
 * もっと古いメッセージがない（hasOlder が false）なら、全部が範囲に入る。
 */
export function mergeIntoWindow(
  current: readonly Message[],
  hasOlder: boolean,
  incoming: readonly Message[],
): Message[] {
  const oldest = current[0]?.seq;
  const inWindow = hasOlder && oldest !== undefined ? incoming.filter((m) => m.seq >= oldest) : incoming;
  return inWindow.length === 0 ? (current as Message[]) : mergeMessages(current, inWindow);
}

/**
 * 同期のカーソル（change_seq）を、手元にある連続した変更の分だけ進める。
 *
 * change_seq はルームの中で欠番なく振られ、1 つの番号は 1 つのメッセージにしか付かない（ADR 0014）。
 * カーソル + 1 の番号を持つメッセージが手元にあれば、その変更は反映済みなので進めてよい。
 * 順序が入れ替わって先に届いたイベントも、間が埋まった時点で数えられる。
 */
export function advanceCursor(cursor: number, messages: readonly Message[]): number {
  const changes = new Set(messages.map((m) => m.change_seq));
  let next = cursor;
  while (changes.has(next + 1)) next++;
  return next;
}

/**
 * 届いたメッセージを、ルームの一覧に出す情報（最後のメッセージ・未読数）に反映する。
 *
 * 未読数は last_user_seq - last_read_user_seq で求め直す（CLAUDE.md「未読数」、ADR 0033）。足し引きしないので、
 * 同じイベントが 2 回届いても（ADR 0016）数がずれない。自分の送信は、サーバーが自分の既読位置も進めている。
 * システムメッセージ（参加や名前の変更のログ）は user_seq を進めないので、未読数も増えない。
 * スレッドの返信はチャンネルに出ないので、最後のメッセージにも未読数にも並びにも影響しない（ADR 0036）。
 * ただし「チャンネルにも投稿する」を付けた返信は、チャンネルの発言として数える（ADR 0039）。サーバーが
 * user_seq を進めているので、ここはチャンネルの投稿と同じ計算に通すだけでよい。
 */
export function applyMessageToRoom(room: Room, message: Message, userId: string, created: boolean): Room {
  if (!inChannel(message)) return room;
  if (!created) {
    if (room.last_message?.id !== message.id) return room;
    // 最後のメッセージが削除された。ひとつ前のメッセージは手元にあるとは限らないので、いったん空にして取り直す（ADR 0038）
    if (message.deleted_at !== null) return { ...room, last_message: null };
    return { ...room, last_message: toLastMessage(message) };
  }
  if (message.seq <= room.last_message_seq) return room;

  const mine = message.sender.id === userId && message.kind === "user";
  const lastReadSeq = room.last_read_seq !== null && mine ? message.seq : room.last_read_seq;
  const lastReadUserSeq =
    room.last_read_user_seq !== null && mine ? message.user_seq : room.last_read_user_seq;
  return {
    ...room,
    last_message_seq: message.seq,
    last_user_seq: message.user_seq,
    last_message_at: message.created_at,
    last_message: toLastMessage(message),
    last_read_seq: lastReadSeq,
    last_read_user_seq: lastReadUserSeq,
    unread_count: lastReadUserSeq === null ? room.unread_count : message.user_seq - lastReadUserSeq,
    // メンションの数だけは求め直せない（本文を全部持っていないと数えられない）ので足す（ADR 0043）。
    // 上の seq の比較で、同じメッセージが 2 回届いてもここへは来ないので、二重に足さない。
    // スレッドだけの返信は上で弾かれるので、そこでのメンションは増えない。次の既読やルームの取り直しで揃う
    mention_count: !mine && mentionsUser(message.mentions, userId) ? room.mention_count + 1 : room.mention_count,
  };
}

/** 自分宛てか。`@channel` / `@here` も自分宛てに数える（ADR 0041）。 */
function mentionsUser(mentions: readonly Mention[], userId: string): boolean {
  return mentions.some((m) => (m.kind === "user" ? m.user?.id === userId : true));
}

function toLastMessage(message: Message): LastMessage {
  return {
    id: message.id,
    sender: message.sender,
    kind: message.kind,
    system: message.system,
    body: message.body,
    created_at: message.created_at,
    deleted: message.deleted_at !== null,
  };
}

/** 既読位置を進める。後退させず、未読数は手元の最新の seq から求め直す（既読の応答とメッセージのイベントが前後しても揃う）。 */
export function applyReadToRoom(
  room: Room,
  read: { lastReadSeq: number; lastReadUserSeq: number; mentionCount: number },
): Room {
  if (room.last_read_seq === null || room.last_read_user_seq === null) return room;
  const next = Math.max(room.last_read_seq, read.lastReadSeq);
  const nextUser = Math.max(room.last_read_user_seq, read.lastReadUserSeq);
  // 未読はシステムメッセージを数えない（ADR 0033）
  const unread = Math.max(0, room.last_user_seq - nextUser);
  // メンションの数は手元では数え直せない（どのメッセージが自分宛てかは本文を全部持っていないと分からない）ので、
  // サーバーが既読の応答とイベントに載せてくる値をそのまま使う（ADR 0043）。
  // 既読が進まなかった応答（自分より古い seq）では、件数も古い可能性があるので触らない
  const advanced = next > room.last_read_seq || nextUser > room.last_read_user_seq;
  const mention = advanced ? read.mentionCount : room.mention_count;
  if (
    next === room.last_read_seq &&
    nextUser === room.last_read_user_seq &&
    unread === room.unread_count &&
    mention === room.mention_count
  ) {
    return room;
  }
  return { ...room, last_read_seq: next, last_read_user_seq: nextUser, unread_count: unread, mention_count: mention };
}

/**
 * ルームの ID の並びに 1 件足す。API と同じく、最後のメッセージが新しい順（ないものは末尾）に入れる。
 */
export function insertByActivity(ids: readonly string[], room: Room, rooms: Record<string, Room | undefined>): string[] {
  const without = ids.filter((id) => id !== room.id);
  const at = room.last_message_at === null ? null : Date.parse(room.last_message_at);
  // 時刻の文字列は小数秒の桁が揃わないことがあるので、文字列ではなく時刻で比べる
  const index =
    at === null ? -1 : without.findIndex((id) => Date.parse(rooms[id]?.last_message_at ?? "1970-01-01T00:00:00Z") < at);
  return index === -1 ? [...without, room.id] : [...without.slice(0, index), room.id, ...without.slice(index)];
}

/**
 * チャンネルのタイムラインに出る、いちばん新しいメッセージの seq。手元のメッセージにはスレッドの返信も入っている
 * （change_seq のカーソルを進めるため）が、既読や「ここから未読」はチャンネルに出ているものだけで決める（ADR 0036 / 0039）。
 */
export function newestChannelSeq(messages: readonly Message[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (inChannel(messages[i]!)) return messages[i]!.seq;
  }
  return undefined;
}
