import type {
  AttachmentDraftView,
  MessageAttachmentView,
  MessageLinkCardView,
  MessageView,
  RoleLabel,
  RoomKind,
  RoomMemberView,
  RoomSummaryView,
  ThreadListItemView,
  TimelineItem,
} from "@/components/chat/types";
import type { DmCandidateView, RoomMemberRowView } from "@/components/chat/room-dialogs";
import type {
  FollowedThread,
  Member,
  Message,
  MessageAttachment,
  MessageLink,
  Role,
  Room,
  RoomMember,
  UserProfile,
} from "@/lib/api/types.gen";

import type { OutgoingMessage, ThreadState } from "./store";
import type { AttachmentDraft } from "./uploads";

import { dayKey, formatBytes, formatDate, formatListTime, formatTime } from "./format";
import { type Permalink, buildPermalink, clampCardBody, findPermalinks, linkKey } from "./links";
import { inChannel } from "./messages";

/**
 * API のレスポンスを、presentational コンポーネントの表示用の型に変える（ADR 0018）。
 * どれも純粋な関数にして、時刻の文言はタイムゾーンを引数で固定してテストする。
 */

/**
 * システムメッセージの文言（ADR 0033）。サーバーは種類と、そのときの名前だけを返す（`body` は空）。
 * 主語は sender（参加した人、名前を変えた人）。
 */
export function systemMessageText(message: Pick<Message, "sender" | "system">): string {
  const name = message.sender.display_name;
  switch (message.system?.type) {
    case "room_created":
      return `${name} がこのチャンネルを作成しました`;
    case "member_joined":
      return `${name} がチャンネルに参加しました`;
    case "member_left":
      return `${name} がチャンネルを退出しました`;
    case "member_removed":
      return `${name} がチャンネルから外されました`;
    case "room_renamed":
      return `${name} がチャンネル名を ${message.system.old_name} から ${message.system.new_name} に変更しました`;
    default:
      // 知らない種類（サーバーが先に増えた）。行を落とすより、何かが起きたことだけ出す
      return `${name} がチャンネルを更新しました`;
  }
}

/** 削除済みのメッセージの本文の代わり。タイムラインの表示（MessageItem）と同じ文言にする。 */
export const DELETED_MESSAGE_TEXT = "このメッセージは削除されました";

/**
 * 添付だけのメッセージ（本文が空）の、サイドバーでの 1 行。表示はデザインにない（docs/ui/README.md の未解決）ので仮の文言。
 * ルーム一覧の last_message には添付の情報がないので、ファイル名は出せない。
 */
export const ATTACHMENT_ONLY_TEXT = "添付ファイル";

/**
 * 「チャンネルにも投稿する」まわりの文言（ADR 0039、docs/ui/README.md）。DM には「チャンネル」がないので言い換える。
 * チャンネルの行の「スレッドに返信しました」だけは、どのルームでも同じなのでコンポーネント側に置いてある。
 */
export function alsoInChannelLabel(kind: RoomKind): string {
  return kind === "dm" ? "DM にも投稿する" : "チャンネルにも投稿する";
}

export function alsoInChannelDoneLabel(kind: RoomKind): string {
  return kind === "dm" ? "DM にも投稿しました" : "チャンネルにも投稿しました";
}

/** 署名付き URL の手元の表（media.ts）。undefined と null は、どちらも画像を出さない。 */
export type UrlTable = Readonly<Record<string, string | null | undefined>>;

/** 続けて表示する（アバターと名前を省く）のは、同じ送信者がこの時間内に送ったときだけ。 */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/** ルームの表示名。DM に名前はないので、相手の表示名にする。 */
export function roomName(room: Room): string {
  return room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "");
}

export function toRoomSummaryView(
  room: Room,
  now: Date,
  { timeZone, avatarUrls = {} }: { timeZone?: string; avatarUrls?: UrlTable } = {},
): RoomSummaryView {
  const last = room.last_message;
  let lastMessage: string | undefined;
  if (last?.kind === "system") {
    // ログは文そのものが「誰が何をした」なので、送信者を前に付けない（ADR 0033）
    lastMessage = systemMessageText(last);
  } else if (last) {
    const body = last.deleted ? DELETED_MESSAGE_TEXT : last.body === "" ? ATTACHMENT_ONLY_TEXT : last.body;
    // DM は相手と自分しかいないので送信者を省く（sidebar のデザイン）
    lastMessage = room.kind === "dm" ? body : `${last.sender.display_name}: ${body}`;
  }
  return {
    id: room.id,
    kind: room.kind,
    name: roomName(room),
    peer: room.dm_peer
      ? { id: room.dm_peer.id, online: room.dm_peer.online, avatarUrl: avatarUrls[room.dm_peer.id] ?? undefined }
      : undefined,
    lastMessage,
    timeLabel: room.last_message_at ? formatListTime(new Date(room.last_message_at), now, timeZone) : undefined,
    unreadCount: room.unread_count,
    mentionCount: room.mention_count,
  };
}

type TimelineOptions = {
  /**
   * ルームを開いた時点の last_read_seq。これより大きい seq の最初のメッセージの前に「ここから未読」を入れる。
   * null なら入れない（メンバーではない、または区切りを消した）。
   */
  unreadAfterSeq: number | null;
  /** 確定していない自分のメッセージ。確定したメッセージの後ろに、送った順で並べる（まだ seq がない）。 */
  outgoing?: readonly OutgoingMessage[];
  /** 自分。outgoing の送信者として出す。 */
  me?: UserProfile;
  /** user_id → アバターの URL。 */
  avatarUrls?: UrlTable;
  /** attachment_id → 画像の URL。 */
  attachmentUrls?: UrlTable;
  /** 本文に貼られたパーマリンクのカードの中身（ADR 0040）。linkKey → 取得結果。 */
  linkCards?: Record<string, MessageLink | undefined>;
  /** パーマリンクを見分けるためのこの画面のオリジン。省くとカードを出さない（サーバー側の描画では window がない）。 */
  origin?: string;
  /** 今いるワークスペース。カードのワークスペース名は、これと違うときだけ出す。 */
  currentWorkspaceId?: string;
  timeZone?: string;
  /** 「最終返信」の相対的な時刻（「昨日」など）の基準。省けば今。 */
  now?: Date;
  /**
   * スレッドの返信を並べるときの親の ID（ADR 0036）。渡すと messages をそのまま並べ、outgoing はそのスレッドへの返信だけにする。
   * 省くとチャンネルのタイムラインで、「チャンネルにも投稿する」を付けていない返信を除く（ADR 0039）。
   */
  threadRootId?: string;
  /**
   * スレッドのパネルで、流した返信に添える注記（alsoInChannelDoneLabel）。ルームの種類で文言が変わるので受け取る。
   * 省くと注記を出さない。チャンネルのタイムラインでは使わない。
   */
  broadcastDoneLabel?: string;
};

/** タイムラインに並べる 1 件。確定したメッセージと、確定していない自分のメッセージを同じ形にそろえる。 */
type Entry = {
  key: string;
  seq: number | null;
  /** システムメッセージ（ADR 0033）なら、その文言。人の発言では undefined。 */
  systemText?: string;
  sender: UserProfile;
  createdAt: Date;
  body: string;
  status: "pending" | "sent" | "failed";
  deleted: boolean;
  edited: boolean;
  /** 返信のついた親の「N 件の返信」。返信が全部消えていれば出さない。 */
  thread: { replyCount: number; lastReplyAt: Date } | undefined;
  /** 「チャンネルにも投稿する」を付けた返信の見え方（ADR 0039）。並べる場所で変わる。 */
  broadcast: MessageView["broadcast"];
  attachments: readonly MessageAttachment[];
};

/**
 * 流した返信（ADR 0039）の見え方。チャンネルでは押せるラベル、スレッドのパネルでは本文の下の注記にする。
 * 注記の文言はルームの種類で変わるので、渡されていなければスレッドでは何も添えない。
 */
function broadcastView(
  isBroadcastReply: boolean,
  inThread: boolean,
  doneLabel: string | undefined,
): MessageView["broadcast"] {
  if (!isBroadcastReply) return undefined;
  if (!inThread) return { in: "channel" };
  return doneLabel === undefined ? undefined : { in: "thread", label: doneLabel };
}

function fromMessage(message: Message, broadcast: MessageView["broadcast"]): Entry {
  return {
    key: message.id,
    seq: message.seq,
    systemText: message.kind === "system" ? systemMessageText(message) : undefined,
    sender: message.sender,
    createdAt: new Date(message.created_at),
    body: message.body,
    // REST と WebSocket で届いたメッセージは seq が採番済み
    status: "sent",
    deleted: message.deleted_at !== null,
    edited: message.edited_at !== null,
    thread:
      message.thread && message.thread.reply_count > 0
        ? { replyCount: message.thread.reply_count, lastReplyAt: new Date(message.thread.last_reply_at) }
        : undefined,
    broadcast,
    attachments: message.attachments,
  };
}

function fromOutgoing(message: OutgoingMessage, me: UserProfile, broadcast: MessageView["broadcast"]): Entry {
  return {
    // 確定すると key がメッセージの ID に変わる。確定したメッセージと送信中のメッセージの key は重ならない
    key: message.clientMsgId,
    seq: null,
    sender: me,
    createdAt: new Date(message.createdAt),
    body: message.body,
    status: message.status,
    deleted: false,
    edited: false,
    thread: undefined,
    broadcast,
    attachments: message.attachments,
  };
}

/**
 * seq の昇順に並んだメッセージから、日付と未読の区切りを挟んだタイムラインを作る。
 * 確定していない自分のメッセージは、その後ろに送った順で並べる。
 */
export function toTimelineItems(
  messages: readonly Message[],
  {
    unreadAfterSeq,
    outgoing = [],
    me,
    avatarUrls = {},
    attachmentUrls = {},
    linkCards = {},
    origin,
    currentWorkspaceId,
    timeZone,
    now = new Date(),
    threadRootId,
    broadcastDoneLabel,
  }: TimelineOptions,
): TimelineItem[] {
  const inThread = threadRootId !== undefined;
  // チャンネルのタイムラインに出すのは、チャンネルの投稿と、「チャンネルにも投稿する」を付けた返信だけ（ADR 0036 / 0039）。
  // 出さない返信も手元には持っておく（change_seq のカーソルを進めるため）
  // 削除したメッセージも出さない（ADR 0038）。返信の残っているスレッドの親だけは、返信の置き場所として「削除されました」を残す
  const shown = messages.filter(
    (m) =>
      (inThread || inChannel(m)) &&
      (m.deleted_at === null || m.id === threadRootId || (m.thread?.reply_count ?? 0) > 0),
  );
  const entries = shown.map((m) =>
    fromMessage(m, broadcastView(m.thread_root_id !== null && m.also_in_channel, inThread, broadcastDoneLabel)),
  );
  if (me) {
    // 送信中の返信も、確定した後と同じ場所に出す。チェックを付けた返信はスレッドとチャンネルの両方に並ぶ
    const mine = inThread
      ? outgoing.filter((m) => m.threadRootId === threadRootId)
      : outgoing.filter((m) => m.threadRootId === null || m.alsoInChannel);
    entries.push(
      ...mine.map((m) =>
        fromOutgoing(m, me, broadcastView(m.threadRootId !== null && m.alsoInChannel, inThread, broadcastDoneLabel)),
      ),
    );
  }

  const items: TimelineItem[] = [];
  let previous: Entry | undefined;
  let previousDay: string | undefined;
  let unreadInserted = unreadAfterSeq === null;

  for (const entry of entries) {
    const day = dayKey(entry.createdAt, timeZone);
    let breakGroup = false;

    if (day !== previousDay) {
      items.push({ type: "date", key: `date-${day}`, label: formatDate(entry.createdAt, timeZone) });
      previousDay = day;
      breakGroup = true;
    }
    // 自分の送信中のメッセージは未読にならない。システムメッセージも未読に数えない（ADR 0033）ので、
    // 区切りは「未読の人の発言」の前に出す
    if (!unreadInserted && entry.seq !== null && entry.systemText === undefined && entry.seq > unreadAfterSeq!) {
      items.push({ type: "unread", key: "unread" });
      unreadInserted = true;
      breakGroup = true;
    }
    // 流した返信は、直前が同じ人の発言でも続けて表示にしない。スレッドから来た行だと分かるようにするため（docs/ui/README.md）
    if (entry.broadcast?.in === "channel") breakGroup = true;

    if (entry.systemText !== undefined) {
      // ログは人の発言ではないので、続けて表示（grouped）の基準にもしない
      items.push({
        type: "system",
        key: entry.key,
        text: entry.systemText,
        timeLabel: formatTime(entry.createdAt, timeZone),
      });
      previous = undefined;
      continue;
    }

    const grouped =
      !breakGroup &&
      previous !== undefined &&
      previous.sender.id === entry.sender.id &&
      entry.createdAt.getTime() - previous.createdAt.getTime() < GROUPING_WINDOW_MS;

    items.push({
      type: "message",
      message: {
        key: entry.key,
        sender: {
          id: entry.sender.id,
          name: entry.sender.display_name,
          avatarUrl: avatarUrls[entry.sender.id] ?? undefined,
        },
        timeLabel: formatTime(entry.createdAt, timeZone),
        body: entry.body,
        status: entry.status,
        deleted: entry.deleted,
        edited: entry.edited,
        thread: entry.thread
          ? { replyCount: entry.thread.replyCount, lastReplyLabel: formatListTime(entry.thread.lastReplyAt, now, timeZone) }
          : undefined,
        broadcast: entry.broadcast,
        attachments: entry.attachments.map((a) => toAttachmentView(a, attachmentUrls)),
        linkCards: origin === undefined ? undefined : toLinkCardViews(entry.body, { origin, linkCards, currentWorkspaceId, avatarUrls, timeZone }),
        grouped,
      },
    });
    // 流した返信の次の発言も続けて表示にしない（同じ人でも、スレッドの返信の続きに見えてしまうため）
    previous = entry.broadcast?.in === "channel" ? undefined : entry;
  }
  return items;
}

/**
 * ブラウザが inline で返す画像（ADR 0013）。それ以外の image/*（SVG など）はダウンロードさせるので、ファイルとして出す。
 */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isPreviewImage(attachment: Pick<MessageAttachment, "content_type">): boolean {
  return INLINE_IMAGE_TYPES.has(attachment.content_type);
}

/**
 * スレッドのパネルの並び（ADR 0036）: 親、「N 件の返信」の区切り、返信（送信中の自分の返信を含む）。
 * 親の下の「N 件の返信」はパネルの中では区切りと同じことを言うので出さない。日付の区切りも入れない（デザインにない）。
 */
export function toThreadTimelineItems(
  thread: Pick<ThreadState, "root" | "replies">,
  options: Omit<TimelineOptions, "unreadAfterSeq" | "threadRootId">,
): TimelineItem[] {
  const root = thread.root;
  if (!root) return [];
  const rootItems = toTimelineItems([root], { ...options, unreadAfterSeq: null, outgoing: [], threadRootId: root.id });
  const replyItems = toTimelineItems(thread.replies, { ...options, unreadAfterSeq: null, threadRootId: root.id });
  const items: TimelineItem[] = [];
  for (const item of rootItems) {
    if (item.type === "message") items.push({ type: "message", message: { ...item.message, thread: undefined } });
  }
  items.push({ type: "thread-divider", key: `thread-divider-${root.id}`, replyCount: root.thread?.reply_count ?? 0 });
  for (const item of replyItems) if (item.type !== "date") items.push(item);
  return items;
}

/** 参加しているスレッドの一覧の 1 行（ADR 0036）。 */
export function toThreadListItemView(
  thread: FollowedThread,
  now: Date,
  { timeZone, avatarUrls = {} }: { timeZone?: string; avatarUrls?: UrlTable } = {},
): ThreadListItemView {
  const { room, root } = thread;
  return {
    key: root.id,
    room: { kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "") },
    root: {
      sender: { id: root.sender.id, name: root.sender.display_name, avatarUrl: avatarUrls[root.sender.id] ?? undefined },
      timeLabel: formatListTime(new Date(root.created_at), now, timeZone),
      body: root.body,
      deleted: root.deleted,
    },
    replyCount: thread.reply_count,
    lastReplyLabel: formatListTime(new Date(thread.last_reply_at), now, timeZone),
    unreadCount: thread.unread_count,
  };
}

/**
 * 画面に出している（削除されていない）メッセージの、プレビューする画像の ID。GET URL を取る対象（media.ts）。
 * 送信中のメッセージの添付はまだメッセージに付いていない（URL が 404 になる）ので含めない。
 */
export function previewImageIds(messages: readonly Message[]): string[] {
  return messages.flatMap((m) =>
    m.deleted_at === null ? m.attachments.filter(isPreviewImage).map((a) => a.id) : [],
  );
}

/**
 * 画面に出すメッセージの本文から、パーマリンクを集める（ADR 0040）。
 * 削除したメッセージの本文は空なので、自然に対象から外れる。
 */
export function permalinksIn(messages: readonly Message[], origin: string): Permalink[] {
  const found = new Map<string, Permalink>();
  for (const m of messages) {
    if (m.deleted_at !== null) continue;
    for (const link of findPermalinks(m.body, origin)) found.set(linkKey(link), link);
  }
  return [...found.values()];
}

/**
 * 本文に貼られたパーマリンクを、カードの表示用の型に変える（ADR 0040）。
 *
 * まだ取れていないリンクは loading。読めない・存在しない・**削除済み**はすべて unavailable にする
 * （削除は跡も残さず消える。ADR 0038。オーナーの確認: 2026-09-19）。
 */
function toLinkCardViews(
  body: string,
  {
    origin,
    linkCards,
    currentWorkspaceId,
    avatarUrls,
    timeZone,
  }: {
    origin: string;
    linkCards: Record<string, MessageLink | undefined>;
    currentWorkspaceId?: string;
    avatarUrls: UrlTable;
    timeZone?: string;
  },
): MessageLinkCardView[] | undefined {
  const links = findPermalinks(body, origin);
  if (links.length === 0) return undefined;

  return links.map((link): MessageLinkCardView => {
    const key = linkKey(link);
    const card = linkCards[key];
    if (card === undefined) return { key, state: "loading" };
    // 削除済みも読めないリンクと同じ見え方にする（ADR 0040）。
    if (card.status !== "ok" || !card.message || !card.room || card.message.deleted_at !== null) {
      return { key, state: "unavailable" };
    }
    const { message, room, workspace } = card;
    const clamped = clampCardBody(message.body);
    return {
      key,
      state: "ok",
      href: buildPermalink(origin, {
        workspaceId: workspace?.id ?? link.workspaceId,
        roomId: room.id,
        messageId: message.id,
        ...(message.thread_root_id !== null ? { threadRootId: message.thread_root_id } : {}),
      }),
      // 同じワークスペースならいつも同じ名前が並ぶだけなので出さない。
      ...(workspace && workspace.id !== currentWorkspaceId ? { workspaceName: workspace.name } : {}),
      // dm にはルーム名がないので、相手の名前を出す（サイドバーと同じ扱い）。
      room: { kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "ダイレクトメッセージ") : room.name },
      sender: {
        id: message.sender.id,
        name: message.sender.display_name,
        avatarUrl: avatarUrls[message.sender.id] ?? undefined,
      },
      timeLabel: formatTime(new Date(message.created_at), timeZone),
      body: message.body,
      clampedBody: clamped.text,
      clamped: clamped.clamped,
      attachmentCount: message.attachment_count,
      inThread: message.thread_root_id !== null,
    };
  });
}

function toAttachmentView(attachment: MessageAttachment, urls: UrlTable): MessageAttachmentView {
  if (isPreviewImage(attachment)) {
    return {
      kind: "image",
      id: attachment.id,
      fileName: attachment.file_name,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      url: urls[attachment.id] ?? undefined,
    };
  }
  return { kind: "file", id: attachment.id, fileName: attachment.file_name, sizeLabel: formatBytes(attachment.size_bytes) };
}

const roleRanks: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

/**
 * メッセージの「…」に出す操作（ADR 0012 の authz.CanEditMessage / CanDeleteMessage と同じ規則）。
 *
 * 判定の正はサーバーで、ここは出すかどうかを決めるだけ。送信者のロールは、手元にメンバー一覧があって
 * そこにいるときだけ分かる。分からなければ admin 以上には出し、拒否されたらサーバーに従う（ADR 0027）。
 */
export function messageActions(
  message: Message,
  { userId, room, myRole, senderRole }: { userId: string; room: Room; myRole: Role | undefined; senderRole: Role | undefined },
): { canEdit: boolean; canDelete: boolean } {
  if (message.deleted_at !== null) return { canEdit: false, canDelete: false };
  // 投稿できるのはルームのメンバーだけ（参加していない public は読めるだけ）
  if (message.sender.id === userId) return { canEdit: room.is_member, canDelete: room.is_member };
  const canModerate =
    room.kind !== "dm" &&
    myRole !== undefined &&
    roleRanks[myRole] >= roleRanks.admin &&
    (senderRole === undefined || roleRanks[myRole] > roleRanks[senderRole]);
  return { canEdit: false, canDelete: canModerate };
}

const roleLabels: Record<Role, RoleLabel> = { owner: "オーナー", admin: "管理者", member: "メンバー" };

export function toRoomMemberView(member: RoomMember, avatarUrls: UrlTable = {}): RoomMemberView {
  return {
    id: member.user.id,
    name: member.user.display_name,
    avatarUrl: avatarUrls[member.user.id] ?? undefined,
    online: member.online,
    roleLabel: roleLabels[member.role],
  };
}

/**
 * DM の相手や、非公開チャンネルに追加する人の候補。自分と、除きたい人（すでにチャンネルにいる人）を外し、
 * 表示名かハンドルで絞り込む。presence はワークスペースのメンバー一覧が返す（ADR 0015）。
 */
export function toDmCandidates(
  members: readonly Member[],
  { userId, search = "", exclude = [] }: { userId: string; search?: string; exclude?: readonly string[] },
): DmCandidateView[] {
  const query = search.trim().toLowerCase();
  const excluded = new Set([userId, ...exclude]);
  return members
    .filter((m) => !excluded.has(m.user.id))
    .filter(
      (m) =>
        query === "" ||
        m.user.display_name.toLowerCase().includes(query) ||
        m.user.handle.toLowerCase().includes(query),
    )
    .map((m) => ({ id: m.user.id, name: m.user.display_name, handle: m.user.handle, online: m.online }));
}

/** チャンネルの設定に並べる、いま参加している人。外せるかはサーバーと同じ規則で決める（ADR 0011）。 */
export function toRoomMemberRows(
  members: readonly RoomMember[],
  { userId, myRole, avatarUrls = {} }: { userId: string; myRole: Role | undefined; avatarUrls?: UrlTable },
): RoomMemberRowView[] {
  return members.map((member) => ({
    id: member.user.id,
    name: member.user.display_name,
    avatarUrl: avatarUrls[member.user.id] ?? undefined,
    isSelf: member.user.id === userId,
    // 外せるのは、自分より下のロールの人だけ（authz.CanRemoveRoomMember）
    canRemove:
      member.user.id !== userId && myRole !== undefined && roleRanks[myRole] > roleRanks[member.role],
  }));
}

/** 入力欄に並べる添付。 */
export function toAttachmentDraftView(draft: AttachmentDraft): AttachmentDraftView {
  switch (draft.status) {
    case "uploading":
      return { id: draft.key, fileName: draft.fileName, status: "uploading", progress: draft.progress };
    case "failed":
      return { id: draft.key, fileName: draft.fileName, status: "failed" };
    case "uploaded":
      return { id: draft.key, fileName: draft.fileName, status: "uploaded", sizeLabel: formatBytes(draft.file.size) };
  }
}
