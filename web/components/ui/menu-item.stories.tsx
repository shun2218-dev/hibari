import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { MenuItem } from "./menu-item";
import { LinkIcon, PencilIcon, TrashIcon } from "./icons";

/**
 * メニュー（Popover）の 1 行。アイコンは読み上げず、文字が操作の名前になる。
 * 取り返しのつかない操作は danger にする。
 */
const meta = {
  title: "components/ui/MenuItem",
  component: MenuItem,
  tags: ["autodocs"],
  args: { icon: PencilIcon, children: "メッセージを編集" },
  decorators: [(Story) => <div className="w-64 rounded-md border border-border bg-surface p-1">{Story()}</div>],
} satisfies Meta<typeof MenuItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "ふつう" };

export const Danger: Story = { name: "取り返しがつかない", args: { icon: TrashIcon, children: "メッセージを削除", danger: true } };

/** アイコンのない行も、ほかの行と文字の頭をそろえる。 */
export const WithoutIcon: Story = { name: "アイコンなし", args: { icon: undefined, children: "リンクをコピー" } };

/** メニューとして並べたところ。 */
export const InMenu: Story = {
  name: "並べたところ",
  render: () => (
    <>
      <MenuItem icon={LinkIcon}>リンクをコピー</MenuItem>
      <MenuItem icon={PencilIcon}>メッセージを編集</MenuItem>
      <MenuItem icon={TrashIcon} danger>
        メッセージを削除
      </MenuItem>
    </>
  ),
};
