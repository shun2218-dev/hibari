"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useSyncExternalStore } from "react";

import { NotificationPermissionBanner } from "@/components/chat/notification-permission-banner";
import { useDesktopNotificationOpen } from "./use-desktop-notification-open";
import {
  bannerDismissed,
  dismissBanner,
  notificationPermission,
  requestNotificationPermission,
  serverNotificationPermission,
  subscribeNotificationPrefs,
  watchPermission,
} from "@/lib/chat/notifications/notification-prefs";

/**
 * チャットの画面でのブラウザ通知（ADR 0057）。サイドバーの帯を返し、押したときの移動をルーターに任せる。
 *
 * 帯は許可がまだ決まっていない（default）ときだけ出し、「今はしない」で閉じたらその端末では出さない（決定 5）。
 */
export function useDesktopNotifications(): ReactNode {
  const router = useRouter();
  const permission = useSyncExternalStore(subscribeNotificationPrefs, notificationPermission, serverNotificationPermission);
  const dismissed = useSyncExternalStore(subscribeNotificationPrefs, bannerDismissed, () => true);

  // 通知を押したら、ページを読み込み直さずにそのメッセージへ移る（ADR 0042）
  const open = useCallback((url: string) => router.push(url), [router]);
  useDesktopNotificationOpen(open);
  // ブラウザの設定で許可を変えたとき（別のタブで許可したときを含む）に帯を消す
  useEffect(() => watchPermission(), []);

  if (permission !== "default" || dismissed) return null;
  return (
    <NotificationPermissionBanner
      onEnable={() => void requestNotificationPermission()}
      onDismiss={dismissBanner}
    />
  );
}
