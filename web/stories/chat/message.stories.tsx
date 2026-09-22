import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DeleteMessageDialog } from "@/components/chat/dialogs/delete-message";

import { pendingMessageKey } from "@/stories/fixtures/timeline";
import { chat } from "@/stories/screens/chat";

/**
 * チャット / メッセージの操作。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-message--…` ↔ `chat/message/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/メッセージの操作",
  // PNG のパス（chat/message/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-message",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const MessageMenu: Story = {
  name: "メッセージの操作メニュー",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "640x380" } },
  render: () => chat({ menuKey: pendingMessageKey, hoveredKey: pendingMessageKey }),
};

export const MessageEditing: Story = {
  name: "メッセージの編集中",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "640x360" } },
  render: () => chat({ editingKey: pendingMessageKey }),
};

export const MessageDeleteDialog: Story = {
  name: "メッセージの削除",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "520x380" } },
  render: () =>
    chat({ dialog: <DeleteMessageDialog open body="了解です。今日の夕方までに一覧を更新して、また共有します。" /> }),
};
