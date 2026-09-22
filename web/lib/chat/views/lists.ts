import type { ActivityItemView, PinnedMessageView, SavedItemView } from "@/components/chat/types";
import type { ActivityItem, Message, SavedItem } from "@/lib/api/types.gen";
import { permalinkPath, withSide } from "@/lib/chat/format/links";
import { formatDayLabel, formatListTime, formatTime } from "@/lib/chat/format/time";

import type { UrlTable } from "./message";
import { fromMessage, mentionNamesFor } from "./timeline";

/**
 * ピン留め・「後で」・アクティビティの一覧の 1 行（ADR 0054 / 0058）。
 */
/**
 * ピン留めの一覧の 1 行（ADR 0054）。押すと 6.11b の仕組みでそのメッセージへ飛ぶ（href はパーマリンクのパス）。
 * 本文のメンションはルームのメンバーから名前を引き、メッセージ自身の mentions で補う（タイムラインと同じ）。
 */
export function toPinnedMessageView(
  message: Message,
  {
    workspaceId,
    now = new Date(),
    timeZone,
    avatarUrls = {},
    memberNames,
  }: {
    workspaceId: string;
    now?: Date;
    timeZone?: string;
    avatarUrls?: UrlTable;
    memberNames?: Readonly<Record<string, string>>;
  },
): PinnedMessageView {
  const threadRootId = message.thread_root_id ?? undefined;
  return {
    key: message.id,
    href: permalinkPath({ workspaceId, roomId: message.room_id, messageId: message.id, ...(threadRootId ? { threadRootId } : {}) }),
    sender: {
      id: message.sender.id,
      name: message.sender.display_name,
      avatarUrl: avatarUrls[message.sender.id] ?? undefined,
    },
    timeLabel: formatListTime(new Date(message.created_at), now, timeZone),
    body: message.body,
    mentionNames: mentionNamesFor(fromMessage(message, undefined), memberNames),
    attachmentCount: message.attachments.length,
    inThread: message.thread_root_id !== null,
  };
}

/**
 * 「後で」の一覧の 1 行（ADR 0054）。読めない・削除済みは区別せずに unavailable の行にする（決定 8）。
 * 押すと 6.11b の仕組みでそのメッセージへ飛ぶ（href はパーマリンクのパス）。
 */
/**
 * アクティビティの 1 件（ADR 0058）。押すとそのメッセージへ飛ぶ（ADR 0042）。
 * side を渡すと、行き先の URL に左のメニューを残す（ルームを開いてもサイドバーの中身を変えない。決定 1）。
 * リアクションのときは、付けた人をアバターと名前に、付けられた自分のメッセージを本文に出す。
 */
export function toActivityItemView(
  item: ActivityItem,
  {
    workspaceId,
    now = new Date(),
    timeZone,
    avatarUrls = {},
    memberNames,
    side,
  }: {
    /** 1 件の行き先のワークスペース（API の 1 件には入っていない。一覧は表示中のワークスペースのもの）。 */
    workspaceId: string;
    now?: Date;
    timeZone?: string;
    avatarUrls?: UrlTable;
    memberNames?: Readonly<Record<string, string>>;
    side?: string;
  },
): ActivityItemView {
  const { message, room, reaction } = item;
  const actor = reaction?.user ?? message.sender;
  const threadRootId = message.thread_root_id ?? undefined;
  const at = new Date(item.occurred_at);
  const href = permalinkPath({
    workspaceId,
    roomId: room.id,
    messageId: message.id,
    ...(threadRootId ? { threadRootId } : {}),
  });
  return {
    key: item.id,
    href: side ? withSide(href, side) : href,
    reasons: item.reasons,
    unread: item.unread,
    room: { kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : room.name },
    actor: { id: actor.id, name: actor.display_name, avatarUrl: avatarUrls[actor.id] ?? undefined },
    ...(reaction ? { reactionEmoji: reaction.emoji } : {}),
    body: message.body,
    mentionNames: mentionNamesFor(fromMessage(message, undefined), memberNames),
    attachmentCount: message.attachments.length,
    dateLabel: formatDayLabel(at, now, timeZone),
    timeLabel: formatTime(at, timeZone),
  };
}

export function toSavedItemView(
  item: SavedItem,
  {
    now = new Date(),
    timeZone,
    avatarUrls = {},
    memberNames,
    side,
  }: {
    now?: Date;
    timeZone?: string;
    avatarUrls?: UrlTable;
    /** 本文の `<@ID>` に使う表示名（ワークスペースのメンバー一覧から）。メッセージ自身の mentions で補う。 */
    memberNames?: Readonly<Record<string, string>>;
    /** 行き先の URL に残す左のメニュー（ADR 0058 決定 1）。 */
    side?: string;
  } = {},
): SavedItemView {
  const { message, room } = item;
  if (item.status !== "ok" || !message || !room) return { key: item.message_id, status: "unavailable" };
  const threadRootId = message.thread_root_id ?? undefined;
  const href = permalinkPath({
    workspaceId: item.workspace_id,
    roomId: item.room_id,
    messageId: item.message_id,
    ...(threadRootId ? { threadRootId } : {}),
  });
  return {
    key: item.message_id,
    status: "ok",
    href: side ? withSide(href, side) : href,
    room: { kind: room.kind, name: room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : room.name },
    sender: {
      id: message.sender.id,
      name: message.sender.display_name,
      avatarUrl: avatarUrls[message.sender.id] ?? undefined,
    },
    timeLabel: formatListTime(new Date(message.created_at), now, timeZone),
    body: message.body,
    mentionNames: mentionNamesFor(fromMessage(message, undefined), memberNames),
    attachmentCount: message.attachments.length,
  };
}
