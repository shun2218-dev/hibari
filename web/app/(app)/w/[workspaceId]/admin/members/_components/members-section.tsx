"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { KickMemberDialog } from "@/components/workspace/member-dialogs";
import { type MemberMenuState, MemberList } from "@/components/workspace/member-list";
import type { WorkspaceRole } from "@/components/workspace/types";
import { useSessionState } from "@/hooks/auth/use-session";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { toMemberRowView } from "@/lib/chat/views/workspace-views";

/**
 * ワークスペースのメンバー（ロールの変更とキック）。
 * ロールの変更とキックはイベント（workspace.role_changed / workspace.member_removed）でも届くので、
 * 別の管理者の操作もその場で反映される。
 */
export function MembersSection() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const store = useChatStore();
  const { state: sessionState } = useSessionState();
  const workspace = useChatState((s) => s.workspaces.list.find((w) => w.id === workspaceId));
  const members = useChatState((s) => s.members[workspaceId]);

  const [menu, setMenu] = useState<MemberMenuState>(null);
  const [kicking, setKicking] = useState<string>();
  const [pending, setPending] = useState(false);

  const list = useMemo(() => members?.list ?? [], [members]);
  const avatarUrls = useAvatarUrls(useMemo(() => list.map((m) => m.user.id), [list]));
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const myRole = workspace?.my_role;
  const views = useMemo(
    () =>
      me && myRole ? list.map((member) => toMemberRowView(member, { userId: me.id, myRole, avatarUrls })) : [],
    [list, me, myRole, avatarUrls],
  );

  if (!workspace || !me) return null;

  async function changeRole(userId: string, role: WorkspaceRole) {
    setMenu(null);
    try {
      await store.changeMemberRole(workspaceId, userId, role);
    } catch (err) {
      // 失敗の表示はデザインにない（docs/ui/README.md の未解決）。一覧はサーバーの値のままにする
      console.error("failed to change member role", err);
    }
  }

  async function kick() {
    if (!kicking) return;
    setPending(true);
    try {
      await store.removeMember(workspaceId, kicking);
      setKicking(undefined);
    } catch (err) {
      console.error("failed to remove member", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <MemberList
        members={views}
        openMenu={menu}
        onOpenMenu={setMenu}
        onCloseMenu={() => setMenu(null)}
        onChangeRole={changeRole}
        onRemove={(userId) => {
          setMenu(null);
          setKicking(userId);
        }}
      />
      <KickMemberDialog
        open={kicking !== undefined}
        memberName={views.find((v) => v.id === kicking)?.name ?? ""}
        pending={pending}
        onCancel={() => setKicking(undefined)}
        onConfirm={kick}
      />
    </>
  );
}
