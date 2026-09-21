import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "../screens";

/**
 * チャット / プロフィールのカード（Phase 6.9。ADR 0050）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-profile--…` ↔ `chat/profile/….png`）。
 */
const meta = {
  title: "チャット/プロフィールのカード",
  id: "chat-profile",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/** 他人のカード。アバターの横に浮かせる。主ボタンは「DM を送る」。 */
export const Other: Story = {
  name: "他人のカード",
  tags: ["since:6.9"],
  render: () => chat({ profile: "other" }),
};

/** 3 点メニュー。操作できない相手には、コピーの 2 つだけが出る。 */
export const OtherMenu: Story = {
  name: "他人のカード（メニュー）",
  tags: ["since:6.9"],
  render: () => chat({ profile: "menu" }),
};

/** 操作できる相手（管理者から見た member）。ロールの変更と削除がメニューに足される（ADR 0029 の写し）。 */
export const ManageMenu: Story = {
  name: "操作できる相手のメニュー",
  tags: ["since:6.9"],
  render: () => chat({ profile: "manage" }),
};

/** 自分のカード。「DM を送る」の代わりに「プロフィールを編集」。 */
export const Self: Story = {
  name: "自分のカード",
  tags: ["since:6.9"],
  render: () => chat({ profile: "self" }),
};

/** email だけは 1 人分の API の応答を待つ。行の高さは先に取っておく（ADR 0050 決定 1）。 */
export const EmailLoading: Story = {
  name: "email の読み込み中",
  tags: ["since:6.9"],
  render: () => chat({ profile: "loading" }),
};

/** email が未検証なら、行もコピーも出さない（ADR 0050 決定 2）。 */
export const EmailUnverified: Story = {
  name: "email が未検証",
  tags: ["since:6.9"],
  render: () => chat({ profile: "unverified" }),
};

/** 外された人の過去のメッセージから開いた、縮めたカード（ADR 0050 決定 5）。 */
export const Former: Story = {
  name: "外された人のカード",
  tags: ["since:6.9"],
  render: () => chat({ profile: "former" }),
};

/** メンバーパネルの行から開くと、パネルの左に出る。 */
export const FromMembers: Story = {
  name: "メンバーパネルから",
  tags: ["since:6.9"],
  render: () => chat({ profile: "members", members: true }),
};

export const OtherMenuDark: Story = {
  name: "他人のカード（メニュー・ダーク）",
  tags: ["since:6.9"],
  parameters: { theme: "dark" },
  render: () => chat({ profile: "menu", dark: true }),
};

/** モバイルは下から出るシート（リアクションのピッカーと同じ出し方）。 */
export const MobileCard: Story = {
  name: "他人のカード（モバイル）",
  tags: ["since:6.9"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ profile: "other" }),
};
