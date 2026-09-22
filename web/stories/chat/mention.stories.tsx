import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ConfirmMentionAllDialog } from "@/components/chat/room-dialogs";

import { selectedRoom } from "@/stories/fixtures";
import { chat } from "@/stories/screens";

/**
 * チャット / メンション。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-mention--…` ↔ `chat/mention/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/メンション",
  // PNG のパス（chat/mention/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-mention",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mentions: Story = {
  name: "メンション（自分宛て・@channel・@here）",
  tags: ["since:6.13"],
  render: () => chat({ mentions: true }),
};

export const MentionsDark: Story = {
  name: "メンション（ダーク）",
  tags: ["since:6.13"],
  parameters: { theme: "dark" },
  render: () => chat({ mentions: true }),
};

export const MentionCompletion: Story = {
  name: "メンション: @ の補完",
  tags: ["since:6.13"],
  render: () => chat({ mentions: true, mentionQuery: "" }),
};

export const MentionCompletionTyped: Story = {
  name: "メンション: 名前で絞った補完",
  tags: ["since:6.13"],
  render: () => chat({ mentions: true, mentionQuery: "n" }),
};

export const MentionAllConfirm: Story = {
  name: "メンション: @channel を送る前の確認",
  tags: ["since:6.13"],
  render: () =>
    chat({ mentions: true, dialog: <ConfirmMentionAllDialog open kind="channel" memberCount={selectedRoom.memberCount} /> }),
};

export const MobileMentions: Story = {
  name: "メンション（モバイル）",
  tags: ["since:6.13"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ mentions: true }),
};

export const MobileMentionCompletion: Story = {
  name: "メンション: @ の補完（モバイル）",
  tags: ["since:6.13"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ mentions: true, mentionQuery: "" }),
};
