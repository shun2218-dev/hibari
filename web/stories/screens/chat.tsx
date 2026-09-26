"use client";

import type { ReactNode } from "react";

import { AccountMenu } from "@/components/chat/account-menu";
import { ChatLayout } from "@/components/chat/chat-layout";
import {
  ArchivedRoomBar,
  EmptyMessages,
  JoinRoomBar,
  MessageNotFoundNotice,
  RemovedFromWorkspace,
  RoomUnavailable,
  UnreadJumpBar,
} from "@/components/chat/chat-states";
import { Composer } from "@/components/chat/composer";
import type { HoverAction } from "@/components/chat/message-item/hover-actions";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { RemoveSavedItemDialog } from "@/components/chat/dialogs/remove-saved-item";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { HuddleRing } from "@/components/chat/huddle-ring";
import { HuddleBar } from "@/components/chat/huddle-screen";
import { MembersPanel } from "@/components/chat/members-panel";
import { NotificationMenu } from "@/components/chat/notification-menu";
import { NotificationPermissionBanner } from "@/components/chat/notification-permission-banner";
import { PinsList } from "@/components/chat/pins-list";
import { ProfileHoverCard } from "@/components/chat/profile-card";
import { RoomHeader } from "@/components/chat/room-header";
import { SearchFiltersDialog } from "@/components/chat/dialogs/search-filters";
import { SearchPanel } from "@/components/chat/search-panel";
import { SearchResults } from "@/components/chat/search-results";
import { TopBar } from "@/components/chat/top-bar";
import { RoomTabs } from "@/components/chat/room-tabs";
import { SideNavBar, type SideNavKey } from "@/components/chat/side-nav";
import { Sidebar } from "@/components/chat/sidebar";
import { StatusDialog } from "@/components/chat/status-dialog/status-dialog";
import { ThreadList } from "@/components/chat/thread-list";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { Timeline } from "@/components/chat/timeline";
import type {
  ActivityFilter,
  AttachmentDraftView,
  ConnectionBannerStatus,
  HuddleHeaderState,
  RoomKind,
  TimelineItem,
} from "@/components/chat/types";
import { WorkspaceSwitcher } from "@/components/chat/workspace-switcher";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import { notifyLevelLabels } from "@/lib/chat/notifications/mute";
import { attachmentMessageKey, timelineWithImages } from "@/stories/fixtures/attachments";
import {
  dmTimelineWithHuddleRinging,
  dmTimelineWithMissedHuddle,
  huddleCaller,
  huddleChatItems,
  huddleMessageKey,
  huddleOthers,
  huddleScreen,
  timelineWithHuddle,
  timelineWithHuddleEnded,
  timelineWithHuddleJoined,
} from "@/stories/fixtures/huddles";
import {
  composerLinkDraft,
  composerLinkPreviews,
  composerLinkPreviewsLoading,
  myLinkPreviewKey,
  timelineWithLinkPreviews,
  timelineWithMyLinkPreview,
  timelineWithThumbnailPreview,
} from "@/stories/fixtures/link-previews";
import { timelineWithLinkCards } from "@/stories/fixtures/links";
import { pinCandidateKey, pinnedMessageKey, pinnedMessages, timelineWithPins } from "@/stories/fixtures/pins";
import { hoveredReaction, reactedMessageKey, reactionPickerKey, timelineWithReactions } from "@/stories/fixtures/reactions";
import {
  dmRoom,
  roomMembers,
  roomMembersWithPresence,
  channelLinkTable,
  rooms,
  roomsSearchedWithArchived,
  roomsWithMentions,
  roomsWithMuted,
  roomsWithStatus,
  selectedRoom,
  typingNames,
} from "@/stories/fixtures/rooms";
import { ChannelLinksProvider } from "@/providers/channel-links-provider";
import { saveCandidateKey, savedArchived, savedCompleted, savedInProgress } from "@/stories/fixtures/saved";
import {
  searchFilters,
  searchQuery,
  searchResults,
  searchRoomOptions,
  searchSenderOptions,
  searchTerms,
  searchToday,
} from "@/stories/fixtures/search";
import {
  deletedThreadRoot,
  threadItems,
  threadList,
  threadListWithNotifyOff,
  threadRootKey,
  timelineWithBroadcast,
  timelineWithThreads,
  unreadThreadCount,
  unreadThreadCountWithNotifyOff,
} from "@/stories/fixtures/threads";
import {
  dmTimeline,
  jumpTargetKey,
  lastMessageKey,
  mentionCandidates,
  myMessageKey,
  timeline,
  timelineArchived,
  timelineJumped,
  timelineMySent,
  timelineWithAvatars,
  timelineWithFormatting,
  timelineWithFormerMember,
  timelineWithMentions,
  timelineWithChannelLinks,
  timelineWithStatus,
  timelineWithSystemMessages,
} from "@/stories/fixtures/timeline";
import { currentUser, myStatus, users } from "@/stories/fixtures/users";
import { workspaces } from "@/stories/fixtures/workspaces";

import { sideNavItems, sidePane, sideRail } from "./chat-nav";
import { profileHover, profilePanelContent, threadPanelContent } from "./chat-panels";
import { noHref, noop, roomHref } from "./shared";

/**
 * チャットの画面そのもの（サイドバー・ヘッダー・タイムライン・入力欄）。
 */
// ---- チャット ----

export type ChatOptions = {
  /** アバター画像を設定している人が混ざったタイムラインにする。 */
  avatars?: boolean;
  /** 参加や名前の変更のログを挟んだタイムライン（ADR 0033）。 */
  systemMessages?: boolean;
  banner?: ConnectionBannerStatus;
  attachments?: AttachmentDraftView[];
  hoveredKey?: string;
  /** ホバーの操作の名前の吹き出しを固定で出す（`hoveredKey` と一緒に渡す）。 */
  hoveredActionTooltip?: { key: string; action: HoverAction };
  noRooms?: boolean;
  search?: string;
  accountMenu?: boolean;
  menuKey?: string;
  editingKey?: string;
  /** チャット画面の上に重ねるダイアログ。 */
  dialog?: ReactNode;
  body?: "timeline" | "empty" | "removed-room" | "removed-workspace";
  footer?: "composer" | "join" | "archived" | "archived-readonly" | "none";
  members?: boolean;
  switcher?: boolean;
  createWorkspace?: boolean;
  mobileView?: "list" | "room";
  /** スレッドのパネルを開く（ADR 0036）。 */
  thread?: "replies" | "empty" | "root-deleted" | "broadcast" | "link-preview";
  /** スレッドを開かずに、チャンネルに流した返信のあるタイムラインを出す（ADR 0039。モバイルではパネルが全画面になるため）。 */
  broadcastInChannel?: boolean;
  /**
   * ルームの代わりに、参加しているスレッドの一覧を出す。notify-off は返信の通知をオフにした行の混ざった一覧、
   * row-menu はオフにした行の「その他」を開いたところ（ADR 0056）。
   */
  threads?: "list" | "empty" | "notify-off" | "row-menu";
  /**
   * スレッドの親の「…」の返信の通知（ADR 0056）。
   * - menu: 参加しているスレッド（「返信の通知をオフにする」）
   * - menu-follow: 参加していないスレッド（「新しい返信の通知を受け取る」）
   */
  threadNotify?: "menu" | "menu-follow";
  /** メンションのあるタイムラインとサイドバーにする（ADR 0043）。 */
  mentions?: boolean;
  /** 入力欄の `@` の補完を開いた状態で出す（`@` の後ろに打った文字。ADR 0043）。`#` で始めるとチャンネルの補完（ADR 0062）。 */
  mentionQuery?: string;
  /** チャンネルへのリンクのあるタイムラインにする（ADR 0062）。 */
  channelLinks?: boolean;
  /**
   * 指定したメッセージへ飛ぶ仕組みの画面（ADR 0042）。
   * - unread-bar: 未読が読み込んだページより古いときの「未読 N 件 / 最初の未読へ」
   * - highlight: リンクやカードから飛んできた先の強調
   * - not-found: リンク先が見つからなかったときの知らせ
   */
  jump?: "unread-bar" | "highlight" | "not-found";
  /** 本文に貼られたパーマリンクのカードのあるタイムライン（ADR 0040）。 */
  linkCards?: boolean;
  /**
   * 外部のリンクのプレビューのあるタイムライン（ADR 0065）。
   * - timeline: 画像つき・画像なし・いちばん小さいカード
   * - remove: 本人のカードにポインタを乗せて「x」が出たところ
   */
  linkPreviews?: "timeline" | "remove" | "thumbnail";
  /**
   * リッチテキストの入力欄（ADR 0052）。
   * - formatted: 書式とメンションのチップを入れた下書き
   * - toolbar-hidden: 書式のツールバーを隠したところ
   * - link-dialog: リンクを入れる画面を開いたところ
   * - link-preview / link-preview-loading: URL を貼って、本文の下にリンクのプレビューが出たところ / 取得中（ADR 0065 決定 13）
   */
  composer?: "formatted" | "toolbar-hidden" | "link-dialog" | "link-preview" | "link-preview-loading";
  /** 書式（太字・コード・引用・リスト・リンク）のあるタイムライン（ADR 0051）。 */
  formatting?: boolean;
  /**
   * 絵文字のリアクション（ADR 0044）。
   * - row: 付いた絵文字の行
   * - names: チップにホバーして「誰が付けたか」を出したところ
   * - picker: ピッカーを開いたところ
   * - picker-above: いちばん下のメッセージで開いて、上に開いたところ
   * - picker-from-reactions: リアクションの行の「＋」から開いて、その「＋」のすぐ下に出たところ
   */
  reactions?: "row" | "names" | "picker" | "picker-above" | "picker-from-reactions";
  /**
   * 添付ファイル（ADR 0045）。画像を 3 枚とファイルを 1 件付けたメッセージのあるタイムラインにする。
   * - images: そのまま（拡大表示の画面の後ろに出す）
   * - menu: 画像でない添付の行の「…」を開いたところ
   */
  messageAttachments?: "images" | "menu";
  /**
   * 離席とカスタムステータス（ADR 0049）。
   * - presence: メンバーパネル・タイムライン・サイドバーに、離席とステータスが混ざった状態を出す
   * - status-dialog: ステータスを設定するダイアログ（`picker` は絵文字のピッカーを開いたところ）
   */
  presence?: boolean;
  statusDialog?: "empty" | "filled" | "picker" | "custom" | "calendar" | "time";
  /**
   * プロフィール（ADR 0050 決定 6 の追記）。
   * - hover-*: md 以上でアバターにポインタを乗せたときのカード（他人・自分・外された人）
   * - panel-*: 押して開く右のパネル（モバイルは全画面）。menu / manage は 3 点メニューを開いたところ、
   *   from-members はメンバーパネルから開いて「メンバーに戻る」が出ているところ
   */
  profile?:
    | "hover-other"
    | "hover-self"
    | "hover-former"
    | "panel-other"
    | "panel-menu"
    | "panel-manage"
    | "panel-self"
    | "panel-loading"
    | "panel-unverified"
    | "panel-former"
    | "panel-unknown"
    | "panel-from-members";
  /**
   * ピン留め（ADR 0054）。
   * - timeline: 本文の上の「〜がピン留めしました」と黄土の地
   * - menu / menu-pinned: 「…」の「チャンネルへピン留めする」/「チャンネルからピンを外す」
   * - list / list-hover / list-empty: ヘッダーの下の「ピン」のタブ（タイムラインの代わりにメインの領域に出す）
   */
  pins?: "timeline" | "menu" | "menu-pinned" | "list" | "list-hover" | "list-empty";
  /**
   * 「後で」（ADR 0054）。
   * - hover / hover-saved: メッセージのホバーのブックマーク（保存前・保存済み）
   * - in_progress / archived / completed: サイドバーの「後で」から開く一覧の各タブ
   * - menu: 進行中の行の「その他」を開いたところ（archived-menu はアーカイブ済みの行）
   * - row-hover: 進行中の行にポインタを乗せたところ
   * - empty: 何も保存していない
   * - confirm: 読めない行を押して、外すかどうかを確かめるところ
   */
  saved?:
    | "hover"
    | "hover-saved"
    | "in_progress"
    | "row-hover"
    | "menu"
    | "archived"
    | "archived-menu"
    | "completed"
    | "empty"
    | "confirm";
  /**
   * ミュートと通知の設定（ADR 0055）。
   * - menu: チャンネルのヘッダーの「通知」を開いたところ（全体の設定に従っている）
   * - menu-muted: ミュートしているチャンネルで開いたところ（期限なし・「すべての新しい投稿」を選んである）
   * - menu-temporary: 一時的にミュートしているチャンネルで開いたところ
   * - menu-dm: DM で開いたところ（ミュートだけ）
   * - sidebar: ミュートしたルームの混ざったサイドバー（開いているルームはミュートしていない）
   */
  notifications?: "menu" | "menu-muted" | "menu-temporary" | "menu-dm" | "sidebar";
  /** サイドバーの上の「デスクトップ通知を有効にしますか？」の帯（ADR 0057）。 */
  permissionBanner?: boolean;
  /**
   * 左のメニューで開いているもの（ADR 0058。既定はホーム）。md 以上はサイドバーの左に縦のメニュー、モバイルは一覧の下にタブを出し、
   * サイドバーの列の中身を選んだメニューのものにする（ホーム・DM・アクティビティ・後で）。
   * 「後で」は `saved` の一覧の状態（in_progress / menu / empty など）をそのまま使う。
   */
  side?: SideNavKey;
  /**
   * アクティビティの一覧（`side: "activity"`）。タブの値のほか、
   * - unread: 「未読メッセージ」をオンにしたところ
   * - hover: 1 件にポインタを乗せたところ
   * - empty / unread-empty: 何もない・未読がない
   */
  activity?: ActivityFilter | "unread" | "hover" | "empty" | "unread-empty";
  /** DM の一覧（`side: "dms"`）を空にする。 */
  dmsEmpty?: boolean;
  /** DM の一覧の「未読メッセージ」をオンにする（ADR 0058 の追記）。 */
  dmsUnread?: boolean;
  /** 左のメニューにポインタを乗せて、一覧を重ねて出したところ（ADR 0058 の追記）。 */
  preview?: "dms" | "activity" | "later";
  /**
   * ダークで描く画面。ふだんは囲いの `data-theme` だけで足りるが、
   * emoji-mart のようにテーマを JS の props で受け取る部品には、こちらから渡す必要がある（ADR 0044 決定 7）。
   */
  dark?: boolean;
  /** サイドバーの検索の結果に、アーカイブしたチャンネルを混ぜる（`search` と一緒に使う。ADR 0059）。 */
  archivedSearch?: boolean;
  /**
   * メッセージの検索（ADR 0061）。サイドバーの `search`（チャンネルの絞り込み）とは別物。
   * - panel: 帯の検索欄を押して、候補のパネルを開いたところ（まだ何も打っていない）
   * - panel-typed: 語を打って、候補が 2 つ出たところ
   * - results: 結果の画面（サイドバーを畳んで全幅）
   * - results-filtered: 送信者と場所で絞り込んだところ
   * - results-empty: 一致が 0 件
   * - filters: 結果の画面の上に「検索フィルター」のダイアログ
   */
  messageSearch?: "panel" | "panel-typed" | "results" | "results-filtered" | "results-empty" | "filters";
  /**
   * ハドル（ADR 0066）のチャットのタブの見え方。指定しなければ、ヘッダーに「開始」のアイコンだけを出す（入れる人の画面）。
   * ハドルの画面そのもの（プレビュー・別のタブ）は chat() ではなく stories/chat/huddle.stories.tsx が直接描く。
   * - active: チャンネルで進行中（自分は入っていない）。ヘッダーの「参加」・サイドバーの印・会話のメッセージ
   * - joined: 自分が入っていて、ハドルのタブを閉じている（ヘッダーは緑のヘッドフォン、下にハドルの帯）。
   *   joined-chat はハドルのチャットをスレッドのパネルで開いたところ
   * - ended: 終わったハドルのメッセージ
   * - dm-missed: DM の不在着信と応答なし
   * - dm-ring: DM の呼び出しを受けているところ
   */
  huddle?: "active" | "joined" | "joined-chat" | "ended" | "dm-missed" | "dm-ring";
};

/** スレッドの画面のタイムライン。親が削除されたスレッドは、その親（tombstone と「N 件の返信」）を先頭に足す。 */
function threadTimeline(thread: NonNullable<ChatOptions["thread"]>) {
  if (thread === "broadcast") return timelineWithBroadcast;
  if (thread !== "root-deleted") return timelineWithThreads;
  const [date, ...rest] = timelineWithThreads;
  return [date, { type: "message" as const, message: deletedThreadRoot }, ...rest];
}

/** 書式とメンションを入れた下書き（ADR 0052）。入力欄の値は送る形のテキスト。 */
const composerDraft = `金曜のリリースは *17 時* からです。__遅れる人は__事前に連絡してください。\n- 手順は<https://example.com/runbook|手順書>に\n- 確認は <@${users.miyuki.id}> さん、\`make migrate\` まで`;

const storyChannelLinks = { channels: channelLinkTable, href: (id: string) => `/w/ws/r/${id}` };

/**
 * 送信済みで削除されていない人の発言に出す「リンクをコピー」「ピン留め」「後で」と、自分の発言の編集・削除。
 * 実画面（hooks/chat/use-message-actions.tsx）と同じ条件にしておく。story ごとに渡すかどうかを決めていると、
 * 機能を足したときにホバーの帯と「…」のメニューが古い見た目のまま残る（送信中のメッセージにはまだ ID がないので出さない）。
 */
function messageActions(
  items: TimelineItem[],
  roomKind: RoomKind,
  { canPin = true, saved = false }: { canPin?: boolean; saved?: boolean } = {},
) {
  const sent = (key: string) => {
    const item = items.find((i) => i.type === "message" && i.message.key === key);
    return item?.type === "message" && item.message.status === "sent" && !item.message.deleted ? item.message : undefined;
  };
  const dm = roomKind === "dm";
  return {
    copyLinkFor: (key: string) => (sent(key) ? { label: "リンクをコピー", onClick: noop } : undefined),
    pinFor: (key: string) => {
      const message = canPin ? sent(key) : undefined;
      if (!message) return undefined;
      const label = message.pinnedBy
        ? dm ? "この会話からピンを外す" : "チャンネルからピンを外す"
        : dm ? "この会話にピン留めする" : "チャンネルへピン留めする";
      return { label, onClick: noop };
    },
    saveFor: (key: string) => (sent(key) ? { saved, onClick: noop } : undefined),
    mine: (key: string) => sent(key)?.sender.id === users.you.id,
  };
}

/** スレッドのパネルのタイムライン。実画面（room-thread.tsx）と同じく、ルームと同じ操作を出す。 */
function ThreadTimeline({ items, roomKind }: { items: TimelineItem[]; roomKind: RoomKind }) {
  const actions = messageActions(items, roomKind);
  return (
    <Timeline
      items={items}
      copyLinkFor={actions.copyLinkFor}
      pinFor={actions.pinFor}
      saveFor={actions.saveFor}
      actionsFor={(key) => ({ canEdit: actions.mine(key), canDelete: actions.mine(key) })}
      onToggleReaction={noop}
      onTogglePicker={noop}
      onOpenProfile={noop}
    />
  );
}

/**
 * ハドルのチャット（ハドルのメッセージのスレッド。ADR 0066 追記 A）のパネル。チャットのタブの右のパネルと、
 * ハドルの画面の右（stories/chat/huddle.stories.tsx）で同じものを出す。
 */
export function huddleChatPanel(room: { kind: RoomKind; name: string }) {
  return (
    <ThreadPanel
      room={room}
      footer={
        <Composer value="" canSend={false} target="thread" alsoInChannel={{ label: "チャンネルにも投稿する", checked: false }} />
      }
    >
      <ThreadTimeline items={huddleChatItems} roomKind={room.kind} />
    </ThreadPanel>
  );
}

export function chat({
  avatars,
  systemMessages,
  banner,
  attachments,
  hoveredKey,
  hoveredActionTooltip,
  noRooms,
  search,
  accountMenu,
  menuKey,
  editingKey,
  dialog,
  body = "timeline",
  footer = "composer",
  members,
  switcher,
  createWorkspace,
  mobileView = "room",
  thread,
  broadcastInChannel,
  threads,
  threadNotify,
  mentions,
  mentionQuery,
  channelLinks,
  jump,
  linkCards,
  linkPreviews,
  composer,
  formatting,
  reactions,
  messageAttachments,
  presence,
  statusDialog,
  profile,
  pins,
  saved,
  notifications,
  permissionBanner,
  side = "home",
  activity,
  dmsEmpty,
  dmsUnread,
  preview,
  dark,
  archivedSearch,
  messageSearch,
  huddle,
}: ChatOptions = {}) {
  const dmHuddle = huddle === "dm-missed" || huddle === "dm-ring";
  const inHuddle = huddle === "joined" || huddle === "joined-chat";
  // 非公開チャンネルから外されたら、一覧からもヘッダーからも名前を消す（ADR 0035）
  const roomRemoved = body === "removed-room";
  // アーカイブしたルーム（ADR 0059）。archived-readonly は復元できない人（参加していない member）が見たところ
  const archivedRoom = footer === "archived" || footer === "archived-readonly";
  const composerLinkPreview = composer === "link-preview" || composer === "link-preview-loading";
  const threadContent = thread ? threadPanelContent(thread) : undefined;
  const hover = profile?.startsWith("hover-") ? profileHover(profile) : undefined;
  const profilePanel = profile?.startsWith("panel-") ? profilePanelContent(profile) : undefined;
  // ステータスの出ている画面の上に出す（名前の横の絵文字とカードの中身をそろえて見せる）
  const withStatus = presence || profile !== undefined;
  const timelineItems =
    huddle === "active"
      ? timelineWithHuddle
      : inHuddle
      ? timelineWithHuddleJoined
      : huddle === "ended"
      ? timelineWithHuddleEnded
      : huddle === "dm-missed"
      ? dmTimelineWithMissedHuddle
      : huddle === "dm-ring"
      ? dmTimelineWithHuddleRinging
      : archivedRoom
      ? timelineArchived
      : notifications === "menu-dm"
      ? dmTimeline
      : profile === "hover-former" || profile === "panel-former"
      ? timelineWithFormerMember
      : withStatus
      ? timelineWithStatus
      : pins
      ? timelineWithPins
      : messageAttachments
      ? timelineWithImages
      : reactions
      ? timelineWithReactions
      : linkCards
      ? timelineWithLinkCards
      : linkPreviews
      ? linkPreviews === "remove"
        ? timelineWithMyLinkPreview
        : linkPreviews === "thumbnail"
          ? timelineWithThumbnailPreview
          : timelineWithLinkPreviews
      : formatting
      ? timelineWithFormatting
      : jump
      ? timelineJumped
      : thread || threadNotify
      ? threadTimeline(thread ?? "replies")
      : channelLinks
      ? timelineWithChannelLinks
      : mentions
        ? timelineWithMentions
        : broadcastInChannel
        ? timelineWithBroadcast
        : systemMessages
        ? timelineWithSystemMessages
        : avatars
          ? timelineWithAvatars
          : [menuKey, editingKey, hoveredKey].includes(myMessageKey)
            ? timelineMySent
            : timeline;
  // アーカイブしたルームではピン留めを変えられない（ADR 0059）
  const actions = messageActions(timelineItems, notifications === "menu-dm" || dmHuddle ? "dm" : selectedRoom.kind, {
    canPin: !archivedRoom,
    saved: saved === "hover-saved",
  });
  const editingMessage = timelineItems.find((i) => i.type === "message" && i.message.key === editingKey);
  // 「後で」の一覧はスレッドの一覧と同じく、ルームの代わりにメインの領域に出す
  const savedTab = saved === "archived" || saved === "archived-menu" ? "archived" : saved === "completed" ? "completed" : "in_progress";
  const savedItems =
    saved === "empty"
      ? []
      : savedTab === "archived"
        ? savedArchived
        : savedTab === "completed"
          ? savedCompleted
          : savedInProgress;
  // 「ピン」のタブでは、タイムラインと入力欄の代わりに一覧を出す（Slack と同じ。ADR 0054）
  const pinsTab = pins === "list" || pins === "list-hover" || pins === "list-empty";
  // 通知のメニューを DM で開くときだけ、DM のルームを出す
  const room = notifications === "menu-dm" || dmHuddle ? dmRoom : selectedRoom;
  // ハドルが進行中のルーム（ADR 0066）。サイドバーの印と、ヘッダーのボタンの状態に使う
  const huddleRoomActive = huddle === "active" || huddle === "dm-ring" || inHuddle;
  const huddleSidebarParticipants = huddle === "dm-ring" ? [huddleCaller] : inHuddle ? huddleScreen.participants : huddleOthers;
  // 入れない人（参加していない public ルーム・アーカイブ済み）にはヘッダーのボタンを出さない（決定 7）
  const huddleHeader: HuddleHeaderState | undefined =
    footer !== "composer"
      ? undefined
      : huddle === "active"
        ? { state: "active", participants: huddleOthers }
        : huddle === "dm-ring"
          ? { state: "active", participants: [huddleCaller] }
          : inHuddle
            ? { state: "joined" }
            : { state: "idle" };
  // サイドバーの画面では、開いているルームはミュートしない（薄いルームとそうでないルームを見比べるため）
  const roomMuted = notifications === "menu-muted" || notifications === "menu-temporary";
  // 参加していない public ルームは設定を持てないので、「通知」のアイコンを出さない（ADR 0055 決定 3）
  const roomNotifications =
    footer === "join" || footer === "archived-readonly"
      ? undefined
      : {
          muted: roomMuted,
          open: notifications !== undefined && notifications !== "sidebar",
          menu: (
            <NotificationMenu
              kind={room.kind}
              level={notifications === "menu-muted" ? "all" : null}
              defaultLevelLabel={notifyLevelLabels.mentions}
              mute={notifications === "menu-muted" ? {} : notifications === "menu-temporary" ? { untilLabel: "今日 18:30 まで" } : null}
            />
          ),
        };
  // メッセージの検索（ADR 0061）。結果の画面ではサイドバーを畳んで全幅で使う（Slack と同じ）
  const searchResultsView = messageSearch !== undefined && messageSearch !== "panel" && messageSearch !== "panel-typed";
  const searchPanelValue = messageSearch === "panel-typed" ? searchQuery : "";
  const topBar = (
    <TopBar
      workspaceName={workspaces.dev.name}
      query={searchResultsView ? searchQuery : undefined}
      canGoBack
      canGoForward
      panel={
        messageSearch === "panel" || messageSearch === "panel-typed" ? (
          <SearchPanel
            value={searchPanelValue}
            workspaceName={workspaces.dev.name}
            roomName={selectedRoom.name}
            onSubmit={noop}
            onSearchInRoom={noop}
          />
        ) : undefined
      }
    />
  );

  const home = (
          <Sidebar
            workspace={workspaces.dev}
            currentUser={currentUser}
            rooms={
              noRooms
                ? []
                : search !== undefined && archivedSearch
                  ? roomsSearchedWithArchived
                  : archivedRoom
                    ? rooms.map((r) => (r.id === room.id ? { ...r, archived: true } : r))
                : roomRemoved
                  ? rooms.filter((r) => r.id !== selectedRoom.id)
                  : notifications
                    ? notifications === "sidebar"
                      ? roomsWithMuted
                      : rooms.map((r) => (r.id === room.id ? { ...r, muted: roomMuted } : r))
                  : mentions
                    ? roomsWithMentions
                    : presence
                      ? roomsWithStatus
                      : huddleRoomActive
                        ? rooms.map((r) => (r.id === room.id ? { ...r, huddle: { participants: huddleSidebarParticipants } } : r))
                        : rooms
            }
            selectedRoomId={roomRemoved || threads ? undefined : room.id}
            threads={
              thread || threads || side
                ? { href: noHref, unreadCount:
                    threads === "empty"
                      ? 0
                      : threads === "notify-off" || threads === "row-menu"
                        ? unreadThreadCountWithNotifyOff
                        : unreadThreadCount, selected: Boolean(threads) }
                : undefined
            }
            railed
            roomHref={roomHref}
            notice={permissionBanner ? <NotificationPermissionBanner onEnable={noop} onDismiss={noop} /> : undefined}
            search={search}
            onCreateRoom={noop}
            onStartDm={noop}
            accountMenuOpen={false}
            accountMenu={
              <AccountMenu
                user={{ ...users.you, handle: users.you.handle, status: presence ? myStatus : undefined }}
                away={presence}
              />
            }
            switcherOpen={false}
            switcher={
              <WorkspaceSwitcher workspaces={[workspaces.dev, workspaces.memo]} currentWorkspaceId={workspaces.dev.id} />
            }
          />
  );
  return (
    // 本文の `<#ID>` の名前はワークスペースの画面の根が配る（ADR 0062）。ここでも同じ形で配る
    <ChannelLinksProvider value={storyChannelLinks}>
      <ChatLayout
        topBar={topBar}
        mobileView={mobileView}
        huddleBar={
          // ハドルのタブを閉じている間の帯（ADR 0066 追記 C）
          inHuddle ? (
            <HuddleBar huddle={huddleScreen} chatOpen={huddle === "joined-chat"} onToggleMute={noop} onPopOut={noop} onLeave={noop} />
          ) : undefined
        }
        sidebar={
          searchResultsView ? undefined : sidePane(side, home, { activity, dmsEmpty, dmsUnread, saved, savedTab, savedItems })
        }
        rail={sideRail(side, { switcher, accountMenu, presence, preview })}
        tabBar={<SideNavBar items={sideNavItems} current={side} />}
        panel={
          members ? (
            <MembersPanel
              members={withStatus ? roomMembersWithPresence : roomMembers}
              onOpenProfile={noop}
            />
          ) : profilePanel ? (
            profilePanel
          ) : huddle === "joined-chat" ? (
            huddleChatPanel(selectedRoom)
          ) : threadContent ? (
            <ThreadPanel
              room={{ kind: selectedRoom.kind, name: selectedRoom.name }}
              footer={
                <Composer
                  value=""
                  canSend={false}
                  target="thread"
                  typingNames={threadContent.typing}
                  alsoInChannel={{ label: "チャンネルにも投稿する", checked: thread === "broadcast" }}
                />
              }
            >
              <ThreadTimeline items={threadItems(threadContent.root, threadContent.replies)} roomKind={selectedRoom.kind} />
            </ThreadPanel>
          ) : undefined
        }
      >
        {searchResultsView && (
          <SearchResults
            query={searchQuery}
            filters={messageSearch === "results-filtered" || messageSearch === "filters" ? searchFilters : {}}
            results={messageSearch === "results-empty" ? [] : searchResults}
            highlightTerms={searchTerms}
            today={searchToday}
            onOpenFilters={noop}
            onClearFilter={noop}
          />
        )}
        {!searchResultsView && threads && (
          <ThreadList
            threads={threads === "empty" ? [] : threads === "list" ? threadList : threadListWithNotifyOff}
            threadHref={roomHref}
            onToggleNotify={noop}
            openMenuKey={threads === "row-menu" ? "m-chat-0930" : undefined}
          />
        )}
        {!searchResultsView && !roomRemoved && !threads && (
          <RoomHeader
            archived={archivedRoom}
            kind={room.kind}
            name={room.name}
            memberCount={room.memberCount}
            membersOpen={members}
            onOpenSettings={room.kind === "dm" ? undefined : noop}
            notifications={roomNotifications}
            huddle={huddleHeader && { ...huddleHeader, onClick: noop }}
          />
        )}
        {/* ルームのヘッダーの下には、いつも「メッセージ / ピン」のタブがある（ADR 0054） */}
        {!searchResultsView && !roomRemoved && !threads && <RoomTabs value={pinsTab ? "pins" : "messages"} />}
        {!searchResultsView && pinsTab && (
          <PinsList
            roomKind={selectedRoom.kind}
            pins={pins === "list-empty" ? [] : pinnedMessages}
            onUnpin={noop}
            hoveredKey={pins === "list-hover" ? pinnedMessages[0].key : undefined}
          />
        )}
        <ConnectionBanner status={banner ?? null} />
        {jump === "unread-bar" && <UnreadJumpBar count={12} onJump={noop} />}
        {jump === "not-found" && <MessageNotFoundNotice onClose={noop} />}
        {body === "timeline" && !searchResultsView && !threads && !pinsTab && (
          <Timeline
            items={timelineItems}
            openThreadKey={
              huddle === "joined-chat"
                ? huddleMessageKey
                : thread === "root-deleted" ? deletedThreadRoot.key : thread ? threadContent?.root.key : undefined
            }
            highlightedKey={jump === "highlight" ? jumpTargetKey : undefined}
            hoveredKey={
              threadNotify
                ? threadRootKey
                : pins === "menu" ? pinCandidateKey : pins === "menu-pinned" ? pinnedMessageKey : saved === "hover" || saved === "hover-saved" ? saveCandidateKey : hoveredKey
            }
            copyLinkFor={actions.copyLinkFor}
            pinFor={actions.pinFor}
            saveFor={actions.saveFor}
            onToggleReaction={noop}
            onTogglePicker={noop}
            openPickerKey={
              reactions === "picker"
                ? reactionPickerKey
                : reactions === "picker-above"
                  ? lastMessageKey
                  : reactions === "picker-from-reactions"
                    ? reactedMessageKey
                    : undefined
            }
            openPickerFrom={reactions === "picker-from-reactions" ? "reactions" : undefined}
            reactionPicker={<EmojiPicker onPick={noop} theme={dark ? "dark" : "light"} />}
            onOpenProfile={noop}
            profileHoverCardFor={hover ? () => <ProfileHoverCard profile={hover.profile} /> : undefined}
            hoveredProfileKey={hover?.key}
            hoveredReaction={reactions === "names" ? hoveredReaction : undefined}
            hoveredActionTooltip={hoveredActionTooltip}
            onReply={noop}
            onOpenImage={noop}
            onDeleteAttachment={noop}
            openAttachmentMenu={
              messageAttachments === "menu" ? { key: attachmentMessageKey, attachmentId: "a-2" } : undefined
            }
            onToggleAttachmentMenu={noop}
            onRemoveLinkPreview={noop}
            onJoinHuddle={noop}
            hoveredLinkPreviewKey={linkPreviews === "remove" ? myLinkPreviewKey : undefined}
            actionsFor={(key) => ({
              canEdit: actions.mine(key),
              // 添付だけを削除できるのは、メッセージを削除できる人と同じ（ADR 0045 決定 5）
              canDelete: actions.mine(key) || (messageAttachments !== undefined && key === attachmentMessageKey),
            })}
            openMenuKey={
              threadNotify ? threadRootKey : pins === "menu" ? pinCandidateKey : pins === "menu-pinned" ? pinnedMessageKey : menuKey
            }
            threadNotifyFor={
              threadNotify
                ? (key) => (key === threadRootKey ? { notifying: threadNotify === "menu", onClick: noop } : undefined)
                : undefined
            }
            editingKey={editingKey}
            editing={{ value: editingMessage?.type === "message" ? editingMessage.message.body : "" }}
          />
        )}
        {body === "empty" && <EmptyMessages kind={selectedRoom.kind} name={selectedRoom.name} />}
        {roomRemoved && <RoomUnavailable />}
        {body === "removed-workspace" && <RemovedFromWorkspace workspaceName={workspaces.dev.name} />}
        {footer === "composer" && !searchResultsView && !threads && !pinsTab && (
          <Composer
            value={
              composer === "formatted" || composer === "link-dialog"
                ? composerDraft
                : composerLinkPreview
                  ? composerLinkDraft
                  : mentionQuery === undefined
                    ? ""
                    : "金曜の件、"
            }
            canSend={mentionQuery !== undefined || composer === "formatted" || composer === "link-dialog" || composerLinkPreview}
            linkPreviews={
              composer === "link-preview" ? composerLinkPreviews : composer === "link-preview-loading" ? composerLinkPreviewsLoading : undefined
            }
            onRemoveLinkPreview={noop}
            typingNames={mentions || composer || dmHuddle ? [] : typingNames}
            attachments={attachments}
            mentionCandidates={mentionCandidates}
            forceMentionQuery={mentionQuery}
            toolbarVisible={composer !== "toolbar-hidden"}
            forceLinkDialog={composer === "link-dialog" ? { text: "手順書", url: "" } : undefined}
          />
        )}
        {footer === "join" && <JoinRoomBar />}
        {footer === "archived" && <ArchivedRoomBar onRestore={noop} />}
        {footer === "archived-readonly" && <ArchivedRoomBar />}
      </ChatLayout>
      {dialog}
      {huddle === "dm-ring" && <HuddleRing caller={huddleCaller} onJoin={noop} onJoinSoon={noop} />}
      <RemoveSavedItemDialog open={saved === "confirm"} />
      <SearchFiltersDialog
        open={messageSearch === "filters"}
        filters={searchFilters}
        senderQuery="佐藤"
        senderOptions={searchSenderOptions}
        roomQuery="リリース"
        roomOptions={searchRoomOptions}
        date="any"
      />
      {statusDialog && (
        <StatusDialog
          open
          emoji={statusDialog === "empty" ? undefined : myStatus.emoji}
          text={statusDialog === "empty" ? "" : (myStatus.text ?? "")}
          expiry={
            statusDialog === "empty"
              ? "none"
              : statusDialog === "custom" || statusDialog === "calendar" || statusDialog === "time"
                ? "custom"
                : "today"
          }
          // 時刻の一覧は「打った文字で絞る」ところを見せる（`17` → 17:00 / 17:30）
          custom={{ date: "2026-09-25", time: statusDialog === "time" ? "17" : "17:00" }}
          calendarMonth="2026-09"
          today="2026-09-21"
          minTime="11:00"
          openPicker={statusDialog === "calendar" ? "date" : statusDialog === "time" ? "time" : undefined}
          pickerOpen={statusDialog === "picker"}
          canClear={statusDialog !== "empty"}
          theme={dark ? "dark" : "light"}
        />
      )}
      <CreateWorkspaceDialog open={Boolean(createWorkspace)} />
    </ChannelLinksProvider>
  );
}
