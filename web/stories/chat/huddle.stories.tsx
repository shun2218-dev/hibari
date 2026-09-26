import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { HuddleDeviceMenu, HuddlePreview } from "@/components/chat/huddle-preview";
import { HuddleProblemScreen, HuddleScreen } from "@/components/chat/huddle-screen";
import {
  huddlePreview,
  huddlePreviewJoin,
  huddlePreviewMicDenied,
  huddleProblemRoom,
  huddleScreen,
  huddleScreenConnecting,
  huddleScreenCrowded,
  huddleScreenJoiningSoon,
  huddleScreenMuted,
  huddleScreenReconnecting,
} from "@/stories/fixtures/huddles";
import { chat, huddleChatPanel } from "@/stories/screens/chat";
import { noop } from "@/stories/screens/shared";

/**
 * チャット / ハドル（ADR 0066。Phase 6.18a の音声のハドル）。
 *
 * チャットのタブの見え方は chat() で、ハドルのタブ（参加前のプレビューとハドルの画面。追記 B・C）は部品を直接描く。
 * ハドルのタブは about:blank に描く別の画面なので、チャットの枠（サイドバーなど）を持たない。
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

const devices = {
  mics: huddlePreview.mics,
  micId: huddlePreview.micId,
  speakers: huddlePreview.speakers,
  speakerId: huddlePreview.speakerId,
};

// ---- チャットのタブ ----

export const Active: Story = {
  name: "チャンネルで進行中（入っていない）",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "active" }),
};

export const Joined: Story = {
  name: "入っている（ハドルのタブを閉じて、下の帯）",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "joined" }),
};

export const JoinedDark: Story = {
  name: "入っている（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark" },
  render: () => chat({ huddle: "joined" }),
};

export const MobileJoined: Story = {
  name: "入っている（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => chat({ huddle: "joined" }),
};

export const JoinedChat: Story = {
  name: "ハドルのチャットをスレッドで開いた",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "joined-chat" }),
};

export const Ended: Story = {
  name: "終わったハドルのメッセージ",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "ended" }),
};

export const EndedDark: Story = {
  name: "終わったハドルのメッセージ（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark" },
  render: () => chat({ huddle: "ended" }),
};

export const DmRing: Story = {
  name: "DM の呼び出し",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "dm-ring" }),
};

export const DmMissed: Story = {
  name: "DM: 不在着信と応答なし",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "dm-missed" }),
};

export const MobileDmRing: Story = {
  name: "DM の呼び出し（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => chat({ huddle: "dm-ring", mobileView: "list" }),
};

// ---- 参加前のプレビュー（追記 B） ----

export const Preview: Story = {
  name: "参加前のプレビュー",
  tags: ["since:6.18"],
  render: () => <HuddlePreview preview={huddlePreview} onCancel={noop} onStart={noop} />,
};

export const PreviewDark: Story = {
  name: "参加前のプレビュー（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark" },
  render: () => <HuddlePreview preview={huddlePreview} onCancel={noop} onStart={noop} />,
};

export const PreviewMicMenu: Story = {
  name: "参加前のプレビュー: マイクを選ぶ",
  tags: ["since:6.18"],
  render: () => <HuddlePreview preview={huddlePreview} openMenu="mic" />,
};

export const PreviewJoinMuted: Story = {
  name: "参加前のプレビュー: 進行中に参加（マイクをオフ）",
  tags: ["since:6.18"],
  render: () => <HuddlePreview preview={huddlePreviewJoin} />,
};

export const PreviewMicDenied: Story = {
  name: "参加前のプレビュー: マイクを使えない",
  tags: ["since:6.18"],
  render: () => <HuddlePreview preview={huddlePreviewMicDenied} />,
};

export const MobilePreview: Story = {
  name: "参加前のプレビュー（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => <HuddlePreview preview={huddlePreview} />,
};

// ---- ハドルの画面（追記 C） ----

export const Screen: Story = {
  name: "ハドルの画面",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreen} />,
};

export const ScreenDark: Story = {
  name: "ハドルの画面（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark" },
  render: () => <HuddleScreen huddle={huddleScreen} />,
};

export const ScreenChat: Story = {
  name: "ハドルの画面: ハドルのチャット",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreen} chat={huddleChatPanel(huddleScreen.room)} chatOpen />,
};

export const ScreenMuted: Story = {
  name: "ハドルの画面: 自分がミュート",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreenMuted} />,
};

export const ScreenDeviceMenu: Story = {
  name: "ハドルの画面: マイクとスピーカーを選ぶ",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreen} deviceMenu={<HuddleDeviceMenu {...devices} />} />,
};

export const ScreenConnecting: Story = {
  name: "ハドルの画面: 接続している",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreenConnecting} />,
};

export const ScreenReconnecting: Story = {
  name: "ハドルの画面: 再接続している",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreenReconnecting} />,
};

export const ScreenJoiningSoon: Story = {
  name: "ハドルの画面: DM で相手が「もうすぐ参加する」を押した",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreenJoiningSoon} />,
};

export const ScreenCrowded: Story = {
  name: "ハドルの画面: 大人数",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreenCrowded} />,
};

export const ScreenFull: Story = {
  name: "ハドルの画面: 人数の上限",
  tags: ["since:6.18"],
  render: () => <HuddleProblemScreen problem="full" room={huddleProblemRoom} />,
};

export const ScreenDisconnected: Story = {
  name: "ハドルの画面: 切断された",
  tags: ["since:6.18"],
  render: () => <HuddleProblemScreen problem="disconnected" room={huddleProblemRoom} />,
};

export const MobileScreen: Story = {
  name: "ハドルの画面（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => <HuddleScreen huddle={huddleScreen} />,
};
