import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { Tabs } from "./tabs";
import { MessageIcon, PinIcon } from "./icons";

/**
 * タブの並び（ルームの「メッセージ / ピン」、「後で」の「進行中 / 完了」）。
 * 選んでいるタブは下線（緑）と太字で示し、左右の矢印キーで隣へ移る。
 */
const meta = {
  title: "components/ui/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  args: {
    label: "ルームのタブ",
    items: [
      { value: "messages", label: "メッセージ", icon: MessageIcon },
      { value: "pins", label: "ピン", icon: PinIcon },
    ],
    value: "messages",
  },
  decorators: [(Story) => <div className="w-110">{Story()}</div>],
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "アイコン付き" };

/** ラベルの後ろに件数を添える形（「後で」の「進行中」）。 */
export const WithCount: Story = {
  name: "件数付き",
  args: {
    label: "「後で」のタブ",
    items: [
      { value: "open", label: "進行中", count: 3 },
      { value: "done", label: "完了" },
    ],
    value: "open",
  },
};

/** 外側がすでに線を持つ置き場所では、下の線を引かない。 */
export const Borderless: Story = { name: "下線なし", args: { bordered: false } };

/** 選び替えられるところ（story の中で状態を持つ）。 */
export const Interactive: Story = {
  name: "選び替えられる",
  render: function Interactive(args) {
    const [value, setValue] = useState("messages");
    return <Tabs {...args} value={value} onChange={setValue} />;
  },
};
