import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  LeaveBlockedDialog,
  LeaveWorkspaceDialog,
  TransferOwnershipConfirmDialog,
  TransferOwnershipPickDialog,
} from "@/components/workspace/member-dialogs";

import { users } from "@/stories/fixtures/users";
import { transferCandidates, workspaces } from "@/stories/fixtures/workspaces";
import { settingsPage } from "@/stories/screens/workspace";

/**
 * ワークスペースの管理 / 設定。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`workspace-settings--…` ↔ `workspace/settings/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "ワークスペースの管理/設定",
  // PNG のパス（workspace/settings/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "workspace-settings",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
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
