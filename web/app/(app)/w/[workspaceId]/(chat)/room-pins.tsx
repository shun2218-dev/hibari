"use client";

import { useEffect, useMemo } from "react";

import { PinsPanel } from "@/components/chat/pins-panel";
import { useAvatarUrls, useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { roomName, toMemberNames, toPinnedMessageView } from "@/lib/chat/views";

/**
 * ルームのピン留めの一覧（ADR 0054。chat/pin/panel.png）。ヘッダーの「ピン留め N」から開く。
 * 一覧はルームを開いたときに取ってあり、開いている間の変化は message.updated と差分で直る（専用のイベントはない）。
 * 行を押すと、そのメッセージへ飛ぶ（`?m=`。ADR 0042）。
 */
export function RoomPins({ workspaceId, roomId, onClose }: { workspaceId: string; roomId: string; onClose: () => void }) {
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
    <PinsPanel
      room={{ kind: room.kind, name: roomName(room) }}
      // 取得中と失敗の画面はデザインにない。取れるまでは何も並べない（0 件の表示と取り違えないように）
      pins={pins?.status === "ready" ? views : undefined}
      onUnpin={
        canPin
          ? (key) =>
              void store.togglePin(roomId, key).catch((err: unknown) => {
                console.error("failed to unpin a message", err);
              })
          : undefined
      }
      onClose={onClose}
    />
  );
}
