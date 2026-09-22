import type { ThreadListItemView, TimelineItem } from "@/components/chat/types";
import type { FollowedThread } from "@/lib/api/types.gen";
import { formatListTime } from "@/lib/chat/format/time";
import type { ThreadState } from "@/lib/chat/store/state";

import type { UrlTable } from "./message";
import { type TimelineOptions, toTimelineItems } from "./timeline";

/**
 * スレッド（ADR 0036）のパネルと一覧。
 */
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
  {
    timeZone,
    avatarUrls = {},
    memberNames,
  }: {
    timeZone?: string;
    avatarUrls?: UrlTable;
    /** 親の本文の `<@ID>` に使う表示名（ワークスペースのメンバー一覧から。一覧の API はメンションの名前を返さない）。 */
    memberNames?: Readonly<Record<string, string>>;
  } = {},
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
      mentionNames: memberNames,
    },
    replyCount: thread.reply_count,
    lastReplyLabel: formatListTime(new Date(thread.last_reply_at), now, timeZone),
    unreadCount: thread.unread_count,
    notifyReplies: thread.notify_replies,
    mentionCount: thread.mention_count,
  };
}
