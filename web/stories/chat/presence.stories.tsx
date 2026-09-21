import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "../screens";

/**
 * チャット / 離席とカスタムステータス（Phase 6.8。ADR 0049）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-presence--…` ↔ `chat/presence/….png`）。
 */
const meta = {
  title: "チャット/離席とステータス",
  id: "chat-presence",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/** 3 つの状態（オンライン・離席・オフライン）が並ぶメンバーパネル。 */
export const AwayDots: Story = {
  name: "離席のドット",
  tags: ["since:6.8"],
  render: () => chat({ presence: true, members: true }),
};

export const AwayDotsDark: Story = {
  name: "離席のドット（ダーク）",
  tags: ["since:6.8"],
  parameters: { theme: "dark" },
  render: () => chat({ presence: true, members: true, dark: true }),
};

/** 名前の横とサイドバーの DM に出るステータスの絵文字（文言はホバーで読む）。 */
export const StatusInTimeline: Story = {
  name: "名前の横のステータス",
  tags: ["since:6.8"],
  render: () => chat({ presence: true }),
};

/** 自分のステータスと離席の切り替えは、アカウントメニューから。 */
export const AccountMenuStatus: Story = {
  name: "アカウントメニュー（ステータスと離席）",
  tags: ["since:6.8"],
  render: () => chat({ presence: true, accountMenu: true }),
};

export const StatusDialogEmpty: Story = {
  name: "ステータスを設定（未設定）",
  tags: ["since:6.8"],
  render: () => chat({ statusDialog: "empty" }),
};

export const StatusDialogFilled: Story = {
  name: "ステータスを設定（設定済み）",
  tags: ["since:6.8"],
  render: () => chat({ presence: true, statusDialog: "filled" }),
};

export const StatusDialogDark: Story = {
  name: "ステータスを設定（ダーク）",
  tags: ["since:6.8"],
  parameters: { theme: "dark" },
  render: () => chat({ presence: true, statusDialog: "filled", dark: true }),
};

/** 絵文字は 6.7 のピッカーをそのまま使う。ダイアログの中に下向きに開く（ADR 0049 決定 10）。 */
export const StatusDialogPicker: Story = {
  name: "ステータス: 絵文字のピッカー",
  tags: ["since:6.8"],
  render: () => chat({ presence: true, statusDialog: "picker" }),
};

/** 「日時を選択」を選ぶと、日付と時刻のボタンが下に出る。 */
export const StatusDialogCustom: Story = {
  name: "ステータスを設定（日時を選択）",
  tags: ["since:6.8"],
  render: () => chat({ presence: true, statusDialog: "custom" }),
};

/** 日付のボタンを押すと、自前のカレンダーが開く（ブラウザ標準の入力は使わない）。 */
export const StatusDialogCalendar: Story = {
  name: "ステータスを設定（カレンダー）",
  tags: ["since:6.8"],
  render: () => chat({ presence: true, statusDialog: "calendar" }),
};

/** 時刻は「候補の一覧 + 自由入力」。打った文字（`17`）で候補が絞られる。 */
export const StatusDialogTime: Story = {
  name: "ステータスを設定（時刻の候補）",
  tags: ["since:6.8"],
  render: () => chat({ presence: true, statusDialog: "time" }),
};

export const MobileStatusDialog: Story = {
  name: "ステータスを設定（モバイル）",
  tags: ["since:6.8"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ presence: true, statusDialog: "filled" }),
};

/** モバイルのメンバーは下から出るシート。離席とステータスもここに出る。 */
export const MobileAwayDots: Story = {
  name: "離席のドット（モバイル）",
  tags: ["since:6.8"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ presence: true, members: true }),
};
