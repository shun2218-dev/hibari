import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LogoMark } from "./logo";

/**
 * hibari のマーク（ADR 0063）。色はトークンなので、ダークのテーマではダークのマークになる。
 * 大きさは呼ぶ側が `size-*` で決める（認証の画面は size-10、ワークスペースの切り替えは size-4）。
 */
const meta = {
  title: "components/ui/LogoMark",
  component: LogoMark,
  tags: ["autodocs"],
  args: { className: "size-16" },
  argTypes: { className: { control: "text" } },
} satisfies Meta<typeof LogoMark>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "マーク" };

export const WithWordmark: Story = {
  name: "文字と並べる",
  render: () => (
    <div className="flex items-center gap-2.5">
      <LogoMark className="size-10" />
      <span className="text-2xl font-bold tracking-tight text-text">hibari</span>
    </div>
  ),
};

export const Dark: Story = { name: "ダーク", parameters: { theme: "dark" } };
