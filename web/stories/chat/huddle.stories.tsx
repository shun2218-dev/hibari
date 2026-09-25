import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { chat } from "@/stories/screens/chat";

/**
 * チャット / ハドル（ADR 0066。Phase 6.18a の音声のハドル）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat-huddle--…` ↔ `chat/huddle/….png`。ADR 0047 決定 2）。
 */
const meta = {
  title: "チャット/ハドル",
  id: "chat-huddle",
  tags: ["screenshot"],
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const mobile = {
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
} as const;

export const Active: Story = {
  name: "チャンネルで進行中（入っていない）",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "active" }),
};

export const Joined: Story = {
  name: "入っている",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "joined" }),
};

export const JoinedDark: Story = {
  name: "入っている（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark" },
  render: () => chat({ huddle: "joined" }),
};

export const Muted: Story = {
  name: "自分がミュートしている",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "muted" }),
};

export const Connecting: Story = {
  name: "接続している",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "connecting" }),
};

export const Reconnecting: Story = {
  name: "再接続している",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "reconnecting" }),
};

export const Ended: Story = {
  name: "終わったハドルのメッセージ",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "ended" }),
};

export const DmRing: Story = {
  name: "DM の呼び出し",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "dm-ring" }),
};

export const DmJoiningSoon: Story = {
  name: "DM: 相手が「もうすぐ参加する」を押した",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "dm-joining-soon" }),
};

export const DmMissed: Story = {
  name: "DM: 不在着信と応答なし",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "dm-missed" }),
};

export const MicDenied: Story = {
  name: "マイクを使えない",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "mic-denied" }),
};

export const Full: Story = {
  name: "人数の上限",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "full" }),
};

export const Disconnected: Story = {
  name: "切断された",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "disconnected" }),
};

export const MobileJoined: Story = {
  name: "入っている（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => chat({ huddle: "joined" }),
};

export const MobileJoinedList: Story = {
  name: "入っている: 一覧（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => chat({ huddle: "joined", mobileView: "list" }),
};

export const MobileDmRing: Story = {
  name: "DM の呼び出し（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => chat({ huddle: "dm-ring", mobileView: "list" }),
};
