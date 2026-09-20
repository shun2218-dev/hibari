import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CreateInviteDialog, InviteCreatedDialog } from "@/components/workspace/invites";
import { KickMemberDialog, LeaveBlockedDialog, LeaveWorkspaceDialog, TransferOwnershipConfirmDialog, TransferOwnershipPickDialog } from "@/components/workspace/member-dialogs";

import { transferCandidates, users, workspaces } from "./fixtures";
import { invitesPage, membersPage, settingsPage } from "./screens";

/**
 * ワークスペースの管理（設定・メンバー・招待リンク）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`workspace--…` ↔ `workspace/….png`。ADR 0047 決定 2）。
 * 表示名は `name`、足したフェーズは `since:` の tag、撮影の大きさと出どころは `parameters.screenshot` に置く。
 */
const meta = {
  title: "workspace",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SettingsAsOwner: Story = {
  name: "設定（オーナー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => settingsPage("owner"),
};

export const SettingsAsAdmin: Story = {
  name: "設定（管理者）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => settingsPage("admin"),
};

export const SettingsAsMember: Story = {
  name: "設定（メンバー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => settingsPage("member"),
};

export const MembersAsOwner: Story = {
  name: "メンバー（オーナー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("owner"),
};

export const MembersAsAdmin: Story = {
  name: "メンバー（管理者）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("admin"),
};

export const MembersAsMember: Story = {
  name: "メンバー（メンバー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("member"),
};

export const MembersDark: Story = {
  name: "メンバー（ダーク）",
  tags: ["since:1.5"],
  parameters: { theme: "dark", screenshot: { source: "design" } },
  render: () => membersPage("owner"),
};

export const MobileMembers: Story = {
  name: "メンバー（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => membersPage("owner"),
};

export const MemberMenuRolePicker: Story = {
  name: "ロールの選択",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("owner", { userId: users.misaki.id, kind: "roles" }),
};

export const MemberMenuLockedReason: Story = {
  name: "管理できない理由",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("admin", { userId: users.misaki.id, kind: "locked" }),
};

export const MemberMenuWithKick: Story = {
  name: "ロールの選択とキック",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "760x420" } },
  render: () => membersPage("owner", { userId: users.suzuki.id, kind: "roles" }),
};

export const DialogKick: Story = {
  name: "キックの確認",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("owner", null, <KickMemberDialog open memberName={users.suzuki.name} />),
};

export const DialogTransferPick: Story = {
  name: "譲渡先の選択",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    settingsPage("owner", <TransferOwnershipPickDialog open candidates={transferCandidates} selectedId={users.misaki.id} />),
};

export const DialogTransferConfirm: Story = {
  name: "譲渡の確認",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    settingsPage(
      "owner",
      <TransferOwnershipConfirmDialog open newOwnerName={users.misaki.name} workspaceName={workspaces.yama.name} />,
    ),
};

export const DialogLeave: Story = {
  name: "退出の確認",
  tags: ["since:6"],
  render: () => settingsPage("member", <LeaveWorkspaceDialog open workspaceName={workspaces.yama.name} />),
};

export const DialogLeaveBlockedOwner: Story = {
  name: "オーナーは退出できない",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => settingsPage("owner", <LeaveBlockedDialog open />),
};

export const BackToChat: Story = {
  name: "管理画面からチャットに戻る",
  tags: ["since:6-2"],
  render: () => settingsPage("owner"),
};

export const InvitesAsOwner: Story = {
  name: "招待リンク（オーナー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => invitesPage("owner"),
};

export const InvitesAsAdmin: Story = {
  name: "招待リンク（管理者）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => invitesPage("admin"),
};

export const InvitesAsMember: Story = {
  name: "招待リンク（メンバー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => invitesPage("member"),
};

export const InvitesAsMemberPolicyAll: Story = {
  name: "招待リンク（メンバー・全員が作成可）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => invitesPage("member", "all_members"),
};

export const DialogInviteNew: Story = {
  name: "招待リンクを作成",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    invitesPage("owner", "admins_only", <CreateInviteDialog open maxUses={10} expiresInSeconds={7 * 24 * 60 * 60} />),
};

export const DialogInviteCreated: Story = {
  name: "招待リンクを作成済み",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    invitesPage(
      "owner",
      "admins_only",
      <InviteCreatedDialog open url="https://hibari.app/j/7Qv2xkR8mA" summary={`10 回 · 7 日後に失効 · ${workspaces.yama.name}`} />,
    ),
};
