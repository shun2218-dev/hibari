import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { NoWorkspaces } from "@/components/workspace/no-workspaces";

import { chat } from "@/stories/screens";

/**
 * チャット / ワークスペースの切り替え。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-workspace--…` ↔ `chat/workspace/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/ワークスペースの切り替え",
  // PNG のパス（chat/workspace/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-workspace",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const RemovedFromWorkspace: Story = {
  name: "ワークスペースから削除された",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ body: "removed-workspace", footer: "none" }),
};

export const WorkspaceSwitcher: Story = {
  name: "ワークスペースの切り替え",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ switcher: true }),
};

export const WorkspaceCreateDialog: Story = {
  name: "ワークスペースを作成",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ createWorkspace: true }),
};

export const AccountMenu: Story = {
  name: "アカウントメニュー",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "420x340" } },
  render: () => chat({ accountMenu: true }),
};

export const EmptyWorkspaces: Story = {
  name: "ワークスペースが 0 件",
  tags: ["since:6-2"],
  parameters: { screenshot: { source: "design", size: "480x600" } },
  render: () => <NoWorkspaces />,
};
