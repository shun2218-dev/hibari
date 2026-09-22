"use client";

import { type ComponentProps, useEffect, useState } from "react";

import { NotificationMenu, type TemporaryMute } from "@/components/chat/notification-menu";
import type { RoomHeader } from "@/components/chat/room-header";
import type { RoomNotifications } from "@/lib/api/types.gen";
import { useChatState, useChatStore } from "@/lib/chat/chat-provider";
import { isMuted, muteUntilLabel, notifyLevelLabels, temporaryMuteUntil } from "@/lib/chat/notifications";

/**
 * ルームのヘッダーの「通知」（ADR 0055。chat/notification/menu.png）。RoomHeader の notifications に渡す値を作る。
 *
 * 設定を持てるのはルームのメンバーだけなので、参加していない public ルームでは undefined を返す（アイコンを出さない）。
 * 変更は手元で先に反映し、失敗したら元に戻す（ストア）。別のタブには room.notifications_updated で揃う。
 */
export function useRoomNotifications(
  workspaceId: string,
  roomId: string,
): ComponentProps<typeof RoomHeader>["notifications"] {
  const store = useChatStore();
  const room = useChatState((s) => s.rooms[roomId]);
  const level = useChatState((s) => s.notificationLevels[workspaceId]);
  const [open, setOpen] = useState(false);

  // 「全体の設定に従う」の補足に、そのワークスペースの値を出す
  useEffect(() => {
    void store.loadNotificationLevel(workspaceId);
  }, [store, workspaceId]);

  const current = room?.notifications;
  if (!room || !current) return undefined;

  const now = new Date();
  const muted = isMuted(current, now.getTime());
  // メニューの 1 つを変えるときも、手元の残りの値と一緒に全部を送る（PUT。決定 4）
  const save = (next: RoomNotifications) => {
    setOpen(false);
    void store.setRoomNotifications(roomId, next).catch((err: unknown) => {
      console.error("failed to update room notifications", err);
    });
  };
  const base: RoomNotifications = { level: current.level, muted: false, muted_until: null };

  return {
    muted,
    open,
    onToggle: () => setOpen((v) => !v),
    menu: (
      <NotificationMenu
        kind={room.kind}
        level={current.level === "none" ? null : current.level}
        defaultLevelLabel={notifyLevelLabels[level ?? "mentions"]}
        mute={
          muted
            ? { untilLabel: current.muted_until ? muteUntilLabel(new Date(current.muted_until), now) : undefined }
            : null
        }
        // 通知する内容を変えても、ミュートはそのまま残す
        onLevelChange={(next) => save({ ...current, level: next, ...(muted ? {} : { muted: false, muted_until: null }) })}
        onMute={() => save({ ...base, muted: true })}
        onMuteTemporarily={(duration: TemporaryMute) =>
          save({ ...base, muted: true, muted_until: temporaryMuteUntil(duration, now).toISOString() })
        }
        onUnmute={() => save(base)}
        onDismiss={() => setOpen(false)}
      />
    ),
  };
}
