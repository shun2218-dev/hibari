import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  type BrowserNotificationPermission,
  type BrowserNotificationView,
  NotificationSettings,
  type PushDeviceView,
  type PushNotificationState,
} from "@/components/settings/notification-settings";

import { workspaces } from "@/stories/fixtures/workspaces";
import { userSettings } from "@/stories/screens/settings";
import { noop } from "@/stories/screens/shared";

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

// ---- プッシュ通知（ADR 0069）。上の画面は、サーバーの設定でプッシュを使えないときの表示として残る（決定 9） ----

/** プッシュ通知を有効にした端末（決定 4）。いまの端末と、ほかに 2 つ。 */
const pushDevices: PushDeviceView[] = [
  { id: "push-mac", kind: "browser", name: "Chrome · macOS", enabledLabel: "10月19日に有効にしました", current: true },
  { id: "push-iphone", kind: "phone", name: "Safari · iPhone（ホーム画面）", enabledLabel: "10月19日に有効にしました", current: false },
  { id: "push-windows", kind: "browser", name: "Edge · Windows", enabledLabel: "10月12日に有効にしました", current: false },
];

/**
 * プッシュを使えるサーバーでの「このブラウザ」の節。ブラウザの許可は状態から決まる
 * （有効・確認待ち・失敗は許可を求めた後、拒否はブラウザが拒否、ほかはまだ求めていない）。
 */
function pushBrowser(state: PushNotificationState, devices: PushDeviceView[] = []): BrowserNotificationView {
  const permission: BrowserNotificationPermission =
    state === "on" || state === "failed" ? "granted" : state === "denied" ? "denied" : state === "unsupported" ? "unsupported" : "default";
  return {
    ...browser(permission),
    push: { state, onEnabledChange: noop, onShowInstallGuide: noop, devices, onStopDevice: noop },
  };
}

export const NotificationsPush: Story = {
  name: "通知（プッシュ通知が有効）",
  tags: ["since:7.1"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("on", pushDevices)} />),
};

export const NotificationsPushDark: Story = {
  name: "通知（プッシュ通知が有効・ダーク）",
  tags: ["since:7.1"],
  parameters: { theme: "dark" },
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("on", pushDevices)} />),
};

export const MobileNotificationsPush: Story = {
  name: "通知（プッシュ通知が有効・モバイル）",
  tags: ["since:7.1"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("on", pushDevices)} />),
};

/** まだ有効にしていない。ほかの端末で有効にしてあれば、その端末は並ぶ。 */
export const NotificationsPushOff: Story = {
  name: "通知（プッシュ通知がオフ）",
  tags: ["since:7.1"],
  render: () =>
    userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("off", pushDevices.slice(1))} />),
};

export const NotificationsPushRequesting: Story = {
  name: "通知（プッシュ通知の許可を待っている）",
  tags: ["since:7.1"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("requesting")} />),
};

export const NotificationsPushFailed: Story = {
  name: "通知（プッシュ通知の登録に失敗）",
  tags: ["since:7.1"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("failed")} />),
};

export const NotificationsPushDenied: Story = {
  name: "通知（プッシュ通知がブラウザで拒否されている）",
  tags: ["since:7.1"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("denied")} />),
};

export const NotificationsPushUnsupported: Story = {
  name: "通知（プッシュ通知に対応していない）",
  tags: ["since:7.1"],
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("unsupported")} />),
};

/** iPhone の Safari でホーム画面に追加していない（決定 1）。iPhone だけの表示なのでモバイルで撮る。 */
export const MobileNotificationsPushInstall: Story = {
  name: "通知（ホーム画面に追加していない iPhone）",
  tags: ["since:7.1"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => userSettings("notifications", <NotificationSettings workspaces={notificationWorkspaces} browser={pushBrowser("install")} />),
};
