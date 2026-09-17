"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NoWorkspaces } from "@/components/workspace/no-workspaces";
import { useSession } from "@/lib/auth/session-provider";
import { useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { lastWorkspaceId } from "@/lib/chat/last-location";

import { CreateWorkspace } from "./create-workspace";

/**
 * ログインした後の入口。最後に開いたワークスペース（なければ一覧の先頭）に移る。
 * どのルームを開くかは、ワークスペースの画面が決める。
 */
export default function HomePage() {
  const router = useRouter();
  const session = useSession();
  const store = useChatStore();
  const workspaces = useChatState((s) => s.workspaces);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    store.loadWorkspaces();
  }, [store]);

  useEffect(() => {
    if (workspaces.status !== "ready" || workspaces.list.length === 0) return;
    const remembered = workspaces.list.find((w) => w.id === lastWorkspaceId());
    router.replace(`/w/${(remembered ?? workspaces.list[0]).id}`);
  }, [workspaces, router]);

  // 取得中と、取得できなかったとき（その画面はデザインにない）は何も描かない。
  if (workspaces.status !== "ready" || workspaces.list.length > 0) return null;

  return (
    <>
      <NoWorkspaces onCreate={() => setCreating(true)} onLogout={() => session.logout()} />
      <CreateWorkspace open={creating} onClose={() => setCreating(false)} navigate={false} />
    </>
  );
}
