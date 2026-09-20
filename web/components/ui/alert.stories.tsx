import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Alert } from "./alert";

/**
 * 画面の中に置く注意書き。`danger` だけが `role="alert"` で読み上げられる。
 */
const meta = {
  title: "components/ui/Alert",
  component: Alert,
  tags: ["autodocs"],
  args: { tone: "danger", children: "メールアドレスまたはパスワードが違います。" },
  argTypes: { tone: { control: "inline-radio", options: ["danger", "attention", "locked"] } },
  decorators: [(Story) => <div className="w-100">{Story()}</div>],
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Danger: Story = { name: "danger（操作が失敗した）" };

export const Attention: Story = {
  name: "attention（いま知っておくべきこと）",
  args: { tone: "attention", children: "このリンクは再表示できません。いまコピーしてください。" },
};

export const Locked: Story = {
  name: "locked（権限が足りない理由）",
  args: { tone: "locked", children: "ワークスペースの設定を変更できるのは管理者とオーナーだけです。" },
};
