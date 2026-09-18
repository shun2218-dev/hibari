"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo } from "react";

import { type AdminSection, WorkspaceAdminLayout } from "@/components/workspace/admin-layout";
import { useSessionState } from "@/lib/auth/session-provider";
import { useAvatarUrls, useChatState, useChatStore } from "@/lib/chat/chat-provider";

/**
 * ワークスペースの管理画面の枠（設定・メンバー・招待リンク）。
 *
 * 3 つの画面はどれも左のナビに人数と有効な招待の数を出すので、どの画面でもメンバーと招待の両方を取る。
 * 表示中のワークスペースとして登録もするので、ロールの変更やキックがイベントで届く（realtime.ts）。
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const store = useChatStore();
  const { state: sessionState } = useSessionState();
  const workspaces = useChatState((s) => s.workspaces);
  const members = useChatState((s) => s.members[workspaceId]);
  const invites = useChatState((s) => s.invites[workspaceId]);

  const workspace = workspaces.list.find((w) => w.id === workspaceId);

  useEffect(() => {
    store.loadWorkspaces();
    store.loadMembers(workspaceId);
    store.loadInvites(workspaceId);
  }, [store, workspaceId]);

  useEffect(() => {
    store.setActiveWorkspace(workspaceId);
    return () => store.setActiveWorkspace(null);
  }, [store, workspaceId]);

  // メンバーでなくなった（キックされた、URL を直接開いた）ら入口に戻す。チャットの画面と同じ扱い（ADR 0025）
  const notMember = (workspaces.status === "ready" && !workspace) || members?.status === "not_found";
  useEffect(() => {
    if (notMember) router.replace("/");
  }, [notMember, router]);

  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const avatarUrls = useAvatarUrls(useMemo(() => (me ? [me.id] : []), [me]));

  if (!workspace || !me) return null;

  const section = (["members", "invites"] as const).find((name) => pathname.endsWith(`/${name}`)) ?? "settings";
  const hrefs: Record<AdminSection, string> = {
    settings: `/w/${workspaceId}/admin/settings`,
    members: `/w/${workspaceId}/admin/members`,
    invites: `/w/${workspaceId}/admin/invites`,
  };

  return (
    <WorkspaceAdminLayout
      workspace={{ id: workspace.id, name: workspace.name }}
      currentUser={{
        id: me.id,
        name: me.display_name,
        avatarUrl: avatarUrls[me.id] ?? me.avatar_url,
        role: workspace.my_role,
      }}
      section={section}
      memberCount={members?.list.length ?? 0}
      activeInviteCount={(invites?.list ?? []).filter((invite) => invite.status === "active").length}
      hrefs={hrefs}
      backHref={`/w/${workspaceId}`}
    >
      {children}
    </WorkspaceAdminLayout>
  );
}
