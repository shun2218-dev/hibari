import type { ActivityItemView } from "@/components/chat/types";
import type { ActivityItem } from "@/lib/api/types.gen";
import { permalinkPath, withSide } from "@/lib/chat/format/links";
import { formatDayLabel, formatTime } from "@/lib/chat/format/time";
import type { UrlTable } from "@/lib/chat/views/message";
import { fromMessage, mentionNamesFor } from "@/lib/chat/views/timeline";

/**
 * アクティビティの一覧の 1 行（ADR 0058）。
 */
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
