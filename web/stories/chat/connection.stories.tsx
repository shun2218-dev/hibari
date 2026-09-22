import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ServerUnavailable } from "@/components/chat/chat-states";

import { chat } from "@/stories/screens";

/**
 * チャット / 接続と同期。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-connection--…` ↔ `chat/connection/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/接続と同期",
  // PNG のパス（chat/connection/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-connection",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const BannerReconnecting: Story = {
  name: "再接続中バナー",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ banner: "reconnecting" }),
};

export const BannerSyncing: Story = {
  name: "同期中バナー",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ banner: "syncing" }),
};

export const BannerRestored: Story = {
  name: "復帰バナー",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ banner: "restored" }),
};

export const ServerError: Story = {
  name: "サーバーに接続できない",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => <ServerUnavailable lastConnectedLabel="11:07" retryCount={3} />,
};
