"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyMessages, JoinRoomBar } from "@/components/chat/chat-states";
import { RoomHeader } from "@/components/chat/room-header";
import { Timeline } from "@/components/chat/timeline";
import { useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { forgetLocation } from "@/lib/chat/last-location";
import { roomName, toTimelineItems } from "@/lib/chat/views";

type RoomViewProps = {
  workspaceId: string;
  roomId: string;
  membersOpen: boolean;
  onToggleMembers: () => void;
  onBack: () => void;
};

/**
 * ルームのヘッダー・履歴・参加の導線。入力欄は送信（構築順 4）で足す。
 * ルームごとに key を変えて作り直すので、タイムラインのスクロール位置はルームを開くたびにいちばん下から始まる。
 */
export function RoomView({ workspaceId, roomId, membersOpen, onToggleMembers, onBack }: RoomViewProps) {
  const router = useRouter();
  const store = useChatStore();
  const room = useChatState((s) => s.rooms[roomId]);
  const timeline = useChatState((s) => s.timelines[roomId]);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    store.openRoom(roomId);
  }, [store, roomId]);

  // 読めないルーム（存在しない、private のメンバーではない）は覚えている場所から外し、ワークスペースの入口に戻す。
  // 別のワークスペースのルームの URL なら、そのワークスペースで開き直す
  const notFound = timeline?.status === "not_found";
  const otherWorkspace = timeline?.status === "ready" && room !== undefined && room.workspace_id !== workspaceId;
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

  return (
    <>
      <RoomHeader
        kind={room.kind}
        name={roomName(room)}
        memberCount={room.member_count ?? 0}
        membersOpen={membersOpen}
        onToggleMembers={onToggleMembers}
        onBack={onBack}
      />
      {/* 取得中と、取得できなかったとき（その画面はデザインにない）は、ヘッダーだけを出す */}
      {timeline?.status === "ready" &&
        (items.length === 0 ? (
          <EmptyMessages kind={room.kind} name={roomName(room)} />
        ) : (
          <Timeline
            items={items}
            onReachStart={() => store.loadOlder(roomId)}
            onMarkAllRead={() => store.dismissUnread(roomId)}
          />
        ))}
      {room.kind === "public" && !room.is_member && <JoinRoomBar joining={joining} onJoin={join} />}
    </>
  );
}
