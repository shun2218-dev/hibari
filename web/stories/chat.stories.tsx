import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ServerUnavailable } from "@/components/chat/chat-states";
import {
  AddRoomMemberDialog,
  ConfirmMentionAllDialog,
  CreateRoomDialog,
  DeleteAttachmentDialog,
  DeleteMessageDialog,
  LeaveRoomDialog,
  StartDmDialog,
} from "@/components/chat/room-dialogs";
import { NoWorkspaces } from "@/components/workspace/no-workspaces";

import { deletedAttachmentName, dmCandidates, pendingMessageKey, reactedMessageKey, selectedRoom, singleViewerImage, users, viewerImages } from "./fixtures";
import { chat, imageViewer, noop, roomHeaderFrame, roomSettingsDialog, sidebarFrame } from "./screens";

/**
 * チャット（ルーム・タイムライン・スレッド・リアクション・添付）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`chat--…` ↔ `chat/….png`。ADR 0047 決定 2）。
 * 表示名は `name`、足したフェーズは `since:` の tag、撮影の大きさと出どころは `parameters.screenshot` に置く。
 */
const meta = {
  title: "chat",
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

export const AttachmentUploading: Story = {
  name: "添付: アップロード中",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "uploading", progress: 62 }] }),
};

export const AttachmentFailed: Story = {
  name: "添付: 失敗",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "failed" }] }),
};

export const AttachmentDone: Story = {
  name: "添付: 完了",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "uploaded", sizeLabel: "1.8 MB" }] }),
};

export const EmptyRooms: Story = {
  name: "チャンネルが 0 件",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ noRooms: true }),
};

export const EmptyMessages: Story = {
  name: "メッセージが 0 件",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ body: "empty" }),
};

export const PublicPreview: Story = {
  name: "public ルームを参加せずに閲覧",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ footer: "join" }),
};

export const RemovedFromChannel: Story = {
  name: "チャンネルにアクセスできない（外された）",
  tags: ["since:1.5"],
  render: () => chat({ body: "removed-room", footer: "none" }),
};

export const RemovedFromWorkspace: Story = {
  name: "ワークスペースから削除された",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ body: "removed-workspace", footer: "none" }),
};

export const MembersPanel: Story = {
  name: "メンバーパネル",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ members: true }),
};

export const WorkspaceSwitcher: Story = {
  name: "ワークスペースの切り替え",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ switcher: true }),
};

export const WorkspaceCreateDialog: Story = {
  name: "ワークスペースを作成",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => chat({ createWorkspace: true }),
};

export const ChannelCreateDialog: Story = {
  name: "チャンネルを作成",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "520x540" } },
  render: () => chat({ dialog: <CreateRoomDialog open name="デザインレビュー" kind="public" /> }),
};

export const DmDialog: Story = {
  name: "ダイレクトメッセージを開く",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "520x600" } },
  render: () =>
    chat({
      dialog: (
        <StartDmDialog
          open
          candidates={dmCandidates}
          selectedId={users.naoki.id}
        />
      ),
    }),
};

export const RoomSettingsDialog: Story = {
  name: "チャンネルの設定",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "560x640" } },
  render: () => chat({ dialog: roomSettingsDialog({ canEdit: true }) }),
};

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

export const AccountMenu: Story = {
  name: "アカウントメニュー",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "420x340" } },
  render: () => chat({ accountMenu: true }),
};

export const SearchEmpty: Story = {
  name: "チャンネル検索の 0 件",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "380x520" } },
  render: () => chat({ noRooms: true, search: "見積" }),
};

export const EmptyWorkspaces: Story = {
  name: "ワークスペースが 0 件",
  tags: ["since:6-2"],
  parameters: { screenshot: { source: "design", size: "480x600" } },
  render: () => <NoWorkspaces />,
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

export const ServerError: Story = {
  name: "サーバーに接続できない",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => <ServerUnavailable lastConnectedLabel="11:07" retryCount={3} />,
};

export const SidebarAddEntries: Story = {
  name: "サイドバーの作成・DM の入口",
  tags: ["since:6-2"],
  parameters: { screenshot: { size: "320x560" } },
  render: sidebarFrame,
};

export const RoomHeaderSettings: Story = {
  name: "ルームのヘッダーの設定",
  tags: ["since:6-2"],
  parameters: { screenshot: { size: "900x120" } },
  render: roomHeaderFrame,
};

export const MemberAddDialog: Story = {
  name: "チャンネルにメンバーを追加",
  tags: ["since:6-2"],
  render: () =>
    chat({ dialog: <AddRoomMemberDialog open candidates={dmCandidates} selectedId={users.ryo.id} /> }),
};

// 退出はロールに関係なくできるので、読み取り専用（member）の設定で見せる
// 退出はロールに関係なくできるので、読み取り専用（member）の設定で見せる
export const RoomSettingsLeave: Story = {
  name: "チャンネルの設定からの退出",
  tags: ["since:6"],
  render: () => chat({ dialog: roomSettingsDialog({ canEdit: false, onLeave: noop }) }),
};

export const DialogLeaveRoom: Story = {
  name: "チャンネルの退出の確認（公開）",
  tags: ["since:6"],
  render: () => chat({ dialog: <LeaveRoomDialog open kind="public" name="デザインレビュー" /> }),
};

export const DialogLeaveRoomPrivate: Story = {
  name: "チャンネルの退出の確認（非公開）",
  tags: ["since:6"],
  render: () => chat({ dialog: <LeaveRoomDialog open kind="private" name="リリース準備" /> }),
};

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

export const ImageViewer: Story = {
  name: "画像の拡大表示",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "images", dialog: imageViewer(viewerImages, 1) }),
};

export const ImageViewerDark: Story = {
  name: "画像の拡大表示（ダーク）",
  tags: ["since:6.7.5"],
  parameters: { theme: "dark" },
  render: () => chat({ dark: true, messageAttachments: "images", dialog: imageViewer(viewerImages, 1) }),
};

// 最後の画像。送れる向きにだけ矢印を出す（端では出さない）
// 最後の画像。送れる向きにだけ矢印を出す（端では出さない）
export const ImageViewerLast: Story = {
  name: "画像の拡大表示: 最後の 1 枚",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "images", dialog: imageViewer(viewerImages, viewerImages.length - 1) }),
};

// 1 枚しかないので矢印と枚数を出さない。消せない人なので、削除も出ない（ADR 0045 決定 9）
// 1 枚しかないので矢印と枚数を出さない。消せない人なので、削除も出ない（ADR 0045 決定 9）
export const ImageViewerSingle: Story = {
  name: "画像の拡大表示: 1 枚だけ",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "images", dialog: imageViewer([singleViewerImage], 0, false) }),
};

export const AttachmentMenu: Story = {
  name: "添付ファイルの操作メニュー",
  tags: ["since:6.7.5"],
  render: () => chat({ messageAttachments: "menu" }),
};

export const AttachmentDeleteDialog: Story = {
  name: "添付ファイルの削除",
  tags: ["since:6.7.5"],
  render: () =>
    chat({
      messageAttachments: "images",
      dialog: (
        <>
          {imageViewer(viewerImages, 1)}
          <DeleteAttachmentDialog open fileName={deletedAttachmentName} />
        </>
      ),
    }),
};

// 最後の 1 枚で、本文も空のメッセージ。消すとメッセージごと消えることを先に伝える（ADR 0045 決定 8）
// 最後の 1 枚で、本文も空のメッセージ。消すとメッセージごと消えることを先に伝える（ADR 0045 決定 8）
export const AttachmentDeleteDialogLast: Story = {
  name: "添付ファイルの削除: メッセージごと消える",
  tags: ["since:6.7.5"],
  render: () =>
    chat({
      messageAttachments: "images",
      dialog: (
        <>
          {imageViewer([singleViewerImage], 0)}
          <DeleteAttachmentDialog open alsoDeletesMessage fileName={singleViewerImage.fileName} />
        </>
      ),
    }),
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

export const MobileRoomBroadcast: Story = {
  name: "チャンネルにも投稿した返信（モバイル）",
  tags: ["since:6.6"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ broadcastInChannel: true }),
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

export const MobileThreads: Story = {
  name: "参加しているスレッドの一覧（モバイル）",
  tags: ["since:6.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ threads: "list" }),
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

export const MobileImageViewer: Story = {
  name: "画像の拡大表示（モバイル）",
  tags: ["since:6.7.5"],
  parameters: { screenshot: { size: "390x844" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ messageAttachments: "images", dialog: imageViewer(viewerImages, 1) }),
};

export const MobileRooms: Story = {
  name: "チャンネル一覧（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ mobileView: "list" }),
};

export const MobileRoom: Story = {
  name: "ルーム（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat(),
};

export const MobileMembersSheet: Story = {
  name: "メンバーシート（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => chat({ members: true }),
};
