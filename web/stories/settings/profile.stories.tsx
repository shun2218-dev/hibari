import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ProfileSettings } from "@/components/settings/settings-sections";

import { mockAvatars, users } from "@/stories/fixtures";
import { userSettings } from "@/stories/screens";

/**
 * ユーザー設定 / プロフィール。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`settings-profile--…` ↔ `settings/profile/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "ユーザー設定/プロフィール",
  // PNG のパス（settings/profile/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "settings-profile",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
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
