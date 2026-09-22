"use client";

import { useEffect, useSyncExternalStore } from "react";

import { NotificationSettings } from "@/components/settings/settings-sections";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import {
  notificationPermission,
  requestNotificationPermission,
  serverNotificationPermission,
  setSoundEnabled,
  soundEnabled,
  subscribeNotificationPrefs,
  watchPermission,
} from "@/lib/chat/notifications/notification-prefs";

/**
 * 通知（ADR 0055。settings/notifications/notifications.png）。
 *
 * 全体の設定はワークスペースごとなので（決定 2）、所属するワークスペースごとに節を並べる。
 * 選んだらすぐに保存する。失敗したら元に戻す（ストア）。別のタブには notifications.updated で揃う。
 */
export function NotificationsSection() {
  const store = useChatStore();
  const workspaces = useChatState((s) => s.workspaces);
  const levels = useChatState((s) => s.notificationLevels);
  // このブラウザのデスクトップ通知（ADR 0057 決定 5・6）。どちらも端末ごとで、サーバーには持たない
  const permission = useSyncExternalStore(subscribeNotificationPrefs, notificationPermission, serverNotificationPermission);
  const sound = useSyncExternalStore(subscribeNotificationPrefs, soundEnabled, () => true);
  useEffect(() => watchPermission(), []);

  useEffect(() => {
    void store.loadWorkspaces();
  }, [store]);
  useEffect(() => {
    for (const w of workspaces.list) void store.loadNotificationLevel(w.id);
  }, [store, workspaces.list]);

  // 取得中と失敗の画面はデザインにない。値が揃うまでは何も並べない（既定の値を選んだように見せないため）
  if (workspaces.status !== "ready" || workspaces.list.some((w) => levels[w.id] === undefined)) return null;
  return (
    <NotificationSettings
      workspaces={workspaces.list.map((w) => ({ id: w.id, name: w.name, level: levels[w.id] ?? "mentions" }))}
      browser={{
        permission,
        onRequestPermission: () => void requestNotificationPermission(),
        sound,
        onSoundChange: setSoundEnabled,
      }}
      onLevelChange={(workspaceId, level) =>
        void store.setNotificationLevel(workspaceId, level).catch((err: unknown) => {
          console.error("failed to update the notification level", err);
        })
      }
    />
  );
}
