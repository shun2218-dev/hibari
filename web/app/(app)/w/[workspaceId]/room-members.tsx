"use client";

import { useEffect, useMemo } from "react";

import { MembersPanel } from "@/components/chat/members-panel";
import { useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { toRoomMemberView } from "@/lib/chat/views";

/** ルームのメンバーのパネル。開くたびに取り直す（presence をまだ WebSocket で追っていないため）。 */
export function RoomMembers({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const store = useChatStore();
  const members = useChatState((s) => s.roomMembers[roomId]);

  useEffect(() => {
    store.loadRoomMembers(roomId);
  }, [store, roomId]);

  const views = useMemo(() => (members?.members ?? []).map(toRoomMemberView), [members]);
  return <MembersPanel members={views} onClose={onClose} />;
}
