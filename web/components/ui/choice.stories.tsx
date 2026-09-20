import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { Avatar } from "./avatar";
import { Badge } from "./badge";
import { ChoiceChip, RadioCard } from "./choice";

/**
 * 選択肢。どちらも本物の `input[type=radio]` を使い、キーボード操作と読み上げはブラウザに任せる。
 */
const meta = {
  title: "components/ui/Choice",
  component: RadioCard,
  tags: ["autodocs"],
  args: {
    name: "invite-policy",
    value: "admins_only",
    checked: true,
    disabled: false,
    title: "管理者のみ",
    description: "招待リンクを作成できるのは管理者とオーナーだけです。",
  },
  decorators: [(Story) => <div className="w-110">{Story()}</div>],
} satisfies Meta<typeof RadioCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Checked: Story = { name: "選んでいる" };

export const Unchecked: Story = { name: "選んでいない", args: { checked: false } };

export const Disabled: Story = { name: "選べない", args: { checked: false, disabled: true } };

/** アバターやロールを添える形（オーナーの譲渡先を選ぶ）。 */
export const WithLeading: Story = {
  name: "人を選ぶ",
  args: {
    title: "田中 美咲",
    description: undefined,
    leading: <Avatar id="01J8ZH5K000000000000000009" name="田中 美咲" size="md" />,
    trailing: <Badge tone="primary">管理者</Badge>,
  },
};

/** 横に並べる丸い選択肢（招待リンクの使用回数・有効期限）。 */
export const Chips: Story = {
  name: "ChoiceChip（横に並べる）",
  render: function Chips() {
    const [value, setValue] = useState("10");
    return (
      <div className="flex items-center gap-2">
        {["1", "10", "50", "無制限"].map((option) => (
          <ChoiceChip key={option} name="max-uses" value={option} checked={value === option} onChange={setValue}>
            {option}
          </ChoiceChip>
        ))}
      </div>
    );
  },
};

/** 選んだものが変わるところ（story の中で状態を持つ）。 */
export const Interactive: Story = {
  name: "選び替えられる",
  render: function Interactive() {
    const [value, setValue] = useState("admins_only");
    return (
      <div className="flex flex-col gap-2">
        <RadioCard
          name="policy"
          value="admins_only"
          checked={value === "admins_only"}
          onChange={setValue}
          title="管理者のみ"
          description="招待リンクを作成できるのは管理者とオーナーだけです。"
        />
        <RadioCard
          name="policy"
          value="all_members"
          checked={value === "all_members"}
          onChange={setValue}
          title="メンバー全員"
          description="ワークスペースのメンバーなら誰でも招待リンクを作成できます。"
        />
      </div>
    );
  },
};
