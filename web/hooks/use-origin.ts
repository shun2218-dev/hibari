"use client";

import { useSyncExternalStore } from "react";

/** オリジンは変わらないので、購読する先がない。 */
const neverChanges = () => () => {};

/**
 * この画面のオリジン（`https://hibari.example`）。パーマリンクの組み立てと、本文から見つけるのに使う（ADR 0040）。
 *
 * サーバー側の描画では window がないので undefined になり、ハイドレーションのあとに入る
 * （useSyncExternalStore のサーバー用のスナップショットで、サーバーとクライアントの食い違いを起こさずに切り替える）。
 * サーバーに「公開オリジン」の設定を足さずに済ませるため、ブラウザから取る（Web と API は同じサイト。ADR 0021）。
 * オリジンが分かるまではカードを出さないが、リンクのない本文と同じ見た目なので、ちらつきにはならない。
 */
export function useOrigin(): string | undefined {
  return useSyncExternalStore(
    neverChanges,
    () => window.location.origin,
    () => undefined,
  );
}
