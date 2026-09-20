import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ButtonLink, TextLink } from "./link";

/**
 * 遷移するものは `button` ではなく `a` にする（新しいタブで開ける・履歴に残る）。
 */
const meta = {
  title: "components/ui/Link",
  component: TextLink,
  tags: ["autodocs"],
  args: { href: "#", children: "パスワードをお忘れですか？" },
  decorators: [(Story) => <div className="w-100">{Story()}</div>],
} satisfies Meta<typeof TextLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Text: Story = { name: "TextLink（文中のリンク）" };

export const Button: Story = {
  name: "ButtonLink（全幅。見た目は secondary ボタン）",
  render: () => <ButtonLink href="#">ログインに戻る</ButtonLink>,
};
