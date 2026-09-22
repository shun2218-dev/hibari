import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { NotificationSettings } from "@/components/settings/settings-sections";

import { userSettings } from "../screens";

/**
 * ユーザー設定 / 通知（ADR 0055）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`settings-notifications--…` ↔ `settings/notifications/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "ユーザー設定/通知",
  id: "settings-notifications",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Notifications: Story = {
  name: "通知",
  tags: ["since:6.14"],
  render: () => userSettings("notifications", <NotificationSettings level="mentions" />),
};

export const NotificationsDark: Story = {
  name: "通知（ダーク）",
  tags: ["since:6.14"],
  parameters: { theme: "dark" },
  render: () => userSettings("notifications", <NotificationSettings level="mentions" />),
};

export const MobileNotifications: Story = {
  name: "通知（モバイル）",
  tags: ["since:6.14"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => userSettings("notifications", <NotificationSettings level="mentions" />),
};
