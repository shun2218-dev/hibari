import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { Switch } from "./switch";

/**
 * オン・オフの切り替え（通知の設定・「未読だけ」の絞り込み）。
 * オンの地は緑（押せるもの。docs/ui/tokens.md）で、文字は左に置く。
 */
const meta = {
  title: "components/ui/Switch",
  component: Switch,
  tags: ["autodocs"],
  args: { label: "未読だけ", checked: false },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Off: Story = { name: "オフ" };

export const On: Story = { name: "オン", args: { checked: true } };

/** 押せない（オンのまま、ブラウザの許可の確認を待っている間。ADR 0069）。 */
export const Disabled: Story = { name: "押せない", args: { checked: true, disabled: true } };

/** 文字を読み上げだけにする（見出しの隣に置くとき）。 */
export const HiddenLabel: Story = { name: "文字なし", args: { label: "プッシュ通知", checked: true, hideLabel: true } };

/** 切り替わるところ（story の中で状態を持つ）。 */
export const Interactive: Story = {
  name: "切り替えられる",
  render: function Interactive(args) {
    const [checked, setChecked] = useState(false);
    return <Switch {...args} checked={checked} onChange={setChecked} />;
  },
};
