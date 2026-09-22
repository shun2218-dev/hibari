"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AccountMenu } from "@/components/chat/account-menu";
import { ChatLayout } from "@/components/chat/chat-layout";
import { RemovedFromWorkspace, ServerUnavailable } from "@/components/chat/chat-states";
import { Sidebar } from "@/components/chat/sidebar";
import { WorkspaceSwitcher } from "@/components/chat/workspace-switcher";
import { useSession, useSessionState } from "@/lib/auth/session-provider";
import { useAvatarUrls, useChatState, useChatStore, useRealtime } from "@/lib/chat/chat-provider";
import { formatTime } from "@/lib/chat/format";
import { forgetLocation, lastRoomId, rememberLocation } from "@/lib/chat/last-location";
import { countUnreadThreads } from "@/lib/chat/threads";
import { memberSettings, statusView, toRoomSummaryView } from "@/lib/chat/views";

import { MyStatusDialog } from "./my-status";

import { CreateWorkspace } from "../../../create-workspace";
import { CreateRoom } from "./create-room";
import { useDesktopNotifications } from "./desktop-notifications";
import { StartDm } from "./start-dm";
import { type ProfileSender, RoomProfile } from "./profile";
import { RoomMembers } from "./room-members";
import { RoomThread } from "./room-thread";
import { RoomView } from "./room-view";
import { WorkspaceSaved } from "./workspace-saved";
import { WorkspaceThreads } from "./workspace-threads";

export function WorkspaceScreen() {
  const { workspaceId, roomId } = useParams<{ workspaceId: string; roomId?: string }>();
  // 開いているスレッドと、飛び先のメッセージは URL のクエリに持つ（ADR 0037 / 0040 / 0042）。
  // 一覧やリンクから開いた画面も、リロードすると同じ所に戻る
  const searchParams = useSearchParams();
  const threadId = searchParams.get("t") ?? undefined;
  const jumpMessageId = searchParams.get("m") ?? undefined;
  // 開いているプロフィール（ADR 0050 決定 6 の追記）。スレッドと同じく URL に持ち、モバイルの全画面を「戻る」で閉じられるようにする
  const profileId = searchParams.get("p") ?? undefined;
  const pathname = usePathname();
  const threadsView = pathname === `/w/${workspaceId}/threads`;
  // 「後で」（ADR 0054）。スレッドの一覧と同じく、ルームの代わりにメインの領域に出す
  const savedView = pathname === `/w/${workspaceId}/saved`;
  const router = useRouter();
  const notificationBanner = useDesktopNotifications();
  const session = useSession();
  const { state: sessionState } = useSessionState();
  const store = useChatStore();
  const realtime = useRealtime();
  const workspaces = useChatState((s) => s.workspaces);
  const roomList = useChatState((s) => s.roomLists[workspaceId]);
  const rooms = useChatState((s) => s.rooms);
  const unavailable = useChatState((s) => s.connection.unavailable);
  const removal = useChatState((s) => s.removedWorkspaces[workspaceId]);
  const threadList = useChatState((s) => s.threadLists[workspaceId]);
  const members = useChatState((s) => s.members[workspaceId]);
  const unreadThreadCount = useChatState((s) => s.unreadThreadCounts[workspaceId]);
  // 開いているルームを読めない（外された、URL のルームが読めない）。メンバーのパネルも閉じる（名前を見せない。ADR 0035）
  const roomRemoved = useChatState((s) =>
    roomId ? s.removedRooms[roomId] !== undefined || s.timelines[roomId]?.status === "not_found" : false,
  );

  const [search, setSearch] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [startingDm, setStartingDm] = useState(false);
  // 右の枠に出す、URL に持たないパネル（メンバー）。スレッドとプロフィールは URL に持つので、そちらが優先する
  const [sidePanel, setSidePanel] = useState<"members" | null>(null);
  const membersOpen = sidePanel === "members";
  const [statusOpen, setStatusOpen] = useState(false);
  // プロフィールをどこから開いたか。メンバーパネルからなら「メンバーに戻る」を出し、メッセージからなら送信者の値を
  // 一覧にいない人（外された人）の名前の手がかりにする。URL には持たない（開き直すと「戻る」と手がかりは消える）
  const [profileOrigin, setProfileOrigin] = useState<{ userId: string; fromMembers: boolean; sender?: ProfileSender }>();
  // モバイルで「一覧に戻る」を押した。URL はルームのままにして、別のルームを開いたら詳細に戻す
  const [listShownFor, setListShownFor] = useState<string>();

  // キックされたワークスペースは一覧から消えるが、「削除されました」を出している間は名前とサイドバーを残す
  const removedFromWorkspace = removal?.reason === "removed";
  const workspace =
    workspaces.list.find((w) => w.id === workspaceId) ?? (removedFromWorkspace ? removal.workspace : undefined);

  useEffect(() => {
    store.loadWorkspaces();
  }, [store]);

  // ワークスペースのメンバー一覧は、名前の横のステータスと DM の相手の presence に使う（ADR 0049 決定 7 の追記）
  useEffect(() => {
    store.loadMembers(workspaceId);
  }, [store, workspaceId]);

  // 表示中のワークスペースとそのルームを購読する（lib/chat/realtime.ts）
  useEffect(() => {
    store.setActiveWorkspace(workspaceId);
    return () => store.setActiveWorkspace(null);
  }, [store, workspaceId]);

  useEffect(() => {
    store.loadRooms(workspaceId);
    // サイドバーの「スレッド」のバッジは、参加しているスレッドの一覧から数える（ADR 0037）
    store.loadThreads(workspaceId);
    // 「後で」の差分のカーソルを決め、メッセージの印の変化を取りこぼさないようにする（ADR 0054 決定 7）
    void store.loadSaved(workspaceId, "in_progress");
    // ブラウザ通知の判定に使う全体の設定（ADR 0057）。ルームを開かなくても要る
    void store.loadNotificationLevel(workspaceId);
  }, [store, workspaceId]);

  // メンバーではない（URL を直接開いた、キックされた）ワークスペースは覚えている場所から外して、入口に戻す。
  // 404 と「存在しない」を区別しない（ADR 0011）ので、画面も分けない
  const notMember =
    !removedFromWorkspace && ((workspaces.status === "ready" && !workspace) || roomList?.status === "not_found");
  useEffect(() => {
    if (!notMember) return;
    forgetLocation(workspaceId);
    router.replace("/");
  }, [notMember, workspaceId, router]);

  useEffect(() => {
    if (workspace) rememberLocation(workspace.id, roomId);
  }, [workspace, roomId]);

  // ルームを選んでいなければ、最後に開いたルーム → is_default のルーム → 一覧の先頭の順に開く
  useEffect(() => {
    if (roomId || threadsView || savedView || roomList?.status !== "ready" || roomList.ids.length === 0) return;
    const remembered = lastRoomId(workspaceId);
    const target =
      roomList.ids.find((id) => id === remembered) ??
      roomList.ids.find((id) => rooms[id]?.is_default && rooms[id]?.is_member) ??
      roomList.ids[0];
    router.replace(`/w/${workspaceId}/r/${target}`);
  }, [roomId, threadsView, savedView, roomList, rooms, workspaceId, router]);

  // サイドバーに出す人（自分と DM の相手）のアバター。自分の avatar_url もログインの応答にあるが、1 時間で切れるので同じ経路で取り直す
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const sidebarUserIds = useMemo(() => {
    const ids = (roomList?.ids ?? []).flatMap((id) => (rooms[id]?.dm_peer ? [rooms[id].dm_peer.id] : []));
    return me ? [me.id, ...ids] : ids;
  }, [roomList, rooms, me]);
  const avatarUrls = useAvatarUrls(sidebarUserIds);

  const memberTable = useMemo(() => memberSettings(members?.list), [members]);
  const myMember = useMemo(() => members?.list.find((m) => m.user.id === me?.id), [members, me]);
  const myStatus = useMemo(() => statusView(myMember?.status), [myMember]);

  const roomViews = useMemo(() => {
    if (roomList?.status !== "ready") return [];
    const now = new Date();
    const query = search.trim().toLowerCase();
    return roomList.ids
      .flatMap((id) => {
        const room = rooms[id];
        return room ? [toRoomSummaryView(room, now, { avatarUrls, members: memberTable })] : [];
      })
      .filter((view) => query === "" || view.name.toLowerCase().includes(query));
  }, [roomList, rooms, search, avatarUrls, memberTable]);

  function openThread(rootId: string) {
    setSidePanel(null);
    // 飛び先（?m=）は残す。リンクで開いた返信のスレッドを、パネルの中でも同じ所に合わせるため（ADR 0042）
    const params = new URLSearchParams(searchParams);
    params.set("t", rootId);
    // 右の枠は 1 つ。スレッドを開くならプロフィールを閉じる
    params.delete("p");
    router.push(`/w/${workspaceId}/r/${roomId}?${params}`);
  }

  function closeThread() {
    const params = new URLSearchParams(searchParams);
    params.delete("t");
    const query = params.toString();
    router.replace(`/w/${workspaceId}/r/${roomId}${query === "" ? "" : `?${query}`}`);
  }

  /** メンバーのパネルを開け閉てする。右のパネルは 1 つなので、開くならスレッドとプロフィールを閉じる。 */
  function toggleSidePanel(panel: "members") {
    const covered = threadId !== undefined || profileId !== undefined;
    if (covered) {
      const params = new URLSearchParams(searchParams);
      params.delete("t");
      params.delete("p");
      const query = params.toString();
      router.replace(`/w/${workspaceId}/r/${roomId}${query === "" ? "" : `?${query}`}`);
    }
    setSidePanel((open) => (open === panel && !covered ? null : panel));
  }

  function openProfile(userId: string, origin: { fromMembers: boolean; sender?: ProfileSender }) {
    setSidePanel(null);
    setProfileOrigin({ userId, ...origin });
    // スレッドと同じく push にして、モバイルの全画面をブラウザの「戻る」で閉じられるようにする
    const params = new URLSearchParams(searchParams);
    params.delete("t");
    params.set("p", userId);
    router.push(`/w/${workspaceId}/r/${roomId}?${params}`);
  }

  function closeProfile() {
    const params = new URLSearchParams(searchParams);
    params.delete("p");
    const query = params.toString();
    router.replace(`/w/${workspaceId}/r/${roomId}${query === "" ? "" : `?${query}`}`);
  }

  function leaveRemovedWorkspace() {
    forgetLocation(workspaceId);
    store.forgetRemovedWorkspace(workspaceId);
    router.replace("/");
  }

  // 接続できていたサーバーに、続けて届かない（chat/connection/server-error.png）。端末がオフラインのときは再接続中のバナーで待つ
  if (unavailable) {
    return (
      <ServerUnavailable
        lastConnectedLabel={formatTime(new Date(unavailable.lastConnectedAt))}
        retryCount={unavailable.retryCount}
        onRetry={() => realtime.retryNow()}
      />
    );
  }

  if (sessionState.status !== "signed_in" || !workspace || roomList?.status !== "ready") return null;
  const user = sessionState.user;
  const currentUser = { id: user.id, name: user.display_name, avatarUrl: avatarUrls[user.id] ?? user.avatar_url };

  return (
    <>
      <ChatLayout
        mobileView={
          (roomId && listShownFor !== roomId) ||
          (threadsView && listShownFor !== "threads") ||
          (savedView && listShownFor !== "saved")
            ? "room"
            : "list"
        }
        sidebar={
          <Sidebar
            workspace={{ id: workspace.id, name: workspace.name }}
            currentUser={currentUser}
            rooms={roomViews}
            selectedRoomId={roomId}
            roomHref={(id) => `/w/${workspaceId}/r/${id}`}
            notice={notificationBanner}
            search={search}
            onSearchChange={setSearch}
            switcherOpen={switcherOpen}
            onToggleSwitcher={() => {
              setAccountMenuOpen(false);
              setSwitcherOpen((open) => !open);
            }}
            switcher={
              <WorkspaceSwitcher
                workspaces={workspaces.list.map((w) => ({ id: w.id, name: w.name }))}
                currentWorkspaceId={workspace.id}
                onSelect={(id) => {
                  setSwitcherOpen(false);
                  if (id !== workspace.id) router.push(`/w/${id}`);
                }}
                onCreate={() => {
                  setSwitcherOpen(false);
                  setCreatingWorkspace(true);
                }}
                onDismiss={() => setSwitcherOpen(false)}
              />
            }
            accountMenuOpen={accountMenuOpen}
            onToggleAccountMenu={() => {
              setSwitcherOpen(false);
              setAccountMenuOpen((open) => !open);
            }}
            accountMenu={
              <AccountMenu
                user={{ ...currentUser, handle: user.handle, status: myStatus }}
                away={myMember?.away ?? false}
                onOpenStatus={() => {
                  setAccountMenuOpen(false);
                  setStatusOpen(true);
                }}
                onToggleAway={() => {
                  setAccountMenuOpen(false);
                  void store.setAway(!(myMember?.away ?? false));
                }}
                onOpenWorkspaceSettings={() => {
                  setAccountMenuOpen(false);
                  router.push(`/w/${workspaceId}/admin/settings`);
                }}
                onOpenSettings={() => {
                  setAccountMenuOpen(false);
                  router.push("/settings");
                }}
                onLogout={() => session.logout()}
                onDismiss={() => setAccountMenuOpen(false)}
              />
            }
            onCreateRoom={() => setCreatingRoom(true)}
            onStartDm={() => setStartingDm(true)}
            threads={{
              href: `/w/${workspaceId}/threads`,
              // 一覧を取るまではルーム一覧の unread_thread_count を出す
              unreadCount: threadList?.status === "ready" ? countUnreadThreads(threadList.list) : (unreadThreadCount ?? 0),
              selected: threadsView,
            }}
            saved={{ href: `/w/${workspaceId}/saved`, selected: savedView }}
          />
        }
        panel={
          roomId && profileId && !roomRemoved ? (
            <RoomProfile
              key={profileId}
              workspaceId={workspaceId}
              userId={profileId}
              fallback={profileOrigin?.userId === profileId ? profileOrigin.sender : undefined}
              onClose={closeProfile}
              onBack={
                profileOrigin?.userId === profileId && profileOrigin.fromMembers
                  ? () => {
                      closeProfile();
                      setSidePanel("members");
                    }
                  : undefined
              }
            />
          ) : roomId && threadId && !roomRemoved ? (
            <RoomThread
              key={threadId}
              workspaceId={workspaceId}
              roomId={roomId}
              rootId={threadId}
              jumpMessageId={jumpMessageId}
              onClose={closeThread}
              onOpenProfile={(userId, sender) => openProfile(userId, { fromMembers: false, sender })}
            />
          ) : roomId && membersOpen && !roomRemoved ? (
            <RoomMembers
              roomId={roomId}
              onClose={() => setSidePanel(null)}
              onOpenProfile={(userId) => openProfile(userId, { fromMembers: true })}
            />
          ) : undefined
        }
      >
        {roomId && (
          <RoomView
            key={roomId}
            workspaceId={workspaceId}
            roomId={roomId}
            membersOpen={membersOpen && !threadId && !profileId}
            onToggleMembers={() => toggleSidePanel("members")}
            openThreadId={threadId}
            onOpenThread={openThread}
            jumpMessageId={jumpMessageId}
            onBack={() => setListShownFor(roomId)}
            onLeaveRemovedWorkspace={leaveRemovedWorkspace}
            onOpenProfile={(userId, sender) => openProfile(userId, { fromMembers: false, sender })}
          />
        )}
        {threadsView && !removedFromWorkspace && (
          <WorkspaceThreads workspaceId={workspaceId} onBack={() => setListShownFor("threads")} />
        )}
        {savedView && !removedFromWorkspace && (
          <WorkspaceSaved workspaceId={workspaceId} onBack={() => setListShownFor("saved")} />
        )}
        {!roomId && removedFromWorkspace && (
          <RemovedFromWorkspace workspaceName={workspace.name} onMove={leaveRemovedWorkspace} />
        )}
      </ChatLayout>
      <CreateWorkspace open={creatingWorkspace} onClose={() => setCreatingWorkspace(false)} />
      {statusOpen && (
        <MyStatusDialog workspaceId={workspaceId} status={myStatus} onClose={() => setStatusOpen(false)} />
      )}
      <CreateRoom workspaceId={workspaceId} open={creatingRoom} onClose={() => setCreatingRoom(false)} />
      <StartDm workspaceId={workspaceId} open={startingDm} onClose={() => setStartingDm(false)} />
    </>
  );
}
