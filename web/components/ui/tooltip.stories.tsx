import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { IconButton } from "./button";
import { MoreIcon, ReplyIcon } from "./icons";
import { Tooltip } from "./tooltip";

/**
 * アイコンだけのボタンに、ホバーで名前を出す吹き出し。
 * 読み上げにはボタンの aria-label で伝えるので、吹き出しは aria-hidden。
 */
const meta = {
  title: "components/ui/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  args: { label: "スレッドで返信する", children: null },
  decorators: [(Story) => <div className="flex justify-end p-10">{Story()}</div>],
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Hover: Story = {
  name: "ホバーで出す",
  render: (args) => (
    <Tooltip {...args}>
      <IconButton label={args.label}>
        <ReplyIcon className="size-4" />
      </IconButton>
    </Tooltip>
  ),
};

export const Aligns: Story = {
  name: "寄せる向き（固定で表示）",
  render: () => (
    <div className="flex gap-2">
      <Tooltip label="スレッドで返信する" force>
        <IconButton label="スレッドで返信する">
          <ReplyIcon className="size-4" />
        </IconButton>
      </Tooltip>
      {/* 端のボタンは右端をそろえ、はみ出して切れないようにする */}
      <Tooltip label="その他の操作" align="end" force>
        <IconButton label="その他の操作">
          <MoreIcon className="size-4" />
        </IconButton>
      </Tooltip>
    </div>
  ),
};
