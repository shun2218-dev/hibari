"use client";

/**
 * story から使う画面の組み立て。presentational コンポーネントにモックデータを渡して、
 * docs/ui/screenshots/ と同じ状態を描く（ADR 0047）。操作しても状態は変わらない（見た目の確認だけが目的）。
 *
 * 1 画面 = 1 story は stories/<グループ>.stories.tsx にあり、このファイルはそこから呼ぶ部品を持つ。
 */
import type { ComponentProps, ReactNode } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { ChatLayout } from "@/components/chat/chat-layout";
import {
  EmptyMessages,
  JoinRoomBar,
  MessageNotFoundNotice,
  RemovedFromWorkspace,
  RoomUnavailable,
  UnreadJumpBar,
} from "@/components/chat/chat-states";
import { AccountMenu } from "@/components/chat/account-menu";
import { Composer } from "@/components/chat/composer";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { ImageViewer } from "@/components/chat/image-viewer";
import { MembersPanel } from "@/components/chat/members-panel";
import { ProfileHoverCard } from "@/components/chat/profile-card";
import { ProfilePanel } from "@/components/chat/profile-panel";
import { RoomHeader } from "@/components/chat/room-header";
import { RoomSettingsDialog } from "@/components/chat/room-dialogs";
import { Sidebar } from "@/components/chat/sidebar";
import { StatusDialog } from "@/components/chat/status-dialog";
import { ThreadList } from "@/components/chat/thread-list";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { Timeline } from "@/components/chat/timeline";
import type { AttachmentDraftView, ConnectionBannerStatus } from "@/components/chat/types";
import { WorkspaceSwitcher } from "@/components/chat/workspace-switcher";
import { SettingsLayout, type SettingsSection } from "@/components/settings/settings-layout";
import { type AdminSection, WorkspaceAdminLayout } from "@/components/workspace/admin-layout";
import { InviteList } from "@/components/workspace/invites";
import { type MemberMenuState, MemberList } from "@/components/workspace/member-list";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import type { WorkspaceRole } from "@/components/workspace/types";
import { WorkspaceSettings } from "@/components/workspace/workspace-settings";

import {
  attachmentMessageKey,
  currentUser,
  roomSettingsMembers,
  invitesAs,
  jumpTargetKey,
  membersAs,
  pendingMessageKey,
  roomMembers,
  rooms,
  selectedRoom,
  deletedThreadReplies,
  deletedThreadRoot,
  threadItems,
  threadList,
  threadReplies,
  threadRoot,
  threadRepliesWithBroadcast,
  threadRootWithoutReplies,
  timeline,
  timelineJumped,
  timelineWithImages,
  timelineWithLinkCards,
  timelineWithAvatars,
  timelineWithSystemMessages,
  mentionCandidates,
  hoveredReaction,
  lastMessageKey,
  reactionPickerKey,
  timelineWithReactions,
  myStatus,
  profiles,
  profileKeys,
  timelineWithFormerMember,
  roomMembersWithPresence,
  roomsWithStatus,
  timelineWithStatus,
  roomsWithMentions,
  timelineWithBroadcast,
  timelineWithMentions,
  timelineWithFormatting,
  timelineWithThreads,
  unreadThreadCount,
  typingNames,
  users,
  workspaces,
} from "./fixtures";

export const noHref = "#";
const roomHref = () => noHref;

// ---- 認証 ----

export const goodStrength = { level: 3, label: "良い" } as const;

// 渡したときだけ出る操作を、スクリーンショットと同じく出しておくための何もしないハンドラ。
export const noop = () => {};

export function auth(children: ReactNode, footer?: ReactNode) {
  return <AuthShell footer={footer}>{children}</AuthShell>;
}

export function login(error?: "credentials" | "rate_limited") {
  return auth(<LoginForm error={error} forgotPasswordHref={noHref} signupHref={noHref} />);
}

// ---- チャット ----

type ChatOptions = {
  /** アバター画像を設定している人が混ざったタイムラインにする。 */
  avatars?: boolean;
  /** 参加や名前の変更のログを挟んだタイムライン（ADR 0033）。 */
  systemMessages?: boolean;
  banner?: ConnectionBannerStatus;
  attachments?: AttachmentDraftView[];
  hoveredKey?: string;
  noRooms?: boolean;
  search?: string;
  accountMenu?: boolean;
  menuKey?: string;
  editingKey?: string;
  /** チャット画面の上に重ねるダイアログ。 */
  dialog?: ReactNode;
  body?: "timeline" | "empty" | "removed-room" | "removed-workspace";
  footer?: "composer" | "join" | "none";
  members?: boolean;
  switcher?: boolean;
  createWorkspace?: boolean;
  mobileView?: "list" | "room";
  /** スレッドのパネルを開く（ADR 0036）。 */
  thread?: "replies" | "empty" | "root-deleted" | "broadcast";
  /** スレッドを開かずに、チャンネルに流した返信のあるタイムラインを出す（ADR 0039。モバイルではパネルが全画面になるため）。 */
  broadcastInChannel?: boolean;
  /** ルームの代わりに、参加しているスレッドの一覧を出す。 */
  threads?: "list" | "empty";
  /** メンションのあるタイムラインとサイドバーにする（ADR 0043）。 */
  mentions?: boolean;
  /** 入力欄の `@` の補完を開いた状態で出す（`@` の後ろに打った文字。ADR 0043）。 */
  mentionQuery?: string;
  /**
   * 指定したメッセージへ飛ぶ仕組みの画面（ADR 0042）。
   * - unread-bar: 未読が読み込んだページより古いときの「未読 N 件 / 最初の未読へ」
   * - highlight: リンクやカードから飛んできた先の強調
   * - not-found: リンク先が見つからなかったときの知らせ
   */
  jump?: "unread-bar" | "highlight" | "not-found";
  /** 本文に貼られたパーマリンクのカードのあるタイムライン（ADR 0040）。 */
  linkCards?: boolean;
  /** 書式（太字・コード・引用・リスト・リンク）のあるタイムライン（ADR 0051）。 */
  formatting?: boolean;
  /**
   * 絵文字のリアクション（ADR 0044）。
   * - row: 付いた絵文字の行
   * - names: チップにホバーして「誰が付けたか」を出したところ
   * - picker: ピッカーを開いたところ
   * - picker-above: いちばん下のメッセージで開いて、上に開いたところ
   */
  reactions?: "row" | "names" | "picker" | "picker-above";
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
   * ダークで描く画面。ふだんは囲いの `data-theme` だけで足りるが、
   * emoji-mart のようにテーマを JS の props で受け取る部品には、こちらから渡す必要がある（ADR 0044 決定 7）。
   */
  dark?: boolean;
};

/** ホバーのカードを出すメッセージと、その中身。 */
function profileHover(profile: NonNullable<ChatOptions["profile"]>) {
  switch (profile) {
    case "hover-self":
      return { key: profileKeys.you, profile: profiles.you };
    case "hover-former":
      return { key: profileKeys.former, profile: profiles.former };
    default:
      return { key: profileKeys.naoki, profile: profiles.naoki };
  }
}

/** 右のパネル（モバイルは全画面）。 */
function profilePanelContent(profile: NonNullable<ChatOptions["profile"]>) {
  switch (profile) {
    case "panel-menu":
      return <ProfilePanel profile={profiles.naoki} menuOpen />;
    case "panel-manage":
      return <ProfilePanel profile={profiles.ryo} menuOpen />;
    case "panel-self":
      return <ProfilePanel profile={profiles.you} />;
    case "panel-loading":
      return <ProfilePanel profile={profiles.miyukiLoading} />;
    case "panel-unverified":
      return <ProfilePanel profile={profiles.miyukiUnverified} />;
    case "panel-former":
      return <ProfilePanel profile={profiles.former} />;
    case "panel-unknown":
      return <ProfilePanel profile={{ kind: "unknown" }} />;
    case "panel-from-members":
      return <ProfilePanel profile={profiles.naoki} onBack={noop} />;
    default:
      return <ProfilePanel profile={profiles.naoki} />;
  }
}

/** スレッドのパネルに出す親と返信。 */
function threadPanelContent(thread: NonNullable<ChatOptions["thread"]>) {
  switch (thread) {
    case "replies":
      return { root: threadRoot, replies: threadReplies, typing: [users.naoki.name] };
    case "empty":
      return { root: threadRootWithoutReplies, replies: [], typing: [] };
    case "root-deleted":
      return { root: deletedThreadRoot, replies: deletedThreadReplies, typing: [] };
    case "broadcast":
      return { root: threadRoot, replies: threadRepliesWithBroadcast, typing: [] };
  }
}

/** スレッドの画面のタイムライン。親が削除されたスレッドは、その親（tombstone と「N 件の返信」）を先頭に足す。 */
function threadTimeline(thread: NonNullable<ChatOptions["thread"]>) {
  if (thread === "broadcast") return timelineWithBroadcast;
  if (thread !== "root-deleted") return timelineWithThreads;
  const [date, ...rest] = timelineWithThreads;
  return [date, { type: "message" as const, message: deletedThreadRoot }, ...rest];
}

export function chat({
  avatars,
  systemMessages,
  banner,
  attachments,
  hoveredKey,
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
  mentions,
  mentionQuery,
  jump,
  linkCards,
  formatting,
  reactions,
  messageAttachments,
  presence,
  statusDialog,
  profile,
  dark,
}: ChatOptions = {}) {
  // 非公開チャンネルから外されたら、一覧からもヘッダーからも名前を消す（ADR 0035）
  const roomRemoved = body === "removed-room";
  const threadContent = thread ? threadPanelContent(thread) : undefined;
  const hover = profile?.startsWith("hover-") ? profileHover(profile) : undefined;
  const profilePanel = profile?.startsWith("panel-") ? profilePanelContent(profile) : undefined;
  // ステータスの出ている画面の上に出す（名前の横の絵文字とカードの中身をそろえて見せる）
  const withStatus = presence || profile !== undefined;
  return (
    <>
      <ChatLayout
        mobileView={mobileView}
        sidebar={
          <Sidebar
            workspace={workspaces.dev}
            currentUser={currentUser}
            rooms={
              noRooms
                ? []
                : roomRemoved
                  ? rooms.filter((r) => r.id !== selectedRoom.id)
                  : mentions
                    ? roomsWithMentions
                    : presence
                      ? roomsWithStatus
                      : rooms
            }
            selectedRoomId={roomRemoved || threads ? undefined : selectedRoom.id}
            threads={
              thread || threads
                ? { href: noHref, unreadCount: threads === "empty" ? 0 : unreadThreadCount, selected: Boolean(threads) }
                : undefined
            }
            roomHref={roomHref}
            search={search}
            onCreateRoom={noop}
            onStartDm={noop}
            accountMenuOpen={accountMenu}
            accountMenu={
              <AccountMenu
                user={{ ...users.you, handle: users.you.handle, status: presence ? myStatus : undefined }}
                away={presence}
              />
            }
            switcherOpen={switcher}
            switcher={
              <WorkspaceSwitcher workspaces={[workspaces.dev, workspaces.memo]} currentWorkspaceId={workspaces.dev.id} />
            }
          />
        }
        panel={
          members ? (
            <MembersPanel
              members={withStatus ? roomMembersWithPresence : roomMembers}
              onOpenProfile={profile ? noop : undefined}
            />
          ) : profilePanel ? (
            profilePanel
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
              <Timeline items={threadItems(threadContent.root, threadContent.replies)} />
            </ThreadPanel>
          ) : undefined
        }
      >
        {threads && <ThreadList threads={threads === "empty" ? [] : threadList} threadHref={roomHref} />}
        {!roomRemoved && !threads && (
          <RoomHeader
            kind={selectedRoom.kind}
            name={selectedRoom.name}
            memberCount={selectedRoom.memberCount}
            membersOpen={members}
            onOpenSettings={noop}
          />
        )}
        <ConnectionBanner status={banner ?? null} />
        {jump === "unread-bar" && <UnreadJumpBar count={12} onJump={noop} />}
        {jump === "not-found" && <MessageNotFoundNotice onClose={noop} />}
        {body === "timeline" && !threads && (
          <Timeline
            items={
              profile === "hover-former" || profile === "panel-former"
                ? timelineWithFormerMember
                : withStatus
                ? timelineWithStatus
                : messageAttachments
                ? timelineWithImages
                : reactions
                ? timelineWithReactions
                : linkCards
                ? timelineWithLinkCards
                : formatting
                ? timelineWithFormatting
                : jump
                ? timelineJumped
                : thread
                ? threadTimeline(thread)
                : mentions
                  ? timelineWithMentions
                  : broadcastInChannel
                  ? timelineWithBroadcast
                  : systemMessages
                  ? timelineWithSystemMessages
                  : avatars
                    ? timelineWithAvatars
                    : timeline
            }
            openThreadKey={thread === "root-deleted" ? deletedThreadRoot.key : thread ? threadContent?.root.key : undefined}
            highlightedKey={jump === "highlight" ? jumpTargetKey : undefined}
            hoveredKey={hoveredKey}
            onToggleReaction={noop}
            onTogglePicker={noop}
            openPickerKey={
              reactions === "picker" ? reactionPickerKey : reactions === "picker-above" ? lastMessageKey : undefined
            }
            reactionPicker={<EmojiPicker onPick={noop} theme={dark ? "dark" : "light"} />}
            onOpenProfile={profile ? noop : undefined}
            profileHoverCardFor={hover ? () => <ProfileHoverCard profile={hover.profile} /> : undefined}
            hoveredProfileKey={hover?.key}
            hoveredReaction={reactions === "names" ? hoveredReaction : undefined}
            onReply={noop}
            onOpenImage={noop}
            onDeleteAttachment={noop}
            openAttachmentMenu={
              messageAttachments === "menu" ? { key: attachmentMessageKey, attachmentId: "a-2" } : undefined
            }
            onToggleAttachmentMenu={noop}
            actionsFor={(key) => ({
              canEdit: key === pendingMessageKey,
              // 添付だけを削除できるのは、メッセージを削除できる人と同じ（ADR 0045 決定 5）
              canDelete: key === pendingMessageKey || (messageAttachments !== undefined && key === attachmentMessageKey),
            })}
            openMenuKey={menuKey}
            editingKey={editingKey}
            editing={{ value: "了解です。今日の夕方までに一覧を更新して、また共有します。" }}
          />
        )}
        {body === "empty" && <EmptyMessages kind={selectedRoom.kind} name={selectedRoom.name} />}
        {roomRemoved && <RoomUnavailable />}
        {body === "removed-workspace" && <RemovedFromWorkspace workspaceName={workspaces.dev.name} />}
        {footer === "composer" && !threads && (
          <Composer
            value={mentionQuery === undefined ? "" : `金曜の件、@${mentionQuery}`}
            canSend={mentionQuery !== undefined}
            typingNames={mentions ? [] : typingNames}
            attachments={attachments}
            mentionCandidates={mentionCandidates}
            forceMentionQuery={mentionQuery}
          />
        )}
        {footer === "join" && <JoinRoomBar />}
      </ChatLayout>
      {dialog}
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
    </>
  );
}

/** サイドバーだけを切り出したフレーム（足した「+」を見るため）。 */
export function sidebarFrame() {
  return (
    <div className="h-140 w-80 border-r border-border">
      <Sidebar
        workspace={workspaces.dev}
        currentUser={currentUser}
        rooms={rooms}
        selectedRoomId={selectedRoom.id}
        roomHref={roomHref}
        onCreateRoom={noop}
        onStartDm={noop}
      />
    </div>
  );
}

/** ルームのヘッダーだけを切り出したフレーム（足した設定のボタンを見るため）。 */
export function roomHeaderFrame() {
  return (
    <div className="w-180 bg-surface">
      <RoomHeader
        kind={selectedRoom.kind}
        name={selectedRoom.name}
        memberCount={selectedRoom.memberCount}
        onOpenSettings={noop}
        onToggleMembers={noop}
      />
    </div>
  );
}

// ---- ワークスペースの管理 ----

const adminHrefs: Record<AdminSection, string> = { settings: noHref, members: noHref, invites: noHref };

function admin(role: WorkspaceRole, section: AdminSection, children: ReactNode, overlay?: ReactNode) {
  return (
    <>
      <WorkspaceAdminLayout
        workspace={workspaces.yama}
        currentUser={{ ...users.you, role }}
        section={section}
        memberCount={6}
        activeInviteCount={1}
        hrefs={adminHrefs}
        backHref={noHref}
      >
        {children}
      </WorkspaceAdminLayout>
      {overlay}
    </>
  );
}

export function settingsPage(role: WorkspaceRole, overlay?: ReactNode) {
  return admin(role, "settings", <WorkspaceSettings role={role} name={workspaces.yama.name} invitePolicy="admins_only" />, overlay);
}

export function membersPage(role: WorkspaceRole, openMenu: MemberMenuState = null, overlay?: ReactNode) {
  return admin(role, "members", <MemberList members={membersAs(role)} openMenu={openMenu} />, overlay);
}

export function invitesPage(role: WorkspaceRole, policy: "admins_only" | "all_members" = "admins_only", overlay?: ReactNode) {
  const canCreate = role !== "member" || policy === "all_members";
  return admin(
    role,
    "invites",
    <InviteList
      invites={invitesAs(role)}
      canCreate={canCreate}
      createLockedReason={canCreate ? undefined : "管理者だけが招待リンクを作成できます。"}
    />,
    overlay,
  );
}

// ---- ユーザー設定 ----

export const settingsHrefs: Record<SettingsSection, string> = { profile: noHref, devices: noHref, appearance: noHref };

export function userSettings(section: SettingsSection, children: ReactNode) {
  return (
    <SettingsLayout section={section} hrefs={settingsHrefs} backHref={noHref} chatHref={noHref}>
      {children}
    </SettingsLayout>
  );
}

export const invitePreview = {
  workspace: { id: workspaces.yama.id, name: workspaces.yama.name, memberCount: 6, publicRoomCount: 8 },
  inviter: { id: users.misaki.id, name: users.misaki.name },
};

export const inviteFooter = (
  <>
    別のアカウントで開きますか？{" "}
    <button type="button" className="font-medium text-primary hover:underline">
      ログアウト
    </button>
  </>
);

/**
 * 拡大表示（ADR 0045）。閉じる・送る・ダウンロードはどの画面でも同じなので、ここでまとめる。
 * 消せない人の画面だけ削除を出さない（決定 9）。
 */
export function imageViewer(images: ComponentProps<typeof ImageViewer>["images"], index: number, canDelete = true) {
  return (
    <ImageViewer
      images={images}
      index={index}
      onMove={noop}
      onClose={noop}
      onDownload={noop}
      onDelete={canDelete ? noop : undefined}
    />
  );
}

/** チャンネルの設定のダイアログ。読み取り専用（member）のときだけ退出を出す。 */
export function roomSettingsDialog({ canEdit, onLeave }: { canEdit: boolean; onLeave?: () => void }) {
  return (
    <RoomSettingsDialog open kind="private" name="リリース準備" canEdit={canEdit} members={roomSettingsMembers} onLeave={onLeave} />
  );
}
