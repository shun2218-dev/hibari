import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Calendar } from "./calendar";

/**
 * 日付を選ぶカレンダー（ADR 0049 の追記）。状態は持たないので、月も選んでいる日も引数で渡す。
 * ステータスの期限のほか、ピン留めの期限（6.12）や検索の期間（6.16）でも使えるようにしてある。
 */
const meta = {
  title: "components/ui/Calendar",
  component: Calendar,
  tags: ["autodocs"],
  args: { month: "2026-09", value: "2026-09-25", today: "2026-09-21", min: "2026-09-21" },
} satisfies Meta<typeof Calendar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "日付を選ぶ" };

/** 今日より前は押せない（過ぎた期限を作らせない）。 */
export const WithoutMin: Story = { name: "過去も選べる（min なし）", args: { min: undefined, value: undefined } };
