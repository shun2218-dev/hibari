"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { HomeScreenSheet } from "@/components/chat/home-screen-sheet";
import { NotificationPermissionBanner } from "@/components/chat/notification-permission-banner";
import { notificationBannerKind } from "@/lib/chat/notifications/banner";
import type { BrowserPushState } from "@/lib/chat/notifications/web-push";
import {
  bannerDismissed,
  dismissBanner,
  notificationPermission,
  requestNotificationPermission,
  serverNotificationPermission,
  subscribeNotificationPrefs,
  watchPermission,
} from "@/lib/chat/notifications/notification-prefs";

import { useChatContext } from "./use-chat-context";
import { useDesktopNotificationOpen } from "./use-desktop-notification-open";

/**
 * チャットの画面での通知（ADR 0057、ADR 0069）。サイドバーの帯（とホーム画面に追加する手順のシート）を返し、
 * タブの通知を押したときの移動をルーターに任せる。
 *
 * 帯の種類はプッシュの状態で決める（lib/chat/notifications/banner.ts）。帯は許可がまだ決まっていない（default）ときだけ出し、
 * 「今はしない」で閉じたらその端末では出さない（ADR 0057 決定 5。種類によらず同じ印。ADR 0069 決定 2）。
 */
export function useDesktopNotifications(): ReactNode {
  const router = useRouter();
  const { push } = useChatContext();
  const permission = useSyncExternalStore(subscribeNotificationPrefs, notificationPermission, serverNotificationPermission);
  const dismissed = useSyncExternalStore(subscribeNotificationPrefs, bannerDismissed, () => true);
  const [pushState, setPushState] = useState<BrowserPushState | "loading">("loading");
  const [sheetOpen, setSheetOpen] = useState(false);

  // 通知を押したら、ページを読み込み直さずにそのメッセージへ移る（ADR 0042）
  const open = useCallback((url: string) => router.push(url), [router]);
  useDesktopNotificationOpen(open);
  // ブラウザの設定で許可を変えたとき（別のタブで許可したときを含む）に帯を消す
  useEffect(() => watchPermission(), []);

  // プッシュの状態を読む。resync や設定で有効・無効が変わったら（push.subscribe）読み直す
  const refresh = useCallback(() => {
    if (!push) return;
    push.state().then(setPushState, () => {
      // 設定を読めなければプッシュは使えないものとして、タブの通知の帯にする（ADR 0069 決定 9 と同じ扱い）
      setPushState("server-disabled");
    });
  }, [push]);
  useEffect(() => {
    if (!push) return;
    refresh();
    return push.subscribe(refresh);
  }, [push, refresh]);

  const kind = notificationBannerKind({ push: push ? pushState : null, permission, dismissed });

  function enablePush() {
    // await を挟まずにこの操作の中で呼ぶ。Safari は、操作のあとに await を挟んだ許可の要求を拒む（web-push.ts の enable）
    const enabling = push!.enable();
    // 結果（有効・拒否・失敗）は状態に出るので、読み直して帯を消す。失敗の表示は帯にはなく（docs/ui）、設定の「通知」に出る
    enabling.then(refresh, refresh);
  }

  return (
    <>
      {kind && (
        <NotificationPermissionBanner
          kind={kind}
          onEnable={kind === "push" ? enablePush : () => void requestNotificationPermission()}
          onShowInstallGuide={() => setSheetOpen(true)}
          onDismiss={dismissBanner}
        />
      )}
      {sheetOpen && <HomeScreenSheet onClose={() => setSheetOpen(false)} />}
    </>
  );
}
