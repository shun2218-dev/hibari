"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyMessages, JoinRoomBar, RemovedFromRoom, RemovedFromWorkspace } from "@/components/chat/chat-states";
import { TypingIndicator } from "@/components/chat/composer";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { RoomHeader } from "@/components/chat/room-header";
import { Timeline } from "@/components/chat/timeline";
import { useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { forgetLocation } from "@/lib/chat/last-location";
import { roomName, toTimelineItems } from "@/lib/chat/views";
import { useDocumentVisible } from "@/lib/use-document-visible";

type RoomViewProps = {
  workspaceId: string;
  roomId: string;
  membersOpen: boolean;
  onToggleMembers: () => void;
  onBack: () => void;
  onLeaveRemovedWorkspace: () => void;
};

/**
 * ルームのヘッダー・接続状態・履歴・入力中の表示・参加の導線。入力欄は送信（構築順 4）で足す。
 * ルームごとに key を変えて作り直すので、タイムラインのスクロール位置はルームを開くたびにいちばん下から始まる。
 */
export function RoomView({
  workspaceId,
  roomId,
  membersOpen,
  onToggleMembers,
  onBack,
  onLeaveRemovedWorkspace,
}: RoomViewProps) {
  const router = useRouter();
  const store = useChatStore();
  const room = useChatState((s) => s.rooms[roomId]);
  const timeline = useChatState((s) => s.timelines[roomId]);
  const banner = useChatState((s) => s.connection.banner);
  const typing = useChatState((s) => s.typing[roomId]);
  const removal = useChatState((s) => s.removedRooms[roomId]);
  const workspaceRemoval = useChatState((s) => s.removedWorkspaces[workspaceId]);
  const [joining, setJoining] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const visible = useDocumentVisible();

  useEffect(() => {
    store.openRoom(roomId);
  }, [store, roomId]);

  // 最新を見ているか（タブが見えていて、いちばん下が見えている）をデータ層に知らせる。見ている間に届いたメッセージは既読になる
  const ready = timeline?.status === "ready";
  useEffect(() => {
    store.setFocus({ roomId, caughtUp: ready && visible && atBottom });
  }, [store, roomId, ready, visible, atBottom]);
  useEffect(() => () => store.setFocus(null), [store]);

  // 読めないルーム（存在しない、private のメンバーではない）は覚えている場所から外し、ワークスペースの入口に戻す。
  // 別のワークスペースのルームの URL なら、そのワークスペースで開き直す。
  // 別のタブで自分から抜けたときも、「外されました」は出さずに入口に戻す
  const notFound = timeline?.status === "not_found" || removal === "left";
  const otherWorkspace = ready && room !== undefined && room.workspace_id !== workspaceId;
  useEffect(() => {
    if (notFound) {
      forgetLocation(workspaceId, roomId);
      router.replace(`/w/${workspaceId}`);
    } else if (otherWorkspace) {
      router.replace(`/w/${room.workspace_id}/r/${roomId}`);
    }
  }, [notFound, otherWorkspace, room, workspaceId, roomId, router]);

  // 古いページの取得中（loadingOlder）の切り替えでは timeline が変わるが、並びは変わらない。
  // 並びが変わったときだけ作り直し、タイムラインのスクロール位置の合わせ直しを起こさない
  const messages = timeline?.messages;
  const unreadAfterSeq = timeline?.unreadAfterSeq ?? null;
  const items = useMemo(() => toTimelineItems(messages ?? [], { unreadAfterSeq }), [messages, unreadAfterSeq]);
  const typingNames = useMemo(() => (typing ?? []).map((t) => t.user.display_name), [typing]);

  if (!room || otherWorkspace) return null;

  async function join() {
    setJoining(true);
    try {
      await store.joinRoom(roomId);
    } catch (err) {
      // 失敗の表示はデザインにない。ボタンを押せる状態に戻す
      console.error("failed to join room", err);
    } finally {
      setJoining(false);
    }
  }

  const header = (
    <RoomHeader
      kind={room.kind}
      name={roomName(room)}
      memberCount={room.member_count ?? 0}
      membersOpen={membersOpen}
      onToggleMembers={onToggleMembers}
      onBack={onBack}
    />
  );

  // 外されたら、ヘッダーは残して本文を差し替える（chat/removed-from-workspace.png、chat/removed-from-channel.png）
  if (workspaceRemoval?.reason === "removed") {
    return (
      <>
        {header}
        <RemovedFromWorkspace workspaceName={workspaceRemoval.workspace.name} onMove={onLeaveRemovedWorkspace} />
      </>
    );
  }
  if (removal === "removed") {
    return (
      <>
        {header}
        <RemovedFromRoom
          kind={room.kind}
          name={roomName(room)}
          onBack={() => {
            forgetLocation(workspaceId, roomId);
            router.replace(`/w/${workspaceId}`);
          }}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <ConnectionBanner status={banner} />
      {/* 取得中と、取得できなかったとき（その画面はデザインにない）は、ヘッダーだけを出す */}
      {ready &&
        (items.length === 0 ? (
          <EmptyMessages kind={room.kind} name={roomName(room)} />
        ) : (
          <Timeline
            items={items}
            onReachStart={() => store.loadOlder(roomId)}
            onMarkAllRead={() => store.dismissUnread(roomId)}
            onAtBottomChange={setAtBottom}
          />
        ))}
      {room.kind === "public" && !room.is_member ? (
        <JoinRoomBar joining={joining} onJoin={join} />
      ) : (
        // 入力中の表示は、デザインでは入力欄の上にある。入力欄（構築順 4）を出すまでは、同じ位置に単独で置く
        <div className="px-3 md:px-4">
          <TypingIndicator names={typingNames} />
        </div>
      )}
    </>
  );
}
