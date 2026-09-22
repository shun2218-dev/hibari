import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { pendingMessageKey } from "@/stories/fixtures/timeline";
import { chat } from "@/stories/screens/chat";

/**
 * チャット / タイムライン。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-timeline--…` ↔ `chat/timeline/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/タイムライン",
  // PNG のパス（chat/timeline/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-timeline",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "チャット（未読・入力中）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat(),
};

export const DefaultDark: Story = {
  name: "チャット（ダーク）",
  tags: ["since:1.5"],
  parameters: { theme: "dark", screenshot: { source: "design" } },
  render: () => chat(),
};

export const MessagesAllStates: Story = {
  name: "メッセージの全状態",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "1280x1500", source: "design" } },
  render: () => chat(),
};

export const MessagesAllStatesDark: Story = {
  name: "メッセージの全状態（ダーク）",
  tags: ["since:1.5"],
  parameters: { theme: "dark", screenshot: { size: "1280x1500", source: "design" } },
  render: () => chat(),
};

export const MessageHoverActions: Story = {
  name: "メッセージのホバー操作",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ hoveredKey: pendingMessageKey }),
};

export const EmptyMessages: Story = {
  name: "メッセージが 0 件",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ body: "empty" }),
};

export const AvatarImages: Story = {
  name: "画像のアバター",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "640x360" } },
  render: () => chat({ avatars: true }),
};

export const SystemMessages: Story = {
  name: "参加・名前の変更のログ",
  tags: ["since:6.4"],
  render: () => chat({ systemMessages: true }),
};

export const MobileRoom: Story = {
  name: "ルーム（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat(),
};
