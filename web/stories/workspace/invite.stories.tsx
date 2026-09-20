import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CreateInviteDialog, InviteCreatedDialog } from "@/components/workspace/invites";

import { workspaces } from "../fixtures";
import { invitesPage } from "../screens";

/**
 * ワークスペースの管理 / 招待リンク。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`workspace-invite--…` ↔ `workspace/invite/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "ワークスペースの管理/招待リンク",
  // PNG のパス（workspace/invite/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "workspace-invite",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

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
