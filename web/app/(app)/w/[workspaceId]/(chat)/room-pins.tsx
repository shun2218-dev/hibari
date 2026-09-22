"use client";

import { useEffect, useMemo } from "react";

import { PinsList } from "@/components/chat/pins-list";
import { useAvatarUrls, useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { toMemberNames, toPinnedMessageView } from "@/lib/chat/views";

/**
 * ルームの「ピン」のタブ（ADR 0054。chat/pin/list.png）。タイムラインの代わりにメインの領域に出す（Slack と同じ）。
 * 開いている間の変化は message.updated と差分で直る（専用のイベントはない）。カードを押すと、そのメッセージへ飛ぶ（`?m=`）。
 */
export function RoomPins({
  workspaceId,
  roomId,
  onOpen,
}: {
  workspaceId: string;
  roomId: string;
  /** カードを押した。「メッセージ」のタブに戻す。 */
  onOpen: () => void;
}) {
  const store = useChatStore();
  const room = useChatState((s) => s.rooms[roomId]);
  const pins = useChatState((s) => s.pins[roomId]);
  const members = useChatState((s) => s.roomMembers[roomId]?.members);

  useEffect(() => {
    void store.loadPins(roomId);
  }, [store, roomId]);

  const messages = pins?.messages;
  const senderIds = useMemo(() => (messages ?? []).map((m) => m.sender.id), [messages]);
  const avatarUrls = useAvatarUrls(senderIds);
  const memberNames = useMemo(() => toMemberNames(members), [members]);
  const views = useMemo(() => {
    const now = new Date();
    return (messages ?? []).map((m) => toPinnedMessageView(m, { workspaceId, now, avatarUrls, memberNames }));
  }, [messages, workspaceId, avatarUrls, memberNames]);

  if (!room) return null;
  // 外せるのは投稿できる人だけ（ADR 0054 決定 4）。参加していない public ルームは読めるだけ
  const canPin = room.kind !== "public" || room.is_member;
  return (
    <PinsList
      roomKind={room.kind}
      // 取得中と失敗の画面はデザインにない。取れるまでは何も並べない（0 件の表示と取り違えないように）
      pins={pins?.status === "ready" ? views : undefined}
      onOpen={onOpen}
      onUnpin={
        canPin
          ? (key: string) =>
              void store.togglePin(roomId, key).catch((err: unknown) => {
                console.error("failed to unpin a message", err);
              })
          : undefined
      }
    />
  );
}
