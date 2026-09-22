"use client";

import type { MessageView } from "@/components/chat/types";
import { ChevronRightIcon } from "@/components/ui/icons";

/**
 * メッセージの下に出すスレッドの要約（ADR 0037）。返信の数と、最後に返信した人。
 */
/**
 * 親のメッセージの下の「N 件の返信」。押すとスレッドを開く（押せるので緑。docs/ui/tokens.md）。
 * 親が削除されていても、返信は残るので出す（ADR 0036）。
 */
export function ThreadSummary({ thread, onOpen }: { thread: NonNullable<MessageView["thread"]>; onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/thread mt-1.5 -ml-1.5 flex h-7 items-center gap-2 rounded-sm px-1.5 text-xs hover:bg-surface"
    >
      <span className="font-semibold text-primary group-hover/thread:underline">{thread.replyCount} 件の返信</span>
      <span className="font-mono text-2xs text-text-muted">最終返信 {thread.lastReplyLabel}</span>
      <ChevronRightIcon className="size-3.5 text-text-muted" />
    </button>
  );
}
