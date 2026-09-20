import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SettingsMobileMenu } from "@/components/settings/settings-layout";
import { AppearanceSettings, DevicesSettings, ProfileSettings } from "@/components/settings/settings-sections";

import { devices, mockAvatars, users } from "./fixtures";
import { noHref, settingsHrefs, userSettings } from "./screens";

/**
 * ユーザー設定。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`settings--…` ↔ `settings/….png`。ADR 0047 決定 2）。
 * 表示名は `name`、足したフェーズは `since:` の tag、撮影の大きさと出どころは `parameters.screenshot` に置く。
 */
const meta = {
  title: "settings",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Profile: Story = {
  name: "プロフィール",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    userSettings("profile", <ProfileSettings user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle }} />),
};

export const Devices: Story = {
  name: "ログイン中のデバイス",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => userSettings("devices", <DevicesSettings devices={devices} />),
};

export const DevicesDark: Story = {
  name: "ログイン中のデバイス（ダーク）",
  tags: ["since:1.5"],
  parameters: { theme: "dark", screenshot: { source: "design" } },
  render: () => userSettings("devices", <DevicesSettings devices={devices} />),
};

export const ProfileAvatar: Story = {
  name: "プロフィール: 画像あり",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "560x300" } },
  render: () =>
    userSettings(
      "profile",
      <ProfileSettings
        user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle, avatarUrl: mockAvatars.you }}
      />,
    ),
};

export const ProfileAvatarUploading: Story = {
  name: "プロフィール: アップロード中",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "560x300" } },
  render: () =>
    userSettings(
      "profile",
      <ProfileSettings
        avatarState="uploading"
        user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle, avatarUrl: mockAvatars.you }}
      />,
    ),
};

export const ProfileAvatarFailed: Story = {
  name: "プロフィール: アップロード失敗",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "560x300" } },
  render: () =>
    userSettings(
      "profile",
      <ProfileSettings
        avatarState="failed"
        user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle }}
      />,
    ),
};

export const Appearance: Story = {
  name: "外観",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => userSettings("appearance", <AppearanceSettings theme="light" density="comfortable" />),
};

export const BackToChat: Story = {
  name: "設定からチャットに戻る",
  tags: ["since:6-2"],
  render: () =>
    userSettings("profile", <ProfileSettings user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle }} />),
};

export const MobileList: Story = {
  name: "設定の一覧（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => <SettingsMobileMenu hrefs={settingsHrefs} chatHref={noHref} />,
};

export const MobileBackToChat: Story = {
  name: "設定からチャットに戻る（モバイル）",
  tags: ["since:6-2"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => <SettingsMobileMenu hrefs={settingsHrefs} chatHref={noHref} />,
};
