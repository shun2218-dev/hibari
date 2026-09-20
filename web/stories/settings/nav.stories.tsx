import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SettingsMobileMenu } from "@/components/settings/settings-layout";
import { ProfileSettings } from "@/components/settings/settings-sections";

import { users } from "../fixtures";
import { noHref, settingsHrefs, userSettings } from "../screens";

/**
 * ユーザー設定 / 移動。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`settings-nav--…` ↔ `settings/nav/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "ユーザー設定/移動",
  // PNG のパス（settings/nav/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "settings-nav",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

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
