import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens";

/**
 * チャット / リンクと移動。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-link--…` ↔ `chat/link/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/リンクと移動",
  // PNG のパス（chat/link/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-link",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const MessageLinkCard: Story = {
  name: "メッセージへのリンクのカード",
  tags: ["since:6.11"],
  render: () => chat({ linkCards: true }),
};

export const UnreadJumpBar: Story = {
  name: "未読へ飛ぶバー",
  tags: ["since:6.11"],
  render: () => chat({ jump: "unread-bar" }),
};

export const JumpHighlight: Story = {
  name: "飛んできた先の強調",
  tags: ["since:6.11"],
  render: () => chat({ jump: "highlight" }),
};

export const MessageNotFound: Story = {
  name: "リンク先のメッセージが見つからない",
  tags: ["since:6.11"],
  render: () => chat({ jump: "not-found" }),
};

export const MobileUnreadJumpBar: Story = {
  name: "未読へ飛ぶバー（モバイル）",
  tags: ["since:6.11"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ jump: "unread-bar" }),
};

export const MobileJumpHighlight: Story = {
  name: "飛んできた先の強調（モバイル）",
  tags: ["since:6.11"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ jump: "highlight" }),
};
