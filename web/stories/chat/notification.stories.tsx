import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens/chat";

/**
 * チャット / ミュートと通知の設定（ADR 0055）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-notification--…` ↔ `chat/notification/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/通知",
  id: "chat-notification",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Menu: Story = {
  name: "ヘッダーの「通知」のメニュー",
  tags: ["since:6.14"],
  render: () => chat({ notifications: "menu" }),
};

export const MenuMuted: Story = {
  name: "ヘッダーの「通知」のメニュー（ミュート中）",
  tags: ["since:6.14"],
  render: () => chat({ notifications: "menu-muted" }),
};

export const MenuTemporary: Story = {
  name: "ヘッダーの「通知」のメニュー（一時的にミュート中）",
  tags: ["since:6.14"],
  render: () => chat({ notifications: "menu-temporary" }),
};

export const MenuDm: Story = {
  name: "DM の「通知」のメニュー",
  tags: ["since:6.14"],
  render: () => chat({ notifications: "menu-dm" }),
};

export const MenuDark: Story = {
  name: "ヘッダーの「通知」のメニュー（ダーク）",
  tags: ["since:6.14"],
  parameters: { theme: "dark" },
  render: () => chat({ notifications: "menu", dark: true }),
};

export const Sidebar: Story = {
  name: "ミュートしたルームのサイドバー",
  tags: ["since:6.14"],
  render: () => chat({ notifications: "sidebar" }),
};

export const SidebarDark: Story = {
  name: "ミュートしたルームのサイドバー（ダーク）",
  tags: ["since:6.14"],
  parameters: { theme: "dark" },
  render: () => chat({ notifications: "sidebar", dark: true }),
};

export const MobileMenu: Story = {
  name: "ヘッダーの「通知」のメニュー（モバイル）",
  tags: ["since:6.14"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ notifications: "menu" }),
};

export const MobileSidebar: Story = {
  name: "ミュートしたルームのサイドバー（モバイル）",
  tags: ["since:6.14"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ notifications: "sidebar", mobileView: "list" }),
};

export const PermissionBanner: Story = {
  name: "デスクトップ通知を有効にする帯",
  tags: ["since:6.14"],
  render: () => chat({ permissionBanner: true }),
};

export const PermissionBannerDark: Story = {
  name: "デスクトップ通知を有効にする帯（ダーク）",
  tags: ["since:6.14"],
  parameters: { theme: "dark" },
  render: () => chat({ permissionBanner: true, dark: true }),
};

export const MobilePermissionBanner: Story = {
  name: "デスクトップ通知を有効にする帯（モバイル）",
  tags: ["since:6.14"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ permissionBanner: true, mobileView: "list" }),
};
