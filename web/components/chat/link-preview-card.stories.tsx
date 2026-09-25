import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { fullPreview, minimalPreview, textOnlyPreview } from "@/stories/fixtures/link-previews";

import { LinkPreviewCard } from "./link-preview-card";

/**
 * 外部のリンクのプレビュー（ADR 0065）。中身は投稿した時点でサーバーが取ったもの。
 * 画像とサイトのアイコンは自前のストレージの署名付き URL で、取れるまでは枠だけを出す。
 * `onRemove` は投稿した本人のメッセージのときだけ渡す（「x」はホバーかフォーカスで出る）。
 */
const meta = {
  title: "components/chat/LinkPreviewCard",
  component: LinkPreviewCard,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="w-150 p-4">{Story()}</div>],
  args: { preview: fullPreview },
} satisfies Meta<typeof LinkPreviewCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Full: Story = { name: "画像・アイコン・説明あり" };

export const TextOnly: Story = { name: "画像なし", args: { preview: textOnlyPreview } };

export const Minimal: Story = { name: "タイトルだけ（アイコンなし）", args: { preview: minimalPreview } };

/** 画像とアイコンの署名付き URL を取る前。寸法から枠だけを確保する。 */
export const Loading: Story = {
  name: "画像とアイコンの URL を取る前",
  args: { preview: { ...fullPreview, image: { width: 1200, height: 630 }, iconUrl: undefined } },
};

export const Removable: Story = {
  name: "本人のカード（「x」）",
  args: { onRemove: () => {}, forceRemoveVisible: true },
};
