"use client";

import { useEffect, useMemo } from "react";

import { MembersPanel } from "@/components/chat/members-panel";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { useAvatarUrls } from "@/hooks/chat/use-media";
import { toRoomMemberView } from "@/lib/chat/views/members";

/**
 * ルームのメンバーのパネル。開くたびに取り直す。
 * 開いている間の presence とメンバーの増減はイベントで反映する（参加・ワークスペースに入った人の情報はイベントにないので、増えたときは取り直す）。
 */
export function RoomMembers({
  roomId,
  onClose,
  onOpenProfile,
}: {
  roomId: string;
  onClose: () => void;
  /** 行を押した。右の枠がプロフィールのパネルに入れ替わる（「メンバーに戻る」で戻る。ADR 0050）。 */
  onOpenProfile: (userId: string) => void;
}) {
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
  return <MembersPanel members={views} onClose={onClose} onOpenProfile={onOpenProfile} />;
}
