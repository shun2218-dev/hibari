import type {
  MessageAttachmentView,
  RoleLabel,
  RoomMemberView,
  RoomSummaryView,
  TimelineItem,
} from "@/components/chat/types";
import type { Message, MessageAttachment, Role, Room, RoomMember } from "@/lib/api/types.gen";

import { dayKey, formatBytes, formatDate, formatListTime, formatTime } from "./format";

/**
 * API のレスポンスを、presentational コンポーネントの表示用の型に変える（ADR 0018）。
 * どれも純粋な関数にして、時刻の文言はタイムゾーンを引数で固定してテストする。
 */

/** 削除済みのメッセージの本文の代わり。タイムラインの表示（MessageItem）と同じ文言にする。 */
export const DELETED_MESSAGE_TEXT = "このメッセージは削除されました";

/** 続けて表示する（アバターと名前を省く）のは、同じ送信者がこの時間内に送ったときだけ。 */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

/** ルームの表示名。DM に名前はないので、相手の表示名にする。 */
export function roomName(room: Room): string {
  return room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "");
}

export function toRoomSummaryView(room: Room, now: Date, timeZone?: string): RoomSummaryView {
  const last = room.last_message;
  let lastMessage: string | undefined;
  if (last) {
    const body = last.deleted ? DELETED_MESSAGE_TEXT : last.body;
    // DM は相手と自分しかいないので送信者を省く（sidebar のデザイン）
    lastMessage = room.kind === "dm" ? body : `${last.sender.display_name}: ${body}`;
  }
  return {
    id: room.id,
    kind: room.kind,
    name: roomName(room),
    peer: room.dm_peer ? { id: room.dm_peer.id, online: room.dm_peer.online } : undefined,
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
  timeZone?: string;
};

/** seq の昇順に並んだメッセージから、日付と未読の区切りを挟んだタイムラインを作る。 */
export function toTimelineItems(messages: readonly Message[], { unreadAfterSeq, timeZone }: TimelineOptions): TimelineItem[] {
  const items: TimelineItem[] = [];
  let previous: Message | undefined;
  let previousDay: string | undefined;
  let unreadInserted = unreadAfterSeq === null;

  for (const message of messages) {
    const createdAt = new Date(message.created_at);
    const day = dayKey(createdAt, timeZone);
    let breakGroup = false;

    if (day !== previousDay) {
      items.push({ type: "date", key: `date-${day}`, label: formatDate(createdAt, timeZone) });
      previousDay = day;
      breakGroup = true;
    }
    if (!unreadInserted && message.seq > unreadAfterSeq!) {
      items.push({ type: "unread", key: "unread" });
      unreadInserted = true;
      breakGroup = true;
    }

    const grouped =
      !breakGroup &&
      previous !== undefined &&
      previous.sender.id === message.sender.id &&
      createdAt.getTime() - new Date(previous.created_at).getTime() < GROUPING_WINDOW_MS &&
      // 返信は引用を出すので、続けて表示すると誰の発言か分かりにくい
      message.reply_to === null;

    items.push({
      type: "message",
      message: {
        key: message.id,
        sender: { id: message.sender.id, name: message.sender.display_name },
        timeLabel: formatTime(createdAt, timeZone),
        body: message.body,
        // REST で取得したメッセージは seq が採番済み。pending / failed は送信（構築順 4）で使う
        status: "sent",
        deleted: message.deleted_at !== null,
        edited: message.edited_at !== null,
        replyTo: message.reply_to
          ? {
              senderName: message.reply_to.sender.display_name,
              body: message.reply_to.deleted ? DELETED_MESSAGE_TEXT : message.reply_to.body,
            }
          : undefined,
        attachments: message.attachments.map(toAttachmentView),
        grouped,
      },
    });
    previous = message;
  }
  return items;
}

function toAttachmentView(attachment: MessageAttachment): MessageAttachmentView {
  if (attachment.content_type.startsWith("image/")) {
    return {
      kind: "image",
      id: attachment.id,
      fileName: attachment.file_name,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      // GET URL は表示するときに取る（ADR 0013）。構築順 5 で入れる
    };
  }
  return { kind: "file", id: attachment.id, fileName: attachment.file_name, sizeLabel: formatBytes(attachment.size_bytes) };
}

const roleLabels: Record<Role, RoleLabel> = { owner: "オーナー", admin: "管理者", member: "メンバー" };

export function toRoomMemberView(member: RoomMember): RoomMemberView {
  return {
    id: member.user.id,
    name: member.user.display_name,
    online: member.online,
    roleLabel: roleLabels[member.role],
  };
}
