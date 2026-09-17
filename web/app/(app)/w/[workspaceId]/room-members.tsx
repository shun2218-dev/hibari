"use client";

import { useEffect, useMemo } from "react";

import { MembersPanel } from "@/components/chat/members-panel";
import { useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { toRoomMemberView } from "@/lib/chat/views";

/**
 * ルームのメンバーのパネル。開くたびに取り直す。
 * 開いている間の presence とメンバーの増減はイベントで反映する（参加・ワークスペースに入った人の情報はイベントにないので、増えたときは取り直す）。
 */
export function RoomMembers({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const store = useChatStore();
  const members = useChatState((s) => s.roomMembers[roomId]);

  useEffect(() => {
    store.loadRoomMembers(roomId);
  }, [store, roomId]);

  const views = useMemo(() => (members?.members ?? []).map(toRoomMemberView), [members]);
  return <MembersPanel members={views} onClose={onClose} />;
}
