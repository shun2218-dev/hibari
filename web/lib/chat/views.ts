import type {
  AttachmentDraftView,
  MessageAttachmentView,
  RoleLabel,
  RoomMemberView,
  RoomSummaryView,
  TimelineItem,
} from "@/components/chat/types";
import type { Message, MessageAttachment, Role, Room, RoomMember, UserProfile } from "@/lib/api/types.gen";

import type { OutgoingMessage } from "./store";
import type { AttachmentDraft } from "./uploads";

import { dayKey, formatBytes, formatDate, formatListTime, formatTime } from "./format";

/**
 * API のレスポンスを、presentational コンポーネントの表示用の型に変える（ADR 0018）。
 * どれも純粋な関数にして、時刻の文言はタイムゾーンを引数で固定してテストする。
 */

/** 削除済みのメッセージの本文の代わり。タイムラインの表示（MessageItem）と同じ文言にする。 */
export const DELETED_MESSAGE_TEXT = "このメッセージは削除されました";

/**
 * 添付だけのメッセージ（本文が空）の、サイドバーでの 1 行。表示はデザインにない（docs/ui/README.md の未解決）ので仮の文言。
 * ルーム一覧の last_message には添付の情報がないので、ファイル名は出せない。
 */
export const ATTACHMENT_ONLY_TEXT = "添付ファイル";

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
  if (last) {
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
  timeZone?: string;
};

/** タイムラインに並べる 1 件。確定したメッセージと、確定していない自分のメッセージを同じ形にそろえる。 */
type Entry = {
  key: string;
  seq: number | null;
  sender: UserProfile;
  createdAt: Date;
  body: string;
  status: "pending" | "sent" | "failed";
  deleted: boolean;
  edited: boolean;
  replyTo: { senderName: string; body: string } | undefined;
  attachments: readonly MessageAttachment[];
};

function fromMessage(message: Message): Entry {
  return {
    key: message.id,
    seq: message.seq,
    sender: message.sender,
    createdAt: new Date(message.created_at),
    body: message.body,
    // REST と WebSocket で届いたメッセージは seq が採番済み
    status: "sent",
    deleted: message.deleted_at !== null,
    edited: message.edited_at !== null,
    replyTo: message.reply_to
      ? {
          senderName: message.reply_to.sender.display_name,
          body: message.reply_to.deleted ? DELETED_MESSAGE_TEXT : message.reply_to.body,
        }
      : undefined,
    attachments: message.attachments,
  };
}

function fromOutgoing(message: OutgoingMessage, me: UserProfile): Entry {
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
    replyTo: message.replyTo ? { senderName: message.replyTo.senderName, body: message.replyTo.body } : undefined,
    attachments: message.attachments,
  };
}

/**
 * seq の昇順に並んだメッセージから、日付と未読の区切りを挟んだタイムラインを作る。
 * 確定していない自分のメッセージは、その後ろに送った順で並べる。
 */
export function toTimelineItems(
  messages: readonly Message[],
  { unreadAfterSeq, outgoing = [], me, avatarUrls = {}, attachmentUrls = {}, timeZone }: TimelineOptions,
): TimelineItem[] {
  const entries = messages.map(fromMessage);
  if (me) entries.push(...outgoing.map((m) => fromOutgoing(m, me)));

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
    // 自分の送信中のメッセージは未読にならない
    if (!unreadInserted && entry.seq !== null && entry.seq > unreadAfterSeq!) {
      items.push({ type: "unread", key: "unread" });
      unreadInserted = true;
      breakGroup = true;
    }

    const grouped =
      !breakGroup &&
      previous !== undefined &&
      previous.sender.id === entry.sender.id &&
      entry.createdAt.getTime() - previous.createdAt.getTime() < GROUPING_WINDOW_MS &&
      // 返信は引用を出すので、続けて表示すると誰の発言か分かりにくい
      entry.replyTo === undefined;

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
        replyTo: entry.replyTo,
        attachments: entry.attachments.map((a) => toAttachmentView(a, attachmentUrls)),
        grouped,
      },
    });
    previous = entry;
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
 * 画面に出している（削除されていない）メッセージの、プレビューする画像の ID。GET URL を取る対象（media.ts）。
 * 送信中のメッセージの添付はまだメッセージに付いていない（URL が 404 になる）ので含めない。
 */
export function previewImageIds(messages: readonly Message[]): string[] {
  return messages.flatMap((m) =>
    m.deleted_at === null ? m.attachments.filter(isPreviewImage).map((a) => a.id) : [],
  );
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
