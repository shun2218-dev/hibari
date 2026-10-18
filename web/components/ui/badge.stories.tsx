import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge, UnreadBadge } from "./badge";

/**
 * 状態やロールを表す小さなラベル。押せる要素ではない。
 */
const meta = {
  title: "components/ui/Badge",
  component: Badge,
  tags: ["autodocs"],
  args: { tone: "neutral", children: "メンバー" },
  argTypes: { tone: { control: "inline-radio", options: ["neutral", "primary", "attention", "danger"] } },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  name: "種類の一覧",
  render: () => (
    <div className="flex items-center gap-3">
      <Badge>メンバー</Badge>
      <Badge tone="primary">管理者</Badge>
      <Badge tone="attention">オーナー</Badge>
      <Badge tone="danger">取り消し済み</Badge>
    </div>
  ),
};

/**
 * 知らせが要るものの数。**琥珀＝いま起きていること**なので primary は使わない（`docs/ui/tokens.md`）。
 * チャンネルは自分宛ての数を `@N`、DM は未読の数をそのまま出す（ADR 0043）。0 のときは何も出さない。
 */
export const Unread: Story = {
  name: "UnreadBadge（未読とメンション）",
  render: () => (
    <div className="flex items-center gap-3">
      <UnreadBadge count={3} />
      <UnreadBadge count={2} mention />
      <UnreadBadge count={128} />
      <span className="text-2xs text-text-muted">0 件は出ない →</span>
      <UnreadBadge count={0} />
    </div>
  ),
};
