import type { PinnedMessageView } from "@/components/chat/types";
import type { Message } from "@/lib/api/types.gen";
import { permalinkPath } from "@/lib/chat/format/links";
import { formatListTime } from "@/lib/chat/format/time";
import type { UrlTable } from "@/lib/chat/views/message";
import { fromMessage, mentionNamesFor } from "@/lib/chat/views/timeline";

/**
 * ピン留めの一覧の 1 行（ADR 0054）。
 */
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
