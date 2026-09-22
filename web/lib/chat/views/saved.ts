import type { SavedItemView } from "@/components/chat/types";
import type { SavedItem } from "@/lib/api/types.gen";
import { permalinkPath, withSide } from "@/lib/chat/format/links";
import { formatListTime } from "@/lib/chat/format/time";
import type { UrlTable } from "@/lib/chat/views/message";
import { fromMessage, mentionNamesFor } from "@/lib/chat/views/timeline";

/**
 * 「後で」の一覧の 1 行（ADR 0054）。
 */
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
