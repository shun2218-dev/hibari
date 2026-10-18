import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Spinner } from "./spinner";

/**
 * 回転するリング。色は親の文字色（`currentColor`）に合わせる。
 */
const meta = {
  title: "components/ui/Spinner",
  component: Spinner,
  tags: ["autodocs"],
} satisfies Meta<typeof Spinner>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "既定（本文の色）" };

export const OnText: Story = {
  name: "文字と並べる",
  render: () => (
    <div className="flex flex-col gap-3 text-text-secondary">
      <span className="flex items-center gap-2 text-sm">
        <Spinner /> 再接続しています…
      </span>
      <span className="flex items-center gap-2 text-sm text-primary">
        <Spinner className="size-4" /> 確認しています…
      </span>
    </div>
  ),
};
