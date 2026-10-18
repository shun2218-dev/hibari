"use client";

import type { ReactNode } from "react";

import { type AdminSection, WorkspaceAdminLayout } from "@/components/workspace/admin-layout";
import { InviteList } from "@/components/workspace/invites";
import { MemberList, type MemberMenuState } from "@/components/workspace/member-list";
import type { WorkspaceRole } from "@/components/workspace/types";
import { WorkspaceSettings } from "@/components/workspace/workspace-settings";
import { users } from "@/stories/fixtures/users";
import { invitesAs, membersAs, workspaces } from "@/stories/fixtures/workspaces";

import { noHref } from "./shared";

/**
 * ワークスペースの管理画面（ADR 0029 / 0030）。
 */
// ---- ワークスペースの管理 ----

const adminHrefs: Record<AdminSection, string> = { settings: noHref, members: noHref, invites: noHref };

function admin(role: WorkspaceRole, section: AdminSection, children: ReactNode, overlay?: ReactNode) {
  return (
    <>
      <WorkspaceAdminLayout
        workspace={workspaces.yama}
        currentUser={{ ...users.you, role }}
        section={section}
        memberCount={6}
        activeInviteCount={1}
        hrefs={adminHrefs}
        backHref={noHref}
      >
        {children}
      </WorkspaceAdminLayout>
      {overlay}
    </>
  );
}

export function settingsPage(role: WorkspaceRole, overlay?: ReactNode) {
  return admin(role, "settings", <WorkspaceSettings role={role} name={workspaces.yama.name} invitePolicy="admins_only" />, overlay);
}

export function membersPage(role: WorkspaceRole, openMenu: MemberMenuState = null, overlay?: ReactNode) {
  return admin(role, "members", <MemberList members={membersAs(role)} openMenu={openMenu} />, overlay);
}

export function invitesPage(role: WorkspaceRole, policy: "admins_only" | "all_members" = "admins_only", overlay?: ReactNode) {
  const canCreate = role !== "member" || policy === "all_members";
  return admin(
    role,
    "invites",
    <InviteList
      invites={invitesAs(role)}
      canCreate={canCreate}
      createLockedReason={canCreate ? undefined : "管理者だけが招待リンクを作成できます。"}
    />,
    overlay,
  );
}
