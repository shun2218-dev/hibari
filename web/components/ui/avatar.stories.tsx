import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { mockAvatars, users } from "@/stories/fixtures/users";

import { Avatar } from "./avatar";

/**
 * 人とワークスペースの顔。画像がなければ頭文字と、ID から決まる色にする（ADR 0020）。
 * 読み込みに失敗したら黙って頭文字に戻す（期限切れの署名付き URL でも画面が崩れないように）。
 */
const meta = {
  title: "components/ui/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  args: { id: users.miyuki.id, name: users.miyuki.name, size: "lg", shape: "circle", presence: "offline" },
  argTypes: {
    size: { control: "inline-radio", options: ["xs", "sm", "md", "lg", "xl", "message"] },
    shape: { control: "inline-radio", options: ["circle", "square"] },
    presence: { control: "inline-radio", options: ["online", "away", "offline"] },
  },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Initial: Story = { name: "頭文字（画像なし）" };

export const Online: Story = { name: "オンライン", args: { presence: "online" } };

/** 離席（ADR 0049）。色を持たないアウトラインで、オンラインの緑と見分ける。 */
export const Away: Story = { name: "離席中", args: { presence: "away" } };

export const Image: Story = { name: "画像あり", args: { imageUrl: mockAvatars.miyuki } };

/** 読み込めない URL を渡したとき。頭文字に戻る。 */
export const BrokenImage: Story = { name: "画像が読み込めない", args: { imageUrl: "/dev/does-not-exist.png" } };

export const Workspace: Story = { name: "ワークスペース（角丸の四角）", args: { shape: "square", name: "hibari 開発", size: "xl" } };

export const Sizes: Story = {
  name: "大きさの一覧",
  render: (args) => (
    <div className="flex items-end gap-4">
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Avatar {...args} size={size} />
          <span className="text-2xs text-text-muted">{size}</span>
        </div>
      ))}
    </div>
  ),
};

/** ID で色が決まるので、同じ頭文字でも人を見分けられる。 */
export const Colors: Story = {
  name: "ID で決まる色",
  render: () => (
    <div className="flex gap-3">
      {[users.miyuki, users.naoki, users.ryo, users.suzuki, users.you].map((user) => (
        <Avatar key={user.id} {...user} />
      ))}
    </div>
  ),
};
