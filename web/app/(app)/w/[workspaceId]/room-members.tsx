"use client";

import { useEffect, useMemo } from "react";

import { MembersPanel } from "@/components/chat/members-panel";
import { useAvatarUrls, useChatState, useChatStore } from "@/lib/chat/chat-provider";
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

  const memberIds = useMemo(() => (members?.members ?? []).map((m) => m.user.id), [members]);
  const avatarUrls = useAvatarUrls(memberIds);
  const views = useMemo(
    () => (members?.members ?? []).map((member) => toRoomMemberView(member, avatarUrls)),
    [members, avatarUrls],
  );
  return <MembersPanel members={views} onClose={onClose} />;
}
