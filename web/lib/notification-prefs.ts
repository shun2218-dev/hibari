import type { BrowserNotificationPermission } from "@/components/settings/settings-sections";

/**
 * ブラウザ通知の、端末ごとの状態（ADR 0057 決定 5・6）。サーバーには持たない。
 *
 * - 許可: `Notification.permission`（ブラウザが持つ）。hibari は default のときに求めることしかできない
 * - 帯を閉じたか・通知音: localStorage（テーマと同じ。読み書きに失敗したら「覚えていない」と同じに扱う）
 *
 * どれも useSyncExternalStore で読めるよう、変わったら購読者に知らせる。
 */

export const BANNER_DISMISSED_KEY = "hibari:notification-banner-dismissed";
export const SOUND_KEY = "hibari:notification-sound";

const listeners = new Set<() => void>();

export function subscribeNotificationPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed() {
  for (const listener of listeners) listener();
}

export function notificationPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

/** サーバーでの描画では分からないので、帯も設定も出さない形（unsupported）で描く。 */
export function serverNotificationPermission(): BrowserNotificationPermission {
  return "unsupported";
}

/** 許可を求める。ボタンを押した操作の中で呼ぶこと（ブラウザは操作をきっかけにしない要求を拒む）。 */
export async function requestNotificationPermission(): Promise<void> {
  if (notificationPermission() === "unsupported") return;
  try {
    await window.Notification.requestPermission();
  } finally {
    changed();
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 覚えられないだけで、この画面では反映する
  }
  changed();
}

export function bannerDismissed(): boolean {
  return read(BANNER_DISMISSED_KEY) === "1";
}

export function dismissBanner(): void {
  write(BANNER_DISMISSED_KEY, "1");
}

/** 通知音。既定はオン（ADR 0057 決定 6）。 */
export function soundEnabled(): boolean {
  return read(SOUND_KEY) !== "off";
}

export function setSoundEnabled(on: boolean): void {
  write(SOUND_KEY, on ? "on" : "off");
}

/** ブラウザの設定で許可が変わったとき（Permissions API のあるブラウザだけ）にも知らせる。 */
export function watchPermission(): () => void {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return () => {};
  let status: PermissionStatus | undefined;
  let stopped = false;
  void navigator.permissions
    .query({ name: "notifications" })
    .then((s) => {
      if (stopped) return;
      status = s;
      s.onchange = changed;
    })
    .catch(() => {});
  return () => {
    stopped = true;
    if (status) status.onchange = null;
  };
}
