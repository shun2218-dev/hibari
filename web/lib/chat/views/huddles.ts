import type { HuddlePlaceOption } from "@/components/chat/huddle-list";
import type {
  HuddleHeaderState,
  HuddleLinkCardView,
  HuddleListItemView,
  HuddleOngoingCardView,
  HuddlePlaceView,
  HuddleSuggestionView,
  HuddleMessageView,
  HuddlePreviewView,
  HuddleScreenView,
  RoomKind,
  UserRef,
} from "@/components/chat/types";
import type { HuddleCallState } from "@/lib/chat/huddle/call";
import type { HuddleLink, HuddleSuggestion, MessageHuddle, PastHuddle, Room, RoomHuddle, UserProfile } from "@/lib/api/types.gen";
import { formatAgo } from "@/lib/chat/format/time";
import { findHuddleLinks } from "@/lib/chat/format/links";

import type { UrlTable } from "./message";

/**
 * 音声のハドル（ADR 0066）の表示用の変換。見る人で変わる見え方（参加中・不在着信・応答なし）は、ここで自分の ID から決める。
 * サーバーは見る人によらない値（始めた人・参加した人・終わった時刻）だけを返す（決定 12）。
 */

/** 自分の名前の代わりに出す言葉。 */
const ME = "あなた";

type Names = Readonly<Record<string, string | undefined>>;

/**
 * 参加した人の名前の並び（決定 12。オーナーの回答にある Slack の形）。
 * 自分がいれば先頭にし、名前は 2 人まで。それより多ければ「ほか N 人」。
 * 例: 「あなた」「あなた、佐藤 直樹」「あなた、佐藤 直樹、ほか 3 人」
 */
export function huddleParticipantNames(userIds: readonly string[], meId: string | undefined, names: Names): string {
  const ordered = meId !== undefined && userIds.includes(meId) ? [meId, ...userIds.filter((id) => id !== meId)] : [...userIds];
  const label = (id: string) => (id === meId ? ME : (names[id] ?? "メンバー"));
  const shown = ordered.slice(0, 2).map(label).join("、");
  const rest = ordered.length - 2;
  return rest > 0 ? `${shown}、ほか ${rest} 人` : shown;
}

/** 所要時間（「12 分」「1 時間 5 分」）。1 分に満たなければ「1 分未満」。 */
export function huddleDurationLabel(startedAt: string, endedAt: string): string {
  const minutes = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000);
  if (minutes < 1) return "1 分未満";
  if (minutes < 60) return `${minutes} 分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 時間` : `${h} 時間 ${m} 分`;
}

/**
 * 会話のハドルのメッセージの見え方（決定 12・追記 D）。
 * active は、ルームの進行中のハドル（activeHuddle）がこのメッセージのハドルなら、いま入っている人をそこから出す。
 * そうでなければ（ルームの状態をまだ読んでいない）、一度でも入った人で代える。
 */
export function toHuddleMessageView(
  message: { id: string; sender: UserProfile; huddle: MessageHuddle },
  {
    me,
    roomKind,
    activeHuddle,
    names,
    avatarUrls = {},
    timeLabel,
    thread,
  }: {
    me?: UserProfile;
    roomKind?: RoomKind;
    activeHuddle?: RoomHuddle | null;
    names: Names;
    avatarUrls?: UrlTable;
    timeLabel: string;
    thread?: HuddleMessageView["thread"];
  },
): HuddleMessageView {
  const { huddle, sender } = message;
  const withMe: Names = me ? { ...names, [me.id]: me.display_name, [sender.id]: sender.display_name } : { ...names, [sender.id]: sender.display_name };
  const ref = (id: string): UserRef => ({ id, name: withMe[id] ?? "メンバー", avatarUrl: avatarUrls[id] ?? undefined });
  const starter: UserRef = { id: sender.id, name: sender.display_name, avatarUrl: avatarUrls[sender.id] ?? undefined };
  const base = { key: message.id, starter, timeLabel, thread };

  if (huddle.ended_at === null) {
    const current =
      activeHuddle && activeHuddle.id === huddle.id ? activeHuddle.participants.map((p) => p.user_id) : huddle.participant_ids;
    const joined = me !== undefined && current.includes(me.id);
    const label = huddleParticipantNames(current, me?.id, withMe);
    return {
      ...base,
      state: "active",
      participants: current.map(ref),
      // 自分が入っていれば、部品が「参加中 · 」を前に付ける
      participantsLabel: current.length === 0 ? "" : joined ? label : `${label}が参加中`,
      joined,
    };
  }

  const ids = huddle.participant_ids;
  if (roomKind === "dm" && me !== undefined) {
    // DM で一度も入らなかった人には不在着信、始めた人（相手が入らなかった）には応答なし（決定 12）
    if (!ids.includes(me.id)) return { ...base, state: "missed", participants: ids.map(ref) };
    if (sender.id === me.id && ids.length === 1) return { ...base, state: "unanswered", participants: ids.map(ref) };
  }
  const label = huddleParticipantNames(ids, me?.id, withMe);
  return {
    ...base,
    state: "ended",
    participants: ids.map(ref),
    participantsLabel: ids.length === 1 ? `${label}が 1 人で参加しました` : `${label}が参加しました`,
    durationLabel: huddleDurationLabel(huddle.started_at, huddle.ended_at),
  };
}

/**
 * ハドルのメッセージの見出しと中身の文言（決定 12・追記 D）。会話の行（HuddleMessage）と「後で」の一覧の行（ADR 0067 決定 6）で同じものを使う。
 * 自分が入っているときの「参加中 · 」は、ここで前に付ける。
 */
export function huddleMessageTexts(view: HuddleMessageView): { title: string; detail: string } {
  switch (view.state) {
    case "active":
      return {
        title: "ハドルミーティング",
        detail: view.joined ? `参加中 · ${view.participantsLabel ?? ""}` : (view.participantsLabel ?? ""),
      };
    case "ended":
      return {
        title: "ハドルミーティングは終了しました",
        detail: [view.durationLabel, view.participantsLabel].filter(Boolean).join(" · "),
      };
    case "missed":
      return { title: "不在着信", detail: `${view.starter.name} さんからのハドルミーティング` };
    case "unanswered":
      return { title: "応答なし", detail: "相手は参加しませんでした" };
  }
}

/** ヘッダーのハドルのボタンの状態（決定 17・追記 C）。自分が（どの端末からでも）入っていれば joined。 */
export function huddleHeaderState(room: Room, meId: string, names: Names, avatarUrls: UrlTable = {}): HuddleHeaderState {
  const h = room.huddle;
  if (h === null || h.participants.length === 0) return { state: "idle" };
  if (h.participants.some((p) => p.user_id === meId)) return { state: "joined" };
  return {
    state: "active",
    participants: h.participants.map((p) => ({ id: p.user_id, name: names[p.user_id] ?? "メンバー", avatarUrl: avatarUrls[p.user_id] ?? undefined })),
  };
}

/** サイドバーの行のハドルの印（顔・ヘッドフォン・人数）。進行中でなければ undefined。 */
export function roomHuddleBadge(room: Room, names: Names, avatarUrls: UrlTable = {}): { participants: UserRef[] } | undefined {
  const h = room.huddle;
  if (h === null || h.participants.length === 0) return undefined;
  return {
    participants: h.participants.map((p) => ({ id: p.user_id, name: names[p.user_id] ?? "メンバー", avatarUrl: avatarUrls[p.user_id] ?? undefined })),
  };
}

type CallPhase<P extends HuddleCallState["phase"]> = Extract<HuddleCallState, { phase: P }>;

/** ハドルの画面のルームの表示（「#general」「佐藤 直樹」）。 */
function screenRoom(room: Room): HuddleScreenView["room"] {
  return { kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "") };
}

/** 参加する前のプレビュー（追記 B）。進行中のハドルに誰かいれば「参加する」、いなければ「開始する」。 */
export function toHuddlePreviewView(room: Room, call: CallPhase<"preview">, self: UserRef): HuddlePreviewView {
  return {
    room: screenRoom(room),
    action: room.huddle !== null && room.huddle.participants.length > 0 ? "join" : "start",
    self,
    micOn: call.micOn,
    mics: call.mics,
    micId: call.micId,
    speakers: call.speakers,
    speakerId: call.speakerId,
    problem: call.problem,
  };
}

/**
 * ハドルへのリンクから開いたが、そのままでは入れないときのプレビュー（ADR 0067 決定 1）。
 * マイクは求めない（入れないのに許可の確認を出さない）。参加していない public のチャンネルは「チャンネルに参加する」、
 * アーカイブしたチャンネルは開始を押せなくする。
 */
export function toBlockedHuddlePreviewView(room: Room, self: UserRef, blocked: NonNullable<HuddlePreviewView["blocked"]>): HuddlePreviewView {
  return {
    room: screenRoom(room),
    action: room.huddle !== null && room.huddle.participants.length > 0 ? "join" : "start",
    self,
    micOn: false,
    mics: [],
    blocked,
  };
}

/**
 * ハドルへのリンクを開いたとき、どうするか（ADR 0067 決定 1）。
 * - start: 投稿できる（入れる）。参加前のプレビューを出す（通話中なら、いまのハドルの画面を出す。いまの振る舞いのまま）
 * - not-member / archived: 入れない理由を出す
 * - ignore: それ以外（DM・private は読めればメンバー。読めないルームはルームの画面が「表示できません」を出す）
 */
export function huddleLinkAction(room: Room, canPostHere: boolean): "start" | "not-member" | "archived" | "ignore" {
  if (canPostHere) return "start";
  if (room.archived_at !== null) return "archived";
  if (room.kind === "public" && !room.is_member) return "not-member";
  return "ignore";
}

/**
 * ハドルの画面と帯（追記 C）。いま入っている人は、ルームのハドル（huddle.updated の全体）から出す。
 * 自分は先頭にし、自分のミュートは通話の値を使う（サーバーの往復を待たずに印を変える）。
 * 自分がまだ並んでいない（入る途中・huddle.updated が届く前）ときも、自分のタイルは出す。
 */
export function toHuddleScreenView(
  room: Room,
  call: CallPhase<"call">,
  { me, names, avatarUrls = {} }: { me: UserRef; names: Names; avatarUrls?: UrlTable },
): HuddleScreenView {
  const huddle = room.huddle !== null && (call.huddleId === undefined || room.huddle.id === call.huddleId) ? room.huddle : null;
  const ref = (id: string): UserRef =>
    id === me.id ? me : { id, name: names[id] ?? "メンバー", avatarUrl: avatarUrls[id] ?? undefined };
  const speaking = new Set(call.speaking);
  const others = (huddle?.participants ?? []).filter((p) => p.user_id !== me.id);
  return {
    room: screenRoom(room),
    connection: call.connection,
    participants: [
      { ...me, muted: call.muted, speaking: speaking.has(me.id) },
      ...others.map((p) => ({ ...ref(p.user_id), muted: p.muted, speaking: !p.muted && speaking.has(p.user_id) })),
    ],
    joiningSoon: (huddle?.joining_soon ?? []).filter((id) => id !== me.id).map(ref),
    muted: call.muted,
  };
}

// ---- ハドルへのリンクのカード（ADR 0067 決定 2） ----

/**
 * 画面に出すメッセージの本文から、ハドルへのリンクが指すルームを集める（重なりは 1 つに）。
 * 削除したメッセージの本文は空なので、自然に対象から外れる。
 */
export function huddleLinkRoomsIn(messages: readonly { body: string; deleted_at: string | null }[], origin: string): string[] {
  const found = new Set<string>();
  for (const m of messages) {
    if (m.deleted_at !== null) continue;
    for (const link of findHuddleLinks(m.body, origin)) found.add(link.roomId);
  }
  return [...found];
}

/**
 * ルームごとのカードの中身（キーはルームの ID）。
 * **手元のストアにあるルームは、ストアの生きた状態から作る**（huddle.updated が届く）。ないルームは、取った時点の結果から作る（決定 2）。
 * どちらもなければ、まだ取っていないので loading。
 */
export function huddleLinkCardTable(
  roomIds: readonly string[],
  {
    rooms,
    fetched,
    meId,
    huddlesEnabled,
    canJoin,
    currentWorkspaceId,
    workspaceNames = {},
    names,
    avatarUrls = {},
  }: {
    rooms: Readonly<Record<string, Room | undefined>>;
    fetched: Readonly<Record<string, HuddleLink | undefined>>;
    meId?: string;
    /** ハドルが使えない（サーバーに設定がない・WebRTC がない）ときは、ボタンを出さない。 */
    huddlesEnabled: boolean;
    /** ストアのルームに入れるか（投稿できるか。サーバーの authz と同じ条件の写し）。 */
    canJoin: (room: Room) => boolean;
    currentWorkspaceId?: string;
    workspaceNames?: Readonly<Record<string, string | undefined>>;
    names: Names;
    avatarUrls?: UrlTable;
  },
): Record<string, HuddleLinkCardView> {
  const ref = (id: string): UserRef => ({ id, name: names[id] ?? "メンバー", avatarUrl: avatarUrls[id] ?? undefined });
  const live = (h: RoomHuddle | null) =>
    h === null || h.participants.length === 0
      ? null
      : {
          participants: h.participants.map((p) => ref(p.user_id)),
          joined: meId !== undefined && h.participants.some((p) => p.user_id === meId),
        };
  const table: Record<string, HuddleLinkCardView> = {};
  for (const roomId of roomIds) {
    const room = rooms[roomId];
    const link = fetched[roomId];
    if (room) {
      table[roomId] = {
        key: roomId,
        state: "ok",
        room: screenRoom(room),
        ...(room.workspace_id !== currentWorkspaceId && workspaceNames[room.workspace_id]
          ? { workspaceName: workspaceNames[room.workspace_id] }
          : {}),
        huddle: live(room.huddle),
        canJoin: huddlesEnabled && canJoin(room),
      };
    } else if (link === undefined) {
      table[roomId] = { key: roomId, state: "loading" };
    } else if (link.status !== "ok" || !link.room) {
      table[roomId] = { key: roomId, state: "unavailable" };
    } else {
      table[roomId] = {
        key: roomId,
        state: "ok",
        room: { kind: link.room.kind, name: link.room.kind === "dm" ? (link.room.dm_peer?.display_name ?? "") : link.room.name },
        ...(link.workspace && link.workspace.id !== currentWorkspaceId ? { workspaceName: link.workspace.name } : {}),
        huddle: live(link.huddle),
        canJoin: huddlesEnabled && link.can_join,
      };
    }
  }
  return table;
}

/** 1 件のメッセージのハドルのリンクのカード。表からルームごとに引く（メッセージのリンクのカードと合わせて 3 枚まで）。 */
export function toHuddleLinkCardViews(
  body: string,
  origin: string,
  table: Readonly<Record<string, HuddleLinkCardView | undefined>>,
): HuddleLinkCardView[] | undefined {
  const links = findHuddleLinks(body, origin);
  if (links.length === 0) return undefined;
  return links.map((l) => table[l.roomId] ?? { key: l.roomId, state: "loading" });
}

// ---- ハドルの一覧（ADR 0067 決定 6・7） ----

/** 場所の見え方（チャンネルは名前、DM は相手の表示名）。 */
export function placeView(room: { kind: RoomKind; name: string | null; dm_peer?: { display_name: string } | null }): HuddlePlaceView {
  return { kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "") };
}

/** 始まってからの時間（Slack の「数秒」「12 分」）。 */
export function huddleElapsedLabel(startedAt: string, now: Date): string {
  if (now.getTime() - new Date(startedAt).getTime() < 60_000) return "数秒";
  return huddleDurationLabel(startedAt, now.toISOString());
}

/**
 * 一覧の上の進行中のハドルのカード（決定 6）。自分が入れる（canJoin）ルームの、いま誰かいるハドルだけ。
 * ストアのルームの状態（huddle.updated の全体）から作るので、サーバーに別の API はない。新しく始まった順。
 */
export function toHuddleOngoingCards(
  rooms: readonly Room[],
  { meId, names, avatarUrls = {}, now, canJoin }: { meId?: string; names: Names; avatarUrls?: UrlTable; now: Date; canJoin: (room: Room) => boolean },
): HuddleOngoingCardView[] {
  const ref = (id: string): UserRef => ({ id, name: names[id] ?? "メンバー", avatarUrl: avatarUrls[id] ?? undefined });
  return rooms
    .filter((r) => r.huddle !== null && r.huddle.participants.length > 0 && canJoin(r))
    .sort((a, b) => b.huddle!.started_at.localeCompare(a.huddle!.started_at))
    .map((r) => {
      const h = r.huddle!;
      return {
        key: r.id,
        room: placeView(r),
        elapsedLabel: huddleElapsedLabel(h.started_at, now),
        participants: h.participants.map((p) => ref(p.user_id)),
        joined: meId !== undefined && h.participants.some((p) => p.user_id === meId),
      };
    });
}

/** サイドバーの「ハドルミーティング」の行の顔（決定 6）。入れる進行中のハドルに入っている人（重なりは 1 人に）。 */
export function huddleNavFaces(
  rooms: readonly Room[],
  { names, avatarUrls = {}, canJoin }: { names: Names; avatarUrls?: UrlTable; canJoin: (room: Room) => boolean },
): UserRef[] {
  const seen = new Set<string>();
  const out: UserRef[] = [];
  for (const r of rooms) {
    if (!r.huddle || !canJoin(r)) continue;
    for (const p of r.huddle.participants) {
      if (seen.has(p.user_id)) continue;
      seen.add(p.user_id);
      out.push({ id: p.user_id, name: names[p.user_id] ?? "メンバー", avatarUrl: avatarUrls[p.user_id] ?? undefined });
    }
  }
  return out;
}

/** 「最近のハドルミーティング」の 1 行（決定 6）。参加した人は、自分がいれば先頭にする。 */
export function toHuddleListItemView(
  h: PastHuddle,
  {
    workspaceId,
    meId,
    names,
    avatarUrls = {},
    now,
    timeZone,
  }: { workspaceId: string; meId?: string; names: Names; avatarUrls?: UrlTable; now: Date; timeZone?: string },
): HuddleListItemView {
  const ids = meId !== undefined && h.participant_ids.includes(meId) ? [meId, ...h.participant_ids.filter((id) => id !== meId)] : h.participant_ids;
  const base = `/w/${workspaceId}/r/${h.room.id}`;
  return {
    key: h.id,
    // 行を押すと、会話のハドルのメッセージ（スレッドの親）へ飛ぶ（オーナーの確認。ADR 0042 の仕組み）
    href: `${base}?m=${h.message_id}`,
    threadHref: `${base}?t=${h.message_id}`,
    room: placeView(h.room),
    timeLabel: formatAgo(new Date(h.started_at), now, timeZone),
    durationLabel: huddleDurationLabel(h.started_at, h.ended_at),
    replyCount: h.reply_count,
    participants: ids.map((id) => ({ id, name: id === meId ? ME : (names[id] ?? "メンバー"), avatarUrl: avatarUrls[id] ?? undefined })),
    saved: h.saved,
  };
}

/** 提案のカード（決定 7）。 */
export function toHuddleSuggestionView(
  s: HuddleSuggestion,
  { names, avatarUrls = {} }: { names: Names; avatarUrls?: UrlTable },
): HuddleSuggestionView {
  return {
    key: s.room.id,
    room: placeView(s.room),
    count: s.count,
    participants: s.participant_ids.map((id) => ({ id, name: names[id] ?? "メンバー", avatarUrl: avatarUrls[id] ?? undefined })),
  };
}

/** 「場所」の絞り込みの候補。サイドバーのルーム（チャンネルと DM）から、打った文字で絞る。 */
export function toHuddlePlaceOptions(rooms: readonly Room[], query: string): HuddlePlaceOption[] {
  const q = query.trim().toLowerCase();
  return rooms
    .map((r) => ({ id: r.id, room: placeView(r) }))
    .filter((o) => q === "" || o.room.name.toLowerCase().includes(q));
}
