"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { StartDmDialog } from "@/components/chat/room-dialogs";
import { useSessionState } from "@/hooks/auth/use-session";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { toDmCandidates } from "@/lib/chat/views/members";

/**
 * ダイレクトメッセージを開く（`chat/room/dm-dialog.png`）。
 * 相手はワークスペースのメンバーから選ぶ。同じ相手の DM は 1 つにまとまる（ADR 0011）ので、すでにあればそれを開く。
 */
export function StartDm({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const store = useChatStore();
  const { state: sessionState } = useSessionState();
  const members = useChatState((s) => s.members[workspaceId]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [opening, setOpening] = useState(false);

  // 相手を選ぶときだけメンバーを取る（サイドバーには要らない）
  useEffect(() => {
    if (open) store.loadMembers(workspaceId);
  }, [open, store, workspaceId]);

  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const candidates = useMemo(
    () => toDmCandidates(members?.list ?? [], { userId: me?.id ?? "", search }),
    [members, me, search],
  );
  const avatarUrls = useAvatarUrls(useMemo(() => candidates.map((c) => c.id), [candidates]));

  function close() {
    setSearch("");
    setSelectedId(undefined);
    onClose();
  }

  async function openDm() {
    if (!selectedId) return;
    setOpening(true);
    try {
      const room = await store.openDm(workspaceId, selectedId);
      close();
      router.push(`/w/${workspaceId}/r/${room.id}`);
    } catch (err) {
      // 相手がワークスペースを抜けた（422）などの表示はデザインにない。ダイアログを残して選び直せるようにする
      console.error("failed to open a dm", err);
    } finally {
      setOpening(false);
    }
  }

  return (
    <StartDmDialog
      open={open}
      candidates={candidates.map((c) => ({ ...c, avatarUrl: avatarUrls[c.id] ?? undefined }))}
      selectedId={selectedId}
      search={search}
      onSearchChange={setSearch}
      onSelect={setSelectedId}
      onCancel={close}
      onOpen={openDm}
      opening={opening}
    />
  );
}
