import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "./button";
import { Dialog } from "./dialog";

/**
 * モーダルダイアログ。開いたときにパネルへフォーカスを移し、閉じたら元の要素に戻す。
 * `onClose` を渡さなければ、Escape と背景のクリックでは閉じない（確定を待つダイアログ）。
 */
const meta = {
  title: "components/ui/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  args: {
    open: true,
    title: "チャンネルを退出しますか？",
    description: "デザインレビュー から退出します。公開チャンネルなので、退出したあとも読めます。",
    width: "default",
    actions: (
      <>
        <Button variant="secondary">キャンセル</Button>
        <Button variant="danger">退出する</Button>
      </>
    ),
  },
  argTypes: { width: { control: "inline-radio", options: ["default", "wide"] } },
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Confirm: Story = { name: "確認（既定の幅 400px）" };

export const Wide: Story = {
  name: "wide（440px。候補を並べるとき）",
  args: { width: "wide", title: "オーナーを譲渡する", description: "譲渡すると、あなたは管理者になります。" },
};

export const WithBody: Story = {
  name: "中身つき",
  args: {
    title: "チャンネルを作成",
    description: undefined,
    children: (
      <p className="text-sm leading-relaxed text-text-secondary">
        ここにフォームや候補の一覧を入れる。ボタンは `actions` に渡すと右寄せで並ぶ。
      </p>
    ),
  },
};
