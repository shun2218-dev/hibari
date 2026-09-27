import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { HuddleDeviceMenu, HuddlePreview } from "@/components/chat/huddle-preview";
import { HuddleProblemScreen, HuddleScreen } from "@/components/chat/huddle-screen";
import {
  huddlePreview,
  huddlePreviewJoin,
  huddlePreviewArchived,
  huddlePreviewMicDenied,
  huddlePreviewNotMember,
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
 * チャット / ハドル（ADR 0066。Phase 6.18a の音声のハドル。ADR 0067。6.18c の一覧・ハドル中の印・リンク）。
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

/** 操作の列の「…」（ハドルミーティングのリンクをコピー。ADR 0067 決定 1）。実画面と同じく、いつも出す。 */
const closedMenu = { open: false };

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
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreen} />,
};

export const ScreenDark: Story = {
  name: "ハドルの画面（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark" },
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreen} />,
};

export const ScreenChat: Story = {
  name: "ハドルの画面: ハドルのチャット",
  tags: ["since:6.18"],
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreen} chat={huddleChatPanel(huddleScreen.room)} chatOpen />,
};

export const ScreenMuted: Story = {
  name: "ハドルの画面: 自分がミュート",
  tags: ["since:6.18"],
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreenMuted} />,
};

export const ScreenDeviceMenu: Story = {
  name: "ハドルの画面: マイクとスピーカーを選ぶ",
  tags: ["since:6.18"],
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreen} deviceMenu={<HuddleDeviceMenu {...devices} />} />,
};

export const ScreenConnecting: Story = {
  name: "ハドルの画面: 接続している",
  tags: ["since:6.18"],
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreenConnecting} />,
};

export const ScreenReconnecting: Story = {
  name: "ハドルの画面: 再接続している",
  tags: ["since:6.18"],
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreenReconnecting} />,
};

export const ScreenJoiningSoon: Story = {
  name: "ハドルの画面: DM で相手が「もうすぐ参加する」を押した",
  tags: ["since:6.18"],
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreenJoiningSoon} />,
};

export const ScreenCrowded: Story = {
  name: "ハドルの画面: 大人数",
  tags: ["since:6.18"],
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreenCrowded} />,
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
  render: () => <HuddleScreen menu={closedMenu} huddle={huddleScreen} />,
};

export const ScreenMenu: Story = {
  name: "ハドルの画面: 「…」（リンクをコピー）",
  tags: ["since:6.18"],
  render: () => <HuddleScreen huddle={huddleScreen} menu={{ open: true }} />,
};

// ---- ハドルへのリンク（ADR 0067 決定 1・2） ----

export const HeaderMenu: Story = {
  name: "ヘッダーの「⌄」: ハドルミーティングのリンクをコピー",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "header-menu" }),
};

export const JoinedMenu: Story = {
  name: "ハドルの帯の「…」: リンクをコピー",
  tags: ["since:6.18"],
  render: () => chat({ huddle: "joined-menu" }),
};

export const LinkCards: Story = {
  name: "本文のハドルのリンクのカード（進行中でない・進行中・参加中・読めない）",
  tags: ["since:6.18"],
  // 4 つの状態を 1 枚に収めるため、縦を伸ばして撮る
  parameters: { screenshot: { size: "1280x1200" } },
  render: () => chat({ huddle: "link-cards" }),
};

export const LinkCardsDark: Story = {
  name: "本文のハドルのリンクのカード（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark", screenshot: { size: "1280x1200" } },
  render: () => chat({ huddle: "link-cards" }),
};

export const PreviewNotMember: Story = {
  name: "リンクから開いたプレビュー: 参加していないチャンネル",
  tags: ["since:6.18"],
  render: () => <HuddlePreview preview={huddlePreviewNotMember} />,
};

export const PreviewArchived: Story = {
  name: "リンクから開いたプレビュー: アーカイブしたチャンネル",
  tags: ["since:6.18"],
  render: () => <HuddlePreview preview={huddlePreviewArchived} />,
};

// ---- ハドルの一覧（ADR 0067 決定 6〜8） ----

export const List: Story = {
  name: "ハドルの一覧",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "list" }),
};

export const ListDark: Story = {
  name: "ハドルの一覧（ダーク）",
  tags: ["since:6.18"],
  parameters: { theme: "dark" },
  render: () => chat({ huddles: "list" }),
};

export const ListRowMenu: Story = {
  name: "ハドルの一覧: 行の「…」",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "row-menu" }),
};

export const ListParticipants: Story = {
  name: "ハドルの一覧: 参加者を表示する",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "participants" }),
};

export const ListScope: Story = {
  name: "ハドルの一覧: 範囲を選ぶ",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "scope" }),
};

export const ListMissed: Story = {
  name: "ハドルの一覧: 参加しなかったハドルミーティング",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "missed" }),
};

export const ListPerson: Story = {
  name: "ハドルの一覧: 相手を選ぶ",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "person" }),
};

export const ListFiltered: Story = {
  name: "ハドルの一覧: 相手で絞り込んだ",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "filtered" }),
};

export const ListEmpty: Story = {
  name: "ハドルの一覧: まだ何もない",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "empty" }),
};

export const MobileList: Story = {
  name: "ハドルの一覧（モバイル）",
  tags: ["since:6.18"],
  ...mobile,
  render: () => chat({ huddles: "list" }),
};

export const NewHuddle: Story = {
  name: "新規ハドルミーティング",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "list", newHuddle: "empty" }),
};

export const NewHuddleSelected: Story = {
  name: "新規ハドルミーティング: 検索してチャンネルを選んだ",
  tags: ["since:6.18"],
  render: () => chat({ huddles: "list", newHuddle: "selected" }),
};

export const Saved: Story = {
  name: "「後で」に保存したハドルミーティング",
  tags: ["since:6.18"],
  render: () => chat({ side: "later", saved: "in_progress", savedHuddle: true }),
};

// ---- ハドル中の印（ADR 0067 決定 4） ----

export const StatusMembers: Story = {
  name: "ハドル中の印: メンバーパネル",
  tags: ["since:6.18"],
  render: () => chat({ members: true, huddleStatus: "members" }),
};

export const StatusProfile: Story = {
  name: "ハドル中の印: ステータスのない人のカード",
  tags: ["since:6.18"],
  render: () => chat({ huddleStatus: "profile" }),
};

export const StatusProfileWithStatus: Story = {
  name: "ハドル中の印: ステータスを設定している人のカード",
  tags: ["since:6.18"],
  render: () => chat({ huddleStatus: "profile-status" }),
};
