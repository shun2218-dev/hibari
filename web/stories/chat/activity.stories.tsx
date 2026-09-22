import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens/chat";

/**
 * チャット / アクティビティ（ADR 0058）。通知の対象のメッセージと、自分のメッセージへのリアクションをメッセージ単位で並べる。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-activity--…` ↔ `chat/activity/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/アクティビティ",
  id: "chat-activity",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const List: Story = {
  name: "アクティビティ",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "activity" }),
};

export const ListDark: Story = {
  name: "アクティビティ（ダーク）",
  tags: ["since:6.14.5"],
  parameters: { theme: "dark" },
  render: () => chat({ side: "activity", dark: true }),
};

export const Hover: Story = {
  name: "アクティビティ（ポインタを乗せたところ）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "activity", activity: "hover" }),
};

export const Unread: Story = {
  name: "アクティビティ（未読メッセージだけ）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "activity", activity: "unread" }),
};

export const Mentions: Story = {
  name: "アクティビティ（メンション）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "activity", activity: "mention" }),
};

export const Reactions: Story = {
  name: "アクティビティ（リアクション）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "activity", activity: "reaction" }),
};

export const Empty: Story = {
  name: "アクティビティ（空）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "activity", activity: "empty" }),
};

export const UnreadEmpty: Story = {
  name: "アクティビティ（未読がない）",
  tags: ["since:6.14.5"],
  render: () => chat({ side: "activity", activity: "unread-empty" }),
};

export const MobileList: Story = {
  name: "アクティビティ（モバイル）",
  tags: ["since:6.14.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ side: "activity", mobileView: "list" }),
};
