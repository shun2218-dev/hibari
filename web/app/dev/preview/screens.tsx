"use client";

/**
 * /dev/preview の各画面。presentational コンポーネントにモックデータを渡して、docs/ui/screenshots/ と同じ状態を描く。
 * 操作しても状態は変わらない（見た目の確認だけが目的。データの流れは Phase 6-2）。
 */
import type { ReactNode } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import {
  ForgotPasswordForm,
  ForgotPasswordSent,
  ResetPasswordDone,
  ResetPasswordForm,
  ResetPasswordInvalid,
} from "@/components/auth/password-reset";
import { SignupForm } from "@/components/auth/signup-form";
import {
  VerifyEmailChecking,
  VerifyEmailDone,
  VerifyEmailInvalid,
  VerifyEmailPending,
} from "@/components/auth/verify-email";
import { ChatLayout } from "@/components/chat/chat-layout";
import {
  EmptyMessages,
  JoinRoomBar,
  RemovedFromRoom,
  RemovedFromWorkspace,
  ServerUnavailable,
} from "@/components/chat/chat-states";
import { AccountMenu } from "@/components/chat/account-menu";
import { Composer } from "@/components/chat/composer";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { MembersPanel } from "@/components/chat/members-panel";
import { RoomHeader } from "@/components/chat/room-header";
import {
  AddRoomMemberDialog,
  CreateRoomDialog,
  DeleteMessageDialog,
  RoomSettingsDialog,
  StartDmDialog,
} from "@/components/chat/room-dialogs";
import { Sidebar } from "@/components/chat/sidebar";
import { Timeline } from "@/components/chat/timeline";
import type { AttachmentDraftView, ConnectionBannerStatus } from "@/components/chat/types";
import { WorkspaceSwitcher } from "@/components/chat/workspace-switcher";
import { InviteAccept } from "@/components/invite/invite-accept";
import { SettingsLayout, SettingsMobileMenu, type SettingsSection } from "@/components/settings/settings-layout";
import { AppearanceSettings, DevicesSettings, ProfileSettings } from "@/components/settings/settings-sections";
import { type AdminSection, WorkspaceAdminLayout } from "@/components/workspace/admin-layout";
import { CreateInviteDialog, InviteCreatedDialog, InviteList } from "@/components/workspace/invites";
import {
  KickMemberDialog,
  LeaveBlockedDialog,
  LeaveWorkspaceDialog,
  TransferOwnershipConfirmDialog,
  TransferOwnershipPickDialog,
} from "@/components/workspace/member-dialogs";
import { type MemberMenuState, MemberList } from "@/components/workspace/member-list";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import { NoWorkspaces } from "@/components/workspace/no-workspaces";
import type { WorkspaceRole } from "@/components/workspace/types";
import { WorkspaceSettings } from "@/components/workspace/workspace-settings";

import {
  currentUser,
  devices,
  dmCandidates,
  mockAvatars,
  roomSettingsMembers,
  invitesAs,
  membersAs,
  pendingMessageKey,
  roomMembers,
  rooms,
  selectedRoom,
  timeline,
  timelineWithAvatars,
  transferCandidates,
  typingNames,
  users,
  workspaces,
} from "./fixtures";

const noHref = "#";
const roomHref = () => noHref;

// ---- 認証 ----

const goodStrength = { level: 3, label: "良い" } as const;

// 渡したときだけ出る操作を、スクリーンショットと同じく出しておくための何もしないハンドラ。
const noop = () => {};

function auth(children: ReactNode, footer?: ReactNode) {
  return <AuthShell footer={footer}>{children}</AuthShell>;
}

function login(error?: "credentials" | "rate_limited") {
  return auth(<LoginForm error={error} forgotPasswordHref={noHref} signupHref={noHref} />);
}

// ---- チャット ----

type ChatOptions = {
  /** アバター画像を設定している人が混ざったタイムラインにする。 */
  avatars?: boolean;
  banner?: ConnectionBannerStatus;
  attachments?: AttachmentDraftView[];
  hoveredKey?: string;
  noRooms?: boolean;
  search?: string;
  accountMenu?: boolean;
  menuKey?: string;
  editingKey?: string;
  replyTo?: { senderName: string; body: string };
  /** チャット画面の上に重ねるダイアログ。 */
  dialog?: ReactNode;
  body?: "timeline" | "empty" | "removed-room" | "removed-workspace";
  footer?: "composer" | "join" | "none";
  members?: boolean;
  switcher?: boolean;
  createWorkspace?: boolean;
  mobileView?: "list" | "room";
};

function chat({
  avatars,
  banner,
  attachments,
  hoveredKey,
  noRooms,
  search,
  accountMenu,
  menuKey,
  editingKey,
  replyTo,
  dialog,
  body = "timeline",
  footer = "composer",
  members,
  switcher,
  createWorkspace,
  mobileView = "room",
}: ChatOptions = {}) {
  return (
    <>
      <ChatLayout
        mobileView={mobileView}
        sidebar={
          <Sidebar
            workspace={workspaces.dev}
            currentUser={currentUser}
            rooms={noRooms ? [] : rooms}
            selectedRoomId={selectedRoom.id}
            roomHref={roomHref}
            search={search}
            onCreateRoom={noop}
            onStartDm={noop}
            accountMenuOpen={accountMenu}
            accountMenu={<AccountMenu user={{ ...users.you, handle: users.you.handle }} />}
            switcherOpen={switcher}
            switcher={
              <WorkspaceSwitcher workspaces={[workspaces.dev, workspaces.memo]} currentWorkspaceId={workspaces.dev.id} />
            }
          />
        }
        panel={members ? <MembersPanel members={roomMembers} /> : undefined}
      >
        <RoomHeader
          kind={selectedRoom.kind}
          name={selectedRoom.name}
          memberCount={selectedRoom.memberCount}
          membersOpen={members}
          onOpenSettings={noop}
        />
        <ConnectionBanner status={banner ?? null} />
        {body === "timeline" && (
          <Timeline
            items={avatars ? timelineWithAvatars : timeline}
            hoveredKey={hoveredKey}
            actionsFor={(key) => ({ canEdit: key === pendingMessageKey, canDelete: key === pendingMessageKey })}
            openMenuKey={menuKey}
            editingKey={editingKey}
            editing={{ value: "了解です。今日の夕方までに一覧を更新して、また共有します。" }}
          />
        )}
        {body === "empty" && <EmptyMessages kind={selectedRoom.kind} name={selectedRoom.name} />}
        {body === "removed-room" && <RemovedFromRoom kind={selectedRoom.kind} name={selectedRoom.name} />}
        {body === "removed-workspace" && <RemovedFromWorkspace workspaceName={workspaces.dev.name} />}
        {footer === "composer" && (
          <Composer value="" canSend={false} typingNames={typingNames} attachments={attachments} replyTo={replyTo} />
        )}
        {footer === "join" && <JoinRoomBar />}
      </ChatLayout>
      {dialog}
      <CreateWorkspaceDialog open={Boolean(createWorkspace)} />
    </>
  );
}

/** サイドバーだけを切り出したフレーム（足した「+」を見るため）。 */
function sidebarFrame() {
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
function roomHeaderFrame() {
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

function settingsPage(role: WorkspaceRole, overlay?: ReactNode) {
  return admin(role, "settings", <WorkspaceSettings role={role} name={workspaces.yama.name} invitePolicy="admins_only" />, overlay);
}

function membersPage(role: WorkspaceRole, openMenu: MemberMenuState = null, overlay?: ReactNode) {
  return admin(role, "members", <MemberList members={membersAs(role)} openMenu={openMenu} />, overlay);
}

function invitesPage(role: WorkspaceRole, policy: "admins_only" | "all_members" = "admins_only", overlay?: ReactNode) {
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

const settingsHrefs: Record<SettingsSection, string> = { profile: noHref, devices: noHref, appearance: noHref };

function userSettings(section: SettingsSection, children: ReactNode) {
  return (
    <SettingsLayout section={section} hrefs={settingsHrefs} backHref={noHref} chatHref={noHref}>
      {children}
    </SettingsLayout>
  );
}

const invitePreview = {
  workspace: { id: workspaces.yama.id, name: workspaces.yama.name, memberCount: 6, publicRoomCount: 8 },
  inviter: { id: users.misaki.id, name: users.misaki.name },
};

const inviteFooter = (
  <>
    別のアカウントで開きますか？{" "}
    <button type="button" className="font-medium text-primary hover:underline">
      ログアウト
    </button>
  </>
);

export const previewScreens: Record<string, () => ReactNode> = {
  "auth/login": () => login(),
  "auth/login-error-credentials": () => login("credentials"),
  "auth/login-error-rate-limit": () => login("rate_limited"),
  "auth/login-dark": () => login("credentials"),
  "auth/mobile-login": () => login("credentials"),
  "auth/signup": () => auth(<SignupForm loginHref={noHref} passwordStrength={goodStrength} passwordDefaultValue="correct-horse" />),
  "auth/forgot": () => auth(<ForgotPasswordForm loginHref={noHref} />),
  "auth/forgot-error-rate-limit": () =>
    auth(
      <ForgotPasswordForm
        loginHref={noHref}
        error="再設定メールの送信が多すぎます。しばらく時間をおいてから再度お試しください。"
      />,
    ),
  "auth/forgot-sent": () => auth(<ForgotPasswordSent loginHref={noHref} />),
  "auth/reset": () => auth(<ResetPasswordForm passwordStrength={goodStrength} passwordDefaultValue="correct-horse" />),
  "auth/reset-error-invalid-input": () =>
    auth(
      <ResetPasswordForm
        error="パスワードは8文字以上にしてください。"
        passwordStrength={{ level: 1, label: "短すぎます" }}
        passwordDefaultValue="horse"
      />,
    ),
  "auth/reset-done": () => auth(<ResetPasswordDone />),
  "auth/reset-invalid": () => auth(<ResetPasswordInvalid loginHref={noHref} />),
  "auth/verify-pending": () => auth(<VerifyEmailPending email="naoki@example.com" onChangeEmail={noop} />),
  "auth/verify-checking": () => auth(<VerifyEmailChecking />),
  "auth/verify-done": () => auth(<VerifyEmailDone />),
  "auth/verify-invalid": () => auth(<VerifyEmailInvalid />),

  "chat/default": () => chat(),
  "chat/default-dark": () => chat(),
  "chat/messages-all-states": () => chat(),
  "chat/messages-all-states-dark": () => chat(),
  "chat/message-hover-actions": () => chat({ hoveredKey: pendingMessageKey }),
  "chat/banner-reconnecting": () => chat({ banner: "reconnecting" }),
  "chat/banner-syncing": () => chat({ banner: "syncing" }),
  "chat/banner-restored": () => chat({ banner: "restored" }),
  "chat/attachment-uploading": () =>
    chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "uploading", progress: 62 }] }),
  "chat/attachment-failed": () => chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "failed" }] }),
  "chat/attachment-done": () =>
    chat({ attachments: [{ id: "up-1", fileName: "サイドバー改訂.fig", status: "uploaded", sizeLabel: "1.8 MB" }] }),
  "chat/empty-rooms": () => chat({ noRooms: true }),
  "chat/empty-messages": () => chat({ body: "empty" }),
  "chat/public-preview": () => chat({ footer: "join" }),
  "chat/removed-from-channel": () => chat({ body: "removed-room", footer: "none" }),
  "chat/removed-from-workspace": () => chat({ body: "removed-workspace", footer: "none" }),
  "chat/members-panel": () => chat({ members: true }),
  "chat/workspace-switcher": () => chat({ switcher: true }),
  "chat/workspace-create-dialog": () => chat({ createWorkspace: true }),
  "chat/server-error": () => <ServerUnavailable lastConnectedLabel="11:07" retryCount={3} />,
  "chat/channel-create-dialog": () => chat({ dialog: <CreateRoomDialog open name="デザインレビュー" kind="public" /> }),
  "chat/dm-dialog": () =>
    chat({
      dialog: (
        <StartDmDialog
          open
          candidates={dmCandidates}
          selectedId={users.naoki.id}
        />
      ),
    }),
  "chat/room-settings-dialog": () =>
    chat({
      dialog: (
        <RoomSettingsDialog
          open
          kind="private"
          name="リリース準備"
          canEdit
          members={roomSettingsMembers}
        />
      ),
    }),
  "chat/message-menu": () => chat({ menuKey: pendingMessageKey, hoveredKey: pendingMessageKey }),
  "chat/message-editing": () => chat({ editingKey: pendingMessageKey }),
  "chat/message-delete-dialog": () =>
    chat({ dialog: <DeleteMessageDialog open body="了解です。今日の夕方までに一覧を更新して、また共有します。" /> }),
  "chat/composer-reply": () =>
    chat({ replyTo: { senderName: users.naoki.name, body: "4px だと主張が強すぎて、名前より先に目が行ってしまう。" } }),
  "chat/account-menu": () => chat({ accountMenu: true }),
  "chat/search-empty": () => chat({ noRooms: true, search: "見積" }),
  "chat/empty-workspaces": () => <NoWorkspaces />,
  "chat/avatar-images": () => chat({ avatars: true }),
  "chat/sidebar-add-entries": sidebarFrame,
  "chat/room-header-settings": roomHeaderFrame,
  "chat/member-add-dialog": () =>
    chat({ dialog: <AddRoomMemberDialog open candidates={dmCandidates} selectedId={users.ryo.id} /> }),
  "chat/mobile-rooms": () => chat({ mobileView: "list" }),
  "chat/mobile-room": () => chat(),
  "chat/mobile-members-sheet": () => chat({ members: true }),

  "invite/accept-preview": () =>
    auth(<InviteAccept state={{ status: "valid", preview: invitePreview }} homeHref={noHref} />, inviteFooter),
  "invite/accept-already": () =>
    auth(<InviteAccept state={{ status: "already_member", preview: invitePreview }} homeHref={noHref} />, inviteFooter),
  "invite/accept-invalid": () => auth(<InviteAccept state={{ status: "invalid" }} homeHref={noHref} />, inviteFooter),
  "invite/accept-expired": () => auth(<InviteAccept state={{ status: "expired" }} homeHref={noHref} />, inviteFooter),
  "invite/accept-maxed": () => auth(<InviteAccept state={{ status: "maxed" }} homeHref={noHref} />, inviteFooter),

  "workspace/settings-as-owner": () => settingsPage("owner"),
  "workspace/settings-as-admin": () => settingsPage("admin"),
  "workspace/settings-as-member": () => settingsPage("member"),
  "workspace/members-as-owner": () => membersPage("owner"),
  "workspace/members-as-admin": () => membersPage("admin"),
  "workspace/members-as-member": () => membersPage("member"),
  "workspace/members-dark": () => membersPage("owner"),
  "workspace/mobile-members": () => membersPage("owner"),
  "workspace/member-menu-role-picker": () => membersPage("owner", { userId: users.misaki.id, kind: "roles" }),
  "workspace/member-menu-locked-reason": () => membersPage("admin", { userId: users.misaki.id, kind: "locked" }),
  "workspace/member-menu-with-kick": () => membersPage("owner", { userId: users.suzuki.id, kind: "roles" }),
  "workspace/dialog-kick": () => membersPage("owner", null, <KickMemberDialog open memberName={users.suzuki.name} />),
  "workspace/dialog-transfer-pick": () =>
    settingsPage("owner", <TransferOwnershipPickDialog open candidates={transferCandidates} selectedId={users.misaki.id} />),
  "workspace/dialog-transfer-confirm": () =>
    settingsPage(
      "owner",
      <TransferOwnershipConfirmDialog open newOwnerName={users.misaki.name} workspaceName={workspaces.yama.name} />,
    ),
  "workspace/dialog-leave": () => settingsPage("member", <LeaveWorkspaceDialog open workspaceName={workspaces.yama.name} />),
  "workspace/dialog-leave-blocked-owner": () => settingsPage("owner", <LeaveBlockedDialog open />),
  "workspace/back-to-chat": () => settingsPage("owner"),
  "workspace/invites-as-owner": () => invitesPage("owner"),
  "workspace/invites-as-admin": () => invitesPage("admin"),
  "workspace/invites-as-member": () => invitesPage("member"),
  "workspace/invites-as-member-policy-all": () => invitesPage("member", "all_members"),
  "workspace/dialog-invite-new": () =>
    invitesPage("owner", "admins_only", <CreateInviteDialog open maxUses={10} expiresInSeconds={7 * 24 * 60 * 60} />),
  "workspace/dialog-invite-created": () =>
    invitesPage(
      "owner",
      "admins_only",
      <InviteCreatedDialog open url="https://hibari.app/j/7Qv2xkR8mA" summary={`10 回 · 7 日後に失効 · ${workspaces.yama.name}`} />,
    ),

  "settings/profile": () =>
    userSettings("profile", <ProfileSettings user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle }} />),
  "settings/devices": () => userSettings("devices", <DevicesSettings devices={devices} />),
  "settings/devices-dark": () => userSettings("devices", <DevicesSettings devices={devices} />),
  "settings/profile-avatar": () =>
    userSettings(
      "profile",
      <ProfileSettings
        user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle, avatarUrl: mockAvatars.you }}
      />,
    ),
  "settings/profile-avatar-uploading": () =>
    userSettings(
      "profile",
      <ProfileSettings
        avatarState="uploading"
        user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle, avatarUrl: mockAvatars.you }}
      />,
    ),
  "settings/profile-avatar-failed": () =>
    userSettings(
      "profile",
      <ProfileSettings
        avatarState="failed"
        user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle }}
      />,
    ),
  "settings/appearance": () => userSettings("appearance", <AppearanceSettings theme="light" density="comfortable" />),
  "settings/back-to-chat": () =>
    userSettings("profile", <ProfileSettings user={{ id: users.you.id, displayName: users.you.name, handle: users.you.handle }} />),
  "settings/mobile-list": () => <SettingsMobileMenu hrefs={settingsHrefs} chatHref={noHref} />,
  "settings/mobile-back-to-chat": () => <SettingsMobileMenu hrefs={settingsHrefs} chatHref={noHref} />,
};

export function PreviewScreen({ name, dark }: { name: string; dark: boolean }) {
  const render = previewScreens[name];
  return (
    <div data-theme={dark ? "dark" : undefined} className="min-h-dvh bg-background text-text">
      {render?.()}
    </div>
  );
}
