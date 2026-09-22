import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens/chat";

/**
 * チャット / スレッド。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-thread--…` ↔ `chat/thread/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "チャット/スレッド",
  // PNG のパス（chat/thread/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "chat-thread",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ThreadPanel: Story = {
  name: "スレッドのパネル",
  tags: ["since:6.5"],
  render: () => chat({ thread: "replies" }),
};

export const ThreadPanelEmpty: Story = {
  name: "スレッドのパネル: 返信が 0 件",
  tags: ["since:6.5"],
  render: () => chat({ thread: "empty" }),
};

export const ThreadRootDeleted: Story = {
  name: "スレッドのパネル: 親が削除された",
  tags: ["since:6.5"],
  render: () => chat({ thread: "root-deleted" }),
};

export const ThreadBroadcast: Story = {
  name: "チャンネルにも投稿した返信",
  tags: ["since:6.6"],
  render: () => chat({ thread: "broadcast" }),
};

export const Threads: Story = {
  name: "参加しているスレッドの一覧",
  tags: ["since:6.5"],
  render: () => chat({ threads: "list" }),
};

export const ThreadsEmpty: Story = {
  name: "参加しているスレッドが 0 件",
  tags: ["since:6.5"],
  render: () => chat({ threads: "empty" }),
};

export const MobileThread: Story = {
  name: "スレッド（モバイル）",
  tags: ["since:6.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ thread: "replies" }),
};

export const MobileThreadBroadcast: Story = {
  name: "スレッド: チャンネルにも投稿（モバイル）",
  tags: ["since:6.6"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ thread: "broadcast" }),
};

export const MobileRoomBroadcast: Story = {
  name: "チャンネルにも投稿した返信（モバイル）",
  tags: ["since:6.6"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ broadcastInChannel: true }),
};

export const MobileThreads: Story = {
  name: "参加しているスレッドの一覧（モバイル）",
  tags: ["since:6.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ threads: "list" }),
};

export const RootMenuNotify: Story = {
  name: "スレッドの親の「…」: 返信の通知をオフにする",
  tags: ["since:6.14"],
  render: () => chat({ threadNotify: "menu" }),
};

export const RootMenuFollow: Story = {
  name: "スレッドの親の「…」: 新しい返信の通知を受け取る",
  tags: ["since:6.14"],
  render: () => chat({ threadNotify: "menu-follow" }),
};

export const ThreadsNotifyOff: Story = {
  name: "参加しているスレッドの一覧: 返信の通知をオフにした行",
  tags: ["since:6.14"],
  render: () => chat({ threads: "notify-off" }),
};

export const ThreadsNotifyOffDark: Story = {
  name: "参加しているスレッドの一覧: 返信の通知をオフにした行（ダーク）",
  tags: ["since:6.14"],
  parameters: { theme: "dark" },
  render: () => chat({ threads: "notify-off", dark: true }),
};

export const ThreadsRowMenu: Story = {
  name: "参加しているスレッドの一覧: 行の「その他」",
  tags: ["since:6.14"],
  render: () => chat({ threads: "row-menu" }),
};

export const MobileThreadsNotifyOff: Story = {
  name: "参加しているスレッドの一覧: 返信の通知をオフにした行（モバイル）",
  tags: ["since:6.14"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ threads: "notify-off" }),
};
