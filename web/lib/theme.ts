import type { Theme } from "@/components/settings/settings-sections";

/**
 * ライト / ダークの切り替え（`settings/appearance/appearance.png`）。
 *
 * テーマは `<html data-theme="dark">` で切り替え、**OS の設定には追従しない**（CLAUDE.md「デザイン」）。
 * 端末ごとの見た目の好みなので、サーバーには持たず localStorage に置く。読み書きに失敗したら「覚えていない」と同じに扱う
 * （プライベートウィンドウや、サイトのデータを消した直後）。
 */

export const THEME_STORAGE_KEY = "hibari:theme";

export const DEFAULT_THEME: Theme = "light";

const listeners = new Set<() => void>();

/** テーマの変更を購読する（useSyncExternalStore 用）。 */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * いま当たっているテーマ。head のスクリプトが `data-theme` を付けているので、まずそれを見る
 * （毎回同じ文字列を返す。useSyncExternalStore が描き直しを繰り返さない）。
 */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return document.documentElement.dataset.theme === "dark" ? "dark" : DEFAULT_THEME;
}

/** サーバーでの描画では localStorage も DOM もないので、既定のテーマで描く。 */
export function serverTheme(): Theme {
  return DEFAULT_THEME;
}

/** テーマを覚えて、いま見ている画面にも当てる。 */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 覚えられないだけで、この画面の見た目は変える。
  }
  applyTheme(theme);
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  for (const listener of listeners) listener();
}

/**
 * 最初の描画の前にテーマを当てる 1 行（`<script>` に入れて head に置く）。
 * React の描画を待つと、ダークにしている人に一瞬ライトの画面が見える。
 */
export const themeBootScript = `try{document.documentElement.dataset.theme=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="dark"?"dark":"light"}catch(e){}`;
