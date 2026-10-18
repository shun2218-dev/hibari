import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { users } from "@/stories/fixtures/users";

import { MessageReactions } from "./message-reactions";

/**
 * メッセージの下に並ぶ絵文字のリアクション（ADR 0044）。
 * チップは押せる要素なので、**自分が付けている状態は緑**（`docs/ui/tokens.md` の「緑 = 操作できるもの」）。
 * 数は受け取った値をそのまま出す（楽観的更新はデータ層の仕事）。
 */
const meta = {
  title: "components/chat/MessageReactions",
  component: MessageReactions,
  tags: ["autodocs"],
  args: {
    reactions: [
      { emoji: "👍", count: 5, me: true, names: [users.you.name, users.naoki.name, users.ryo.name, users.miyuki.name, users.misaki.name] },
      { emoji: "🎉", count: 2, me: false, names: [users.naoki.name, users.miyuki.name] },
      { emoji: "👀", count: 1, me: false, names: [users.ryo.name] },
    ],
    onToggle: () => {},
    onAdd: () => {},
  },
  decorators: [(Story) => <div className="w-150">{Story()}</div>],
} satisfies Meta<typeof MessageReactions>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Row: Story = { name: "付いている行" };

/** チップにホバーすると、付けた人の名前が出る（API が返すのは先頭 8 人まで）。 */
export const Names: Story = { name: "誰が付けたか", args: { forceHoverEmoji: "👍" } };

/** 投稿できない人（参加していない public ルーム）には「＋」を出さない（ADR 0044 決定 6）。 */
export const ReadOnly: Story = { name: "付けられない人", args: { onToggle: undefined, onAdd: undefined } };

/** 1 件も無ければ行そのものを出さない（「＋」を渡したときだけ空の行を出す）。 */
export const Empty: Story = { name: "1 件も付いていない", args: { reactions: [] } };
