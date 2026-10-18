import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { reactedMessageKey } from "@/stories/fixtures/reactions";
import { chat } from "@/stories/screens/chat";

/**
 * チャット / リアクション。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-reaction--…` ↔ `chat/reaction/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/リアクション",
  // PNG のパス（chat/reaction/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-reaction",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Reactions: Story = {
  name: "絵文字のリアクション",
  tags: ["since:6.7"],
  render: () => chat({ reactions: "row", hoveredKey: reactedMessageKey }),
};

export const ReactionsDark: Story = {
  name: "絵文字のリアクション（ダーク）",
  tags: ["since:6.7"],
  parameters: { theme: "dark" },
  render: () => chat({ reactions: "row", dark: true }),
};

export const ReactionNames: Story = {
  name: "リアクション: 誰が付けたか",
  tags: ["since:6.7"],
  render: () => chat({ reactions: "names" }),
};

export const ReactionPicker: Story = {
  name: "リアクション: 絵文字のピッカー",
  tags: ["since:6.7"],
  render: () => chat({ reactions: "picker" }),
};

export const ReactionPickerDark: Story = {
  name: "リアクション: 絵文字のピッカー（ダーク）",
  tags: ["since:6.7"],
  parameters: { theme: "dark" },
  render: () => chat({ reactions: "picker", dark: true }),
};

export const ReactionPickerAbove: Story = {
  name: "リアクション: ピッカーが上に開く",
  tags: ["since:6.7"],
  render: () => chat({ reactions: "picker-above" }),
};

export const ReactionPickerFromReactions: Story = {
  name: "リアクション: 行の「＋」から開いたピッカー",
  tags: ["since:6.16"],
  render: () => chat({ reactions: "picker-from-reactions" }),
};

export const MobileReactions: Story = {
  name: "絵文字のリアクション（モバイル）",
  tags: ["since:6.7"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ reactions: "row" }),
};

export const MobileReactionPicker: Story = {
  name: "リアクション: 絵文字のピッカー（モバイル）",
  tags: ["since:6.7"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ reactions: "picker" }),
};
