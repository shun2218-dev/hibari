import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button, TextButton } from "./button";

/**
 * 画面の操作。色の意味は `docs/ui/tokens.md`（緑＝操作できるもの、赤＝取り消せない破壊的な操作）。
 * 無効なときは種類によらず同じ見た目にする（押せないことが色より先に伝わるように）。
 */
const meta = {
  title: "components/ui/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "送信する", variant: "primary", size: "md", disabled: false },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["primary", "secondary", "danger", "danger-outline", "primary-outline"],
    },
    size: { control: "inline-radio", options: ["lg", "md", "sm"] },
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = { name: "primary（画面の主な操作）" };

export const Secondary: Story = { name: "secondary（キャンセル）", args: { variant: "secondary", children: "キャンセル" } };

export const Danger: Story = { name: "danger（破壊的な操作の確定）", args: { variant: "danger", children: "退出する" } };

export const Disabled: Story = { name: "押せない", args: { disabled: true } };

/** 種類と大きさの組み合わせ。`lg` は全幅なので、幅のある親の中で使う。 */
export const Matrix: Story = {
  name: "種類 × 大きさ",
  render: () => (
    <div className="flex w-100 flex-col gap-4">
      {(["primary", "secondary", "danger", "danger-outline", "primary-outline"] as const).map((variant) => (
        <div key={variant} className="flex items-center gap-2">
          <span className="w-30 shrink-0 text-xs text-text-secondary">{variant}</span>
          <Button variant={variant} size="md">
            md
          </Button>
          <Button variant={variant} size="sm">
            sm
          </Button>
          <Button variant={variant} size="md" disabled>
            押せない
          </Button>
        </div>
      ))}
      <Button variant="primary" size="lg">
        lg（全幅。認証カードのボタン）
      </Button>
    </div>
  ),
};

/** 文中や行末に置く、枠のないボタン（「再送する」「取り消す」）。 */
export const Text: Story = {
  name: "TextButton（枠なし）",
  render: () => (
    <div className="flex items-center gap-4">
      <TextButton>再送する</TextButton>
      <TextButton tone="danger">削除</TextButton>
      <TextButton disabled>再送する</TextButton>
    </div>
  ),
};
