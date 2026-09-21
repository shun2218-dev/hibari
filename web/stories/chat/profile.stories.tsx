import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "../screens";

/**
 * チャット / プロフィール（Phase 6.9。ADR 0050）。
 * md 以上はアバターや名前にポインタを乗せるとカード、押すと右のパネル。モバイルは押すと全画面のパネル。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-profile--…` ↔ `chat/profile/….png`）。
 */
const meta = {
  title: "チャット/プロフィール",
  id: "chat-profile",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

// ---- ホバーのカード（md 以上） ----

/** 要約と「DM を送る」だけ。email は押して開くパネルにだけ出す（ホバーでは API を呼ばない）。 */
export const HoverOther: Story = {
  name: "ホバーのカード（他人）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "hover-other" }),
};

/** 自分のカードには操作を置かない（押せばパネルが開く）。 */
export const HoverSelf: Story = {
  name: "ホバーのカード（自分）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "hover-self" }),
};

/** 外された人の過去のメッセージ。名前・handle・アバターだけ（ADR 0050 決定 5）。 */
export const HoverFormer: Story = {
  name: "ホバーのカード（外された人）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "hover-former" }),
};

export const HoverOtherDark: Story = {
  name: "ホバーのカード（ダーク）",
  tags: ["since:6.9"],
  parameters: { theme: "dark" },
  render: () => chat({ profile: "hover-other", dark: true }),
};

// ---- 右のパネル ----

/** 押すと右の枠に開く。スレッドと同じ枠で、幅も共有する。 */
export const PanelOther: Story = {
  name: "パネル（他人）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-other" }),
};

/** 3 点メニュー。操作できない相手には、コピーの 2 つだけが出る。 */
export const PanelMenu: Story = {
  name: "パネル（メニュー）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-menu" }),
};

/** 操作できる相手（管理者から見た member）。ロールの変更と削除がメニューに足される（ADR 0029 の写し）。 */
export const PanelManage: Story = {
  name: "パネル（操作できる相手のメニュー）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-manage" }),
};

/** 自分のパネル。「DM を送る」の代わりに「プロフィールを編集」。 */
export const PanelSelf: Story = {
  name: "パネル（自分）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-self" }),
};

/** email だけは 1 人分の API の応答を待つ。行の高さは先に取っておく（ADR 0050 決定 1）。 */
export const PanelEmailLoading: Story = {
  name: "パネル（email の読み込み中）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-loading" }),
};

/** email が未検証なら、連絡先の節もコピーも出さない（ADR 0050 決定 2）。 */
export const PanelEmailUnverified: Story = {
  name: "パネル（email が未検証）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-unverified" }),
};

export const PanelFormer: Story = {
  name: "パネル（外された人）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-former" }),
};

/** 外された人のパネルを URL から開き直したとき。手がかりがないので名前も出せない。 */
export const PanelUnknown: Story = {
  name: "パネル（開き直して見つからない）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-unknown" }),
};

/** メンバーパネルの行から開くと、右の枠が入れ替わり、左上に「メンバーに戻る」が出る。 */
export const PanelFromMembers: Story = {
  name: "パネル（メンバーから開いた）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "panel-from-members" }),
};

export const PanelMenuDark: Story = {
  name: "パネル（メニュー・ダーク）",
  tags: ["since:6.9"],
  parameters: { theme: "dark" },
  render: () => chat({ profile: "panel-menu", dark: true }),
};

/** モバイルは押すと全画面（スレッドと同じ）。ホバーのカードは出ない。 */
export const MobilePanel: Story = {
  name: "パネル（モバイル）",
  tags: ["since:6.9"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ profile: "panel-other" }),
};
