"use client";

import { useMemo } from "react";

import { ThreadList } from "@/components/chat/thread-list";
import { useAvatarUrls, useChatState } from "@/lib/chat/chat-provider";
import { toThreadListItemView } from "@/lib/chat/views";

/**
 * 参加しているスレッドの一覧（`/w/{id}/threads`。chat/thread/threads.png）。押すと、そのルームをスレッドのパネルを開いた状態で出す。
 * 一覧はサイドバーのバッジにも使うので、WorkspaceScreen がワークスペースを開いたときに取ってある。
 */
export function WorkspaceThreads({ workspaceId, onBack }: { workspaceId: string; onBack: () => void }) {
  const threadList = useChatState((s) => s.threadLists[workspaceId]);
  const threads = threadList?.list;
  const senderIds = useMemo(() => (threads ?? []).map((t) => t.root.sender.id), [threads]);
  const avatarUrls = useAvatarUrls(senderIds);
  const views = useMemo(() => {
    const now = new Date();
    return (threads ?? []).map((t) => toThreadListItemView(t, now, { avatarUrls }));
  }, [threads, avatarUrls]);

  // 取得中と失敗の画面はデザインにない。取れるまでは何も描かない（0 件の表示と取り違えないように）
  if (threadList?.status !== "ready") return null;
  const roomOf = new Map((threads ?? []).map((t) => [t.root.id, t.room.id]));
  return (
    <ThreadList
      threads={views}
      threadHref={(key) => `/w/${workspaceId}/r/${roomOf.get(key)}?t=${key}`}
      onBack={onBack}
    />
  );
}
