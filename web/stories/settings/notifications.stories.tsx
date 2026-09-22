import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  type BrowserNotificationPermission,
  type BrowserNotificationView,
  NotificationSettings,
} from "@/components/settings/settings-sections";

import { workspaces } from "../fixtures";
import { noop, userSettings } from "../screens";

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

/** 全体の設定はワークスペースごと（ADR 0055 決定 2）。2 つに所属して、別の値を選んでいるところ。 */
const notificationWorkspaces = [
  { ...workspaces.dev, level: "mentions" as const },
  { ...workspaces.memo, level: "all" as const },
];

/** このブラウザの節（ADR 0057）。既定は、まだ許可していない状態。 */
function browser(permission: BrowserNotificationPermission): BrowserNotificationView {
  return { permission, onRequestPermission: noop, sound: true, onSoundChange: noop };
}

export const Notifications: Story = {
  name: "通知",
  tags: ["since:6.14"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={browser("default")} />),
};

export const NotificationsDark: Story = {
  name: "通知（ダーク）",
  tags: ["since:6.14"],
  parameters: { theme: "dark" },
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={browser("default")} />),
};

export const MobileNotifications: Story = {
  name: "通知（モバイル）",
  tags: ["since:6.14"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={browser("default")} />),
};

export const NotificationsGranted: Story = {
  name: "通知（デスクトップ通知が有効）",
  tags: ["since:6.14"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={browser("granted")} />),
};

export const NotificationsDenied: Story = {
  name: "通知（ブラウザで拒否されている）",
  tags: ["since:6.14"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={browser("denied")} />),
};
