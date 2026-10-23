"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { HomeScreenSheet } from "@/components/chat/home-screen-sheet";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { useChatContext } from "@/hooks/chat/use-chat-context";
import { useChatState, useChatStore } from "@/hooks/chat/use-chat-store";
import { usePushSettings } from "@/hooks/chat/use-push-settings";
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
 *
 * このブラウザの節は、サーバーがプッシュを使えるならプッシュ通知のカードと「通知を受け取る端末」（ADR 0069）、
 * 使えないなら 6.14b のデスクトップ通知のカード（決定 9）。
 */
export function NotificationsSection() {
  const store = useChatStore();
  const workspaces = useChatState((s) => s.workspaces);
  const levels = useChatState((s) => s.notificationLevels);
  // このブラウザのデスクトップ通知（ADR 0057 決定 5・6）。どちらも端末ごとで、サーバーには持たない
  const permission = useSyncExternalStore(subscribeNotificationPrefs, notificationPermission, serverNotificationPermission);
  const sound = useSyncExternalStore(subscribeNotificationPrefs, soundEnabled, () => true);
  useEffect(() => watchPermission(), []);
  const push = usePushSettings(useChatContext().push);
  const [installGuide, setInstallGuide] = useState(false);

  useEffect(() => {
    void store.loadWorkspaces();
  }, [store]);
  useEffect(() => {
    for (const w of workspaces.list) void store.loadNotificationLevel(w.id);
  }, [store, workspaces.list]);

  // 取得中と失敗の画面はデザインにない。値が揃うまでは何も並べない（既定の値を選んだように見せないため）
  if (workspaces.status !== "ready" || workspaces.list.some((w) => levels[w.id] === undefined)) return null;
  // プッシュの状態も同じ（オフのスイッチを見せてから有効に変わらないように）
  if (push === "loading") return null;
  return (
    <>
      <NotificationSettings
        workspaces={workspaces.list.map((w) => ({ id: w.id, name: w.name, level: levels[w.id] ?? "mentions" }))}
        browser={{
          permission,
          onRequestPermission: () => void requestNotificationPermission(),
          sound,
          onSoundChange: setSoundEnabled,
          push: push && { ...push, onShowInstallGuide: () => setInstallGuide(true) },
        }}
        onLevelChange={(workspaceId, level) =>
          void store.setNotificationLevel(workspaceId, level).catch((err: unknown) => {
            console.error("failed to update the notification level", err);
          })
        }
      />
      {installGuide && <HomeScreenSheet onClose={() => setInstallGuide(false)} />}
    </>
  );
}
