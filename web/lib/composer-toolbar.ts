/**
 * 入力欄の書式のツールバーを出すかどうか（ADR 0052 の追記。Slack の書式設定アイコンと同じ切り替え）。
 *
 * 見る人ごとの好みなので、サーバーには持たず localStorage に置く（テーマと同じ。lib/theme.ts）。
 * 読み書きに失敗したら「覚えていない」と同じに扱い、既定の「出す」で描く。
 * チャンネルとスレッドの入力欄が同じ画面に並ぶので、片方で切り替えたらもう片方も追従させる。
 *
 * 購読するフックは hooks/use-composer-toolbar.ts。
 */

export const COMPOSER_TOOLBAR_STORAGE_KEY = "hibari:composer-toolbar";

const listeners = new Set<() => void>();

/** localStorage に書けなかったときの値。この画面の中だけでも切り替えを効かせる。 */
let fallback: boolean | null = null;

export function subscribeComposerToolbar(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function composerToolbarVisible(): boolean {
  if (fallback !== null) return fallback;
  try {
    return localStorage.getItem(COMPOSER_TOOLBAR_STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

/** サーバーでの描画では localStorage がないので、既定の「出す」で描く。 */
export function serverComposerToolbarVisible(): boolean {
  return true;
}

export function setComposerToolbarVisible(visible: boolean): void {
  try {
    if (visible) localStorage.removeItem(COMPOSER_TOOLBAR_STORAGE_KEY);
    else localStorage.setItem(COMPOSER_TOOLBAR_STORAGE_KEY, "hidden");
    fallback = null;
  } catch {
    // 覚えられないだけで、この画面では切り替える（開き直すと既定に戻る）。
    fallback = visible;
  }
  for (const listener of listeners) listener();
}

