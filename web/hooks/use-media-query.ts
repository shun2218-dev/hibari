"use client";

import { useSyncExternalStore } from "react";

/** モバイルのレイアウトの境目（globals.css の `--breakpoint-md` と同じ 768px）。 */
export const DESKTOP_QUERY = "(min-width: 48rem)";

/**
 * メディアクエリに当たっているか。
 *
 * ふだんの出し分けは Tailwind の `md:` で足りるが、**置き方そのものが変わる**ところでは
 * クラスでは書き分けられないので、こちらで見る（絵文字のピッカーは、md 以上は画面に浮かせ、
 * モバイルは下から出るシートにする。ADR 0044）。
 *
 * サーバーでの描画と、matchMedia のない環境（jsdom）では当たっていない（false）扱いにする。
 * モバイルのシートの方が、画面の大きさを知らなくても崩れない形なので、そちらを既定にする。
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMediaOrNull(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    () => matchMediaOrNull(query)?.matches ?? false,
    () => false,
  );
}

function matchMediaOrNull(query: string): MediaQueryList | null {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" ? null : window.matchMedia(query);
}
