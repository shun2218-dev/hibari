import type { NotificationBannerKind } from "@/components/chat/notification-permission-banner";
import type { BrowserNotificationPermission } from "@/components/settings/notification-settings";

import type { BrowserPushState } from "./web-push";

/**
 * サイドバーの帯を出すか、出すならどの種類か（ADR 0057 決定 5、ADR 0069 決定 1・2・9）。
 *
 * - push: プッシュを読めない環境（偽のソケットのテスト・サーバーでの描画）では null。6.14b のデスクトップ通知の帯のまま
 *   「loading」は `push.state()` を読んでいる間。どの帯かが決まるまで出さない（デスクトップの帯を出してから
 *   プッシュの帯に替わると、押す前に文言が変わってしまうため）
 * - permission: `Notification.permission`。プッシュでもタブの通知でも、帯は許可がまだ決まっていないときだけ出す
 *   （決まっていれば押しても何も起きない。許可済みでまだ購読していない人は設定の「通知」で有効にする）
 * - dismissed: 「今はしない」で閉じたか。種類によらず 1 つの印にする（帯は 1 つ。決定 2）
 */
export function notificationBannerKind({
  push,
  permission,
  dismissed,
}: {
  push: BrowserPushState | "loading" | null;
  permission: BrowserNotificationPermission;
  dismissed: boolean;
}): NotificationBannerKind | null {
  if (dismissed || push === "loading") return null;
  switch (push) {
    // iPhone / iPad の Safari でホーム画面にない。Notification がない（許可を読めない）ので、許可を見ずに案内する（決定 1）
    case "install":
      return "install";
    case "off":
      return permission === "default" ? "push" : null;
    // サーバーに鍵がない・ブラウザが Push を受けられない。タブの通知（ADR 0057）の帯にする（決定 9）
    case "server-disabled":
    case "unsupported":
    case null:
      return permission === "default" ? "desktop" : null;
    case "denied":
    case "on":
      return null;
  }
}
