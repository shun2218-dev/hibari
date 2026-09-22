"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AccountMenu } from "@/components/chat/account-menu";
import { ChatLayout } from "@/components/chat/chat-layout";
import { RemovedFromWorkspace, ServerUnavailable } from "@/components/chat/chat-states";
import { SideNavBar, type SideNavItems, type SideNavKey, SideNavRail } from "@/components/chat/side-nav";
import { Sidebar } from "@/components/chat/sidebar";
import { WorkspaceSwitcher } from "@/components/chat/workspace-switcher";
import { Avatar } from "@/components/ui/avatar";
import { useSession, useSessionState } from "@/hooks/auth/use-session";
import { useChatState, useChatStore, useRealtime } from "@/hooks/chat/use-chat-store";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { withSide } from "@/lib/chat/format/links";
import { formatTime } from "@/lib/chat/format/time";
import { forgetLocation, lastRoomId, rememberLocation } from "@/lib/chat/last-location";
import { countUnreadThreads } from "@/lib/chat/store/threads";
import { memberSettings, statusView, toRoomSummaryView } from "@/lib/chat/views/views";

import { MyStatusDialog } from "./my-status";

import { CreateWorkspace } from "@/app/(app)/_components/create-workspace";
import { CreateRoom } from "./create-room";
import { useDesktopNotifications } from "@/hooks/chat/use-desktop-notifications";
import { StartDm } from "./start-dm";
import type { ProfileSender } from "@/hooks/chat/use-senders";
import { RoomProfile } from "./room-profile";
import { RoomMembers } from "./room-members";
import { RoomThread } from "./room-thread";
import { RoomView } from "./room-view";
import { ActivityPane, DmPane, LaterPane } from "./side-panes";
import { WorkspaceThreads } from "./workspace-threads";

const SIDES: readonly SideNavKey[] = ["home", "dms", "activity", "later"];

/** URL の `?side=`（ADR 0058 決定 1）。知らない値とホームは、ホームとして扱う。 */
function parseSide(value: string | null): SideNavKey {
  return SIDES.find((side) => side === value) ?? "home";
}

export function WorkspaceScreen() {
  const { workspaceId, roomId } = useParams<{ workspaceId: string; roomId?: string }>();
  // 開いているスレッドと、飛び先のメッセージは URL のクエリに持つ（ADR 0037 / 0040 / 0042）。
  // 一覧やリンクから開いた画面も、リロードすると同じ所に戻る
  const searchParams = useSearchParams();
  const threadId = searchParams.get("t") ?? undefined;
  const jumpMessageId = searchParams.get("m") ?? undefined;
  // 開いているプロフィール（ADR 0050 決定 6 の追記）。スレッドと同じく URL に持ち、モバイルの全画面を「戻る」で閉じられるようにする
  const profileId = searchParams.get("p") ?? undefined;
  // 左のメニューで開いているもの（ADR 0058 決定 1）。ルームを開いても残すので、パスではなくクエリに持つ
  const side = parseSide(searchParams.get("side"));
  const pathname = usePathname();
  const threadsView = pathname === `/w/${workspaceId}/threads`;
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
  const unreadActivity = useChatState((s) => s.activity[workspaceId]?.unreadCount ?? 0);
  // 開いているルームを読めない（外された、URL のルームが読めない）。メンバーのパネルも閉じる（名前を見せない。ADR 0035）
  const roomRemoved = useChatState((s) =>
    roomId ? s.removedRooms[roomId] !== undefined || s.timelines[roomId]?.status === "not_found" : false,
  );

  const [search, setSearch] = useState("");
  // ワークスペースの切り替えとアカウントのメニューは、サイドバーの上（header）と左のメニュー（rail）の 2 か所から開ける
  const [switcherFrom, setSwitcherFrom] = useState<"header" | "rail" | null>(null);
  const [accountMenuFrom, setAccountMenuFrom] = useState<"header" | "rail" | null>(null);
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
  // モバイルで「一覧に戻る」か下のメニューを押した。URL はルームのままにして、別のルーム（や別のメッセージ）を開いたら詳細に戻す
  const [listShownFor, setListShownFor] = useState<string>();
  const mainKey = threadsView ? "threads" : roomId ? `${roomId}:${jumpMessageId ?? ""}` : undefined;

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

  // 表示中のワークスペースとそのルームを購読する（lib/chat/realtime/realtime.ts）
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
    // 左のメニューのアクティビティのバッジ（ADR 0058 決定 5）
    void store.loadActivityUnreadCount(workspaceId);
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

  // ルームを選んでいなければ、最後に開いたルーム → is_default のルーム → 一覧の先頭の順に開く。
  // 左のメニュー（?side=）は残す（「後で」の古い URL /saved からもここに来る）
  useEffect(() => {
    if (roomId || threadsView || roomList?.status !== "ready" || roomList.ids.length === 0) return;
    const remembered = lastRoomId(workspaceId);
    const target =
      roomList.ids.find((id) => id === remembered) ??
      roomList.ids.find((id) => rooms[id]?.is_default && rooms[id]?.is_member) ??
      roomList.ids[0];
    router.replace(withSide(`/w/${workspaceId}/r/${target}`, side));
  }, [roomId, threadsView, roomList, rooms, workspaceId, router, side]);

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

  // 左のメニューの DM のバッジは、未読のある会話の数（Slack と同じ。ADR 0058 決定 1）
  const unreadDms = useMemo(
    () =>
      (roomList?.ids ?? []).filter((id) => {
        const r = rooms[id];
        // ミュートした DM は、ルームの行と同じく知らせの数に入れない（ADR 0055 決定 6）。
        // 期限の切れたミュートはストアがタイマーで外しているので（scheduleMuteExpiry）、時刻と比べなくてよい
        return r?.kind === "dm" && r.unread_count > 0 && !r.notifications?.muted;
      }).length,
    [roomList, rooms],
  );

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

  // 左のメニュー（ADR 0058 決定 1）。押すとサイドバーの中身が変わり、メインの領域（ルーム）はそのまま
  const sideItems: SideNavItems = {
    home: { href: pathname },
    dms: { href: withSide(pathname, "dms"), badge: unreadDms },
    activity: { href: withSide(pathname, "activity"), badge: unreadActivity },
    later: { href: withSide(pathname, "later") },
  };

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

  function toggleSwitcher(from: "header" | "rail") {
    setAccountMenuFrom(null);
    setSwitcherFrom((open) => (open === from ? null : from));
  }

  function toggleAccountMenu(from: "header" | "rail") {
    setSwitcherFrom(null);
    setAccountMenuFrom((open) => (open === from ? null : from));
  }

  const switcher = (placement: "header" | "rail") => (
    <WorkspaceSwitcher
      placement={placement}
      workspaces={workspaces.list.map((w) => ({ id: w.id, name: w.name }))}
      currentWorkspaceId={workspace.id}
      onSelect={(id) => {
        setSwitcherFrom(null);
        if (id !== workspace.id) router.push(`/w/${id}`);
      }}
      onCreate={() => {
        setSwitcherFrom(null);
        setCreatingWorkspace(true);
      }}
      onDismiss={() => setSwitcherFrom(null)}
    />
  );

  const accountMenu = (placement: "header" | "rail") => (
    <AccountMenu
      placement={placement}
      user={{ ...currentUser, handle: user.handle, status: myStatus }}
      away={myMember?.away ?? false}
      onOpenStatus={() => {
        setAccountMenuFrom(null);
        setStatusOpen(true);
      }}
      onToggleAway={() => {
        setAccountMenuFrom(null);
        void store.setAway(!(myMember?.away ?? false));
      }}
      onOpenWorkspaceSettings={() => {
        setAccountMenuFrom(null);
        router.push(`/w/${workspaceId}/admin/settings`);
      }}
      onOpenSettings={() => {
        setAccountMenuFrom(null);
        router.push("/settings");
      }}
      onLogout={() => session.logout()}
      onDismiss={() => setAccountMenuFrom(null)}
    />
  );

  // サイドバーの列の中身（左のメニューで選んだもの）。一覧の 1 件を押しても、このメニューのまま（URL の ?side= を残す）
  const home = (
    <Sidebar
      railed
      workspace={{ id: workspace.id, name: workspace.name }}
      currentUser={currentUser}
      rooms={roomViews}
      selectedRoomId={roomId}
      roomHref={(id) => `/w/${workspaceId}/r/${id}`}
      notice={notificationBanner}
      search={search}
      onSearchChange={setSearch}
      switcherOpen={switcherFrom === "header"}
      onToggleSwitcher={() => toggleSwitcher("header")}
      switcher={switcher("header")}
      accountMenuOpen={accountMenuFrom === "header"}
      onToggleAccountMenu={() => toggleAccountMenu("header")}
      accountMenu={accountMenu("header")}
      onCreateRoom={() => setCreatingRoom(true)}
      onStartDm={() => setStartingDm(true)}
      threads={{
        href: `/w/${workspaceId}/threads`,
        // 一覧を取るまではルーム一覧の unread_thread_count を出す
        unreadCount: threadList?.status === "ready" ? countUnreadThreads(threadList.list) : (unreadThreadCount ?? 0),
        selected: threadsView,
      }}
    />
  );
  const sidePane =
    side === "dms" ? (
      <DmPane workspaceId={workspaceId} variant="pane" linkSide="dms" onStartDm={() => setStartingDm(true)} />
    ) : side === "activity" ? (
      <ActivityPane workspaceId={workspaceId} variant="pane" linkSide="activity" />
    ) : side === "later" ? (
      <LaterPane workspaceId={workspaceId} variant="pane" linkSide="later" />
    ) : (
      home
    );

  return (
    <>
      <ChatLayout
        mobileView={mainKey !== undefined && listShownFor !== mainKey ? "room" : "list"}
        rail={
          <SideNavRail
            items={sideItems}
            current={side}
            workspace={
              <>
                <button
                  type="button"
                  aria-label="ワークスペースを切り替える"
                  aria-expanded={switcherFrom === "rail"}
                  aria-haspopup="dialog"
                  onClick={() => toggleSwitcher("rail")}
                  className="rounded-sm"
                >
                  <Avatar id={workspace.id} name={workspace.name} size="md" shape="square" />
                </button>
                {switcherFrom === "rail" && switcher("rail")}
              </>
            }
            account={
              <>
                <button
                  type="button"
                  aria-label="アカウントメニュー"
                  aria-expanded={accountMenuFrom === "rail"}
                  aria-haspopup="dialog"
                  onClick={() => toggleAccountMenu("rail")}
                  className="rounded-full"
                >
                  <Avatar id={currentUser.id} name={currentUser.name} imageUrl={currentUser.avatarUrl} size="sm" />
                </button>
                {accountMenuFrom === "rail" && accountMenu("rail")}
              </>
            }
            // ポインタを乗せると重ねて出す一覧（ADR 0058 の追記）。押しても今のサイドバーのまま
            previews={{
              dms: (
                <DmPane workspaceId={workspaceId} variant="preview" linkSide={side} onStartDm={() => setStartingDm(true)} />
              ),
              activity: <ActivityPane workspaceId={workspaceId} variant="preview" linkSide={side} />,
              later: <LaterPane workspaceId={workspaceId} variant="preview" linkSide={side} />,
            }}
          />
        }
        // モバイルの下のメニュー。押したら、開いているルームはそのままにして一覧を見せる
        tabBar={<SideNavBar items={sideItems} current={side} onNavigate={() => setListShownFor(mainKey)} />}
        sidebar={sidePane}
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
            onBack={() => setListShownFor(mainKey)}
            onLeaveRemovedWorkspace={leaveRemovedWorkspace}
            onOpenProfile={(userId, sender) => openProfile(userId, { fromMembers: false, sender })}
          />
        )}
        {threadsView && !removedFromWorkspace && (
          <WorkspaceThreads workspaceId={workspaceId} onBack={() => setListShownFor(mainKey)} />
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
