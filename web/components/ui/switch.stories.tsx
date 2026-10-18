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

/** 切り替わるところ（story の中で状態を持つ）。 */
export const Interactive: Story = {
  name: "切り替えられる",
  render: function Interactive(args) {
    const [checked, setChecked] = useState(false);
    return <Switch {...args} checked={checked} onChange={setChecked} />;
  },
};
