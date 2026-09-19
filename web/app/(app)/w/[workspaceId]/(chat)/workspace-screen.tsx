"use client";

import { useParams, useRouter } from "next/navigation";
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
import { toRoomSummaryView } from "@/lib/chat/views";

import { CreateWorkspace } from "../../../create-workspace";
import { CreateRoom } from "./create-room";
import { StartDm } from "./start-dm";
import { RoomMembers } from "./room-members";
import { RoomView } from "./room-view";

export function WorkspaceScreen() {
  const { workspaceId, roomId } = useParams<{ workspaceId: string; roomId?: string }>();
  const router = useRouter();
  const session = useSession();
  const { state: sessionState } = useSessionState();
  const store = useChatStore();
  const realtime = useRealtime();
  const workspaces = useChatState((s) => s.workspaces);
  const roomList = useChatState((s) => s.roomLists[workspaceId]);
  const rooms = useChatState((s) => s.rooms);
  const unavailable = useChatState((s) => s.connection.unavailable);
  const removal = useChatState((s) => s.removedWorkspaces[workspaceId]);
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
  const [membersOpen, setMembersOpen] = useState(false);
  // モバイルで「一覧に戻る」を押した。URL はルームのままにして、別のルームを開いたら詳細に戻す
  const [listShownFor, setListShownFor] = useState<string>();

  // キックされたワークスペースは一覧から消えるが、「削除されました」を出している間は名前とサイドバーを残す
  const removedFromWorkspace = removal?.reason === "removed";
  const workspace =
    workspaces.list.find((w) => w.id === workspaceId) ?? (removedFromWorkspace ? removal.workspace : undefined);

  useEffect(() => {
    store.loadWorkspaces();
  }, [store]);

  // 表示中のワークスペースとそのルームを購読する（lib/chat/realtime.ts）
  useEffect(() => {
    store.setActiveWorkspace(workspaceId);
    return () => store.setActiveWorkspace(null);
  }, [store, workspaceId]);

  useEffect(() => {
    store.loadRooms(workspaceId);
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
    if (roomId || roomList?.status !== "ready" || roomList.ids.length === 0) return;
    const remembered = lastRoomId(workspaceId);
    const target =
      roomList.ids.find((id) => id === remembered) ??
      roomList.ids.find((id) => rooms[id]?.is_default && rooms[id]?.is_member) ??
      roomList.ids[0];
    router.replace(`/w/${workspaceId}/r/${target}`);
  }, [roomId, roomList, rooms, workspaceId, router]);

  // サイドバーに出す人（自分と DM の相手）のアバター。自分の avatar_url もログインの応答にあるが、1 時間で切れるので同じ経路で取り直す
  const me = sessionState.status === "signed_in" ? sessionState.user : undefined;
  const sidebarUserIds = useMemo(() => {
    const ids = (roomList?.ids ?? []).flatMap((id) => (rooms[id]?.dm_peer ? [rooms[id].dm_peer.id] : []));
    return me ? [me.id, ...ids] : ids;
  }, [roomList, rooms, me]);
  const avatarUrls = useAvatarUrls(sidebarUserIds);

  const roomViews = useMemo(() => {
    if (roomList?.status !== "ready") return [];
    const now = new Date();
    const query = search.trim().toLowerCase();
    return roomList.ids
      .flatMap((id) => {
        const room = rooms[id];
        return room ? [toRoomSummaryView(room, now, { avatarUrls })] : [];
      })
      .filter((view) => query === "" || view.name.toLowerCase().includes(query));
  }, [roomList, rooms, search, avatarUrls]);

  function leaveRemovedWorkspace() {
    forgetLocation(workspaceId);
    store.forgetRemovedWorkspace(workspaceId);
    router.replace("/");
  }

  // 接続できていたサーバーに、続けて届かない（chat/server-error.png）。端末がオフラインのときは再接続中のバナーで待つ
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
        mobileView={roomId && listShownFor !== roomId ? "room" : "list"}
        sidebar={
          <Sidebar
            workspace={{ id: workspace.id, name: workspace.name }}
            currentUser={currentUser}
            rooms={roomViews}
            selectedRoomId={roomId}
            roomHref={(id) => `/w/${workspaceId}/r/${id}`}
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
              />
            }
            accountMenuOpen={accountMenuOpen}
            onToggleAccountMenu={() => {
              setSwitcherOpen(false);
              setAccountMenuOpen((open) => !open);
            }}
            accountMenu={
              <AccountMenu
                user={{ ...currentUser, handle: user.handle }}
                onOpenWorkspaceSettings={() => {
                  setAccountMenuOpen(false);
                  router.push(`/w/${workspaceId}/admin/settings`);
                }}
                onOpenSettings={() => {
                  setAccountMenuOpen(false);
                  router.push("/settings");
                }}
                onLogout={() => session.logout()}
              />
            }
            onCreateRoom={() => setCreatingRoom(true)}
            onStartDm={() => setStartingDm(true)}
          />
        }
        panel={
          roomId && membersOpen && !roomRemoved ? <RoomMembers roomId={roomId} onClose={() => setMembersOpen(false)} /> : undefined
        }
      >
        {roomId && (
          <RoomView
            key={roomId}
            workspaceId={workspaceId}
            roomId={roomId}
            membersOpen={membersOpen}
            onToggleMembers={() => setMembersOpen((open) => !open)}
            onBack={() => setListShownFor(roomId)}
            onLeaveRemovedWorkspace={leaveRemovedWorkspace}
          />
        )}
        {!roomId && removedFromWorkspace && (
          <RemovedFromWorkspace workspaceName={workspace.name} onMove={leaveRemovedWorkspace} />
        )}
      </ChatLayout>
      <CreateWorkspace open={creatingWorkspace} onClose={() => setCreatingWorkspace(false)} />
      <CreateRoom workspaceId={workspaceId} open={creatingRoom} onClose={() => setCreatingRoom(false)} />
      <StartDm workspaceId={workspaceId} open={startingDm} onClose={() => setStartingDm(false)} />
    </>
  );
}
