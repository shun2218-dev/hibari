import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AppearanceSettings } from "@/components/settings/settings-sections";

import { userSettings } from "@/stories/screens";

/**
 * ユーザー設定 / 外観。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`settings-appearance--…` ↔ `settings/appearance/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "ユーザー設定/外観",
  // PNG のパス（settings/appearance/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "settings-appearance",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Appearance: Story = {
  name: "外観",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => userSettings("appearance", <AppearanceSettings theme="light" density="comfortable" />),
};
