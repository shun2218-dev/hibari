import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PasswordField, TextField } from "./field";

/**
 * ラベル・入力・補足をまとめた入力欄。ラベルと補足を input に結びつける id は `Field` が作る。
 * フォーカスリングは枠の内側に出す（`docs/ui/tokens.md`「フォーカス」）。
 */
const meta = {
  title: "components/ui/Field",
  component: TextField,
  tags: ["autodocs"],
  args: { label: "メールアドレス", placeholder: "you@example.com", disabled: false },
  decorators: [(Story) => <div className="w-100">{Story()}</div>],
} satisfies Meta<typeof TextField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Text: Story = { name: "TextField" };

export const WithHint: Story = {
  name: "補足つき",
  args: { label: "表示名", defaultValue: "高橋 みゆき", hint: "ワークスペースのメンバーに表示されます。" },
};

export const WithPrefix: Story = {
  name: "先頭の固定文字（ハンドル）",
  args: { label: "ハンドル", prefix: "@", mono: true, defaultValue: "miyuki" },
};

export const Disabled: Story = { name: "入力できない", args: { disabled: true, defaultValue: "you@example.com" } };

/** パスワードは目のボタンで表示を切り替えられる。強さは登録と再設定のときだけ出す。 */
export const Password: Story = {
  name: "PasswordField（強さつき）",
  render: () => (
    <div className="flex flex-col gap-6">
      <PasswordField label="パスワード" defaultValue="correct-horse" strength={{ level: 3, label: "良い" }} />
      <PasswordField label="新しいパスワード" defaultValue="horse" strength={{ level: 1, label: "短すぎます" }} />
      <PasswordField label="パスワード" placeholder="8 文字以上" />
    </div>
  ),
};
