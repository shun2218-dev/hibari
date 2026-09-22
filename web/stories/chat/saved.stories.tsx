import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens";

/**
 * チャット / 「後で」（ADR 0054。Slack の「後で」と同じく、自分だけに見える保存）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-saved--…` ↔ `chat/saved/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/後で",
  id: "chat-saved",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Hover: Story = {
  name: "メッセージのホバーの「後で」",
  tags: ["since:6.12"],
  render: () => chat({ side: "home", saved: "hover" }),
};

export const HoverSaved: Story = {
  name: "メッセージのホバーの「後で」（保存済み）",
  tags: ["since:6.12"],
  render: () => chat({ side: "home", saved: "hover-saved" }),
};

export const List: Story = {
  name: "「後で」の進行中",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "in_progress" }),
};

export const RowHover: Story = {
  name: "「後で」の行のホバー",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "row-hover" }),
};

export const Menu: Story = {
  name: "「後で」の行の「その他」",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "menu" }),
};

export const Archived: Story = {
  name: "「後で」のアーカイブ済み",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "archived" }),
};

export const ArchivedMenu: Story = {
  name: "アーカイブ済みの行の「その他」",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "archived-menu" }),
};

export const Completed: Story = {
  name: "「後で」の完了済み",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "completed" }),
};

export const Empty: Story = {
  name: "「後で」（何も保存していない）",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "empty" }),
};

export const Confirm: Story = {
  name: "読めない行を外すときの確認",
  tags: ["since:6.12"],
  render: () => chat({ side: "later", saved: "confirm" }),
};

export const ListDark: Story = {
  name: "「後で」の進行中（ダーク）",
  tags: ["since:6.12"],
  parameters: { theme: "dark" },
  render: () => chat({ side: "later", saved: "in_progress" }),
};

export const MobileList: Story = {
  name: "「後で」の進行中（モバイル）",
  tags: ["since:6.12"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ side: "later", saved: "in_progress", mobileView: "list" }),
};
