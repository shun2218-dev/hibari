"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * 中身を `document.body` の直下に出す。
 *
 * 画面に浮かせるもの（`fixed`）に使う。`transform` / `translate` の当たった祖先があると、
 * `fixed` はその要素を基準にしてしまい、画面の座標で置けなくなる
 * （`ChatLayout` は横のスライドのために `translate` を使う）。
 * body の直下まで出せば、どこから開いても画面の座標で置ける。
 *
 * サーバーでの描画では何も出さない（`createPortal` はサーバーで使えない）。
 * 浮かせるものは操作で開くので、最初の HTML には出てこない。
 */
export function Portal({ children }: { children: ReactNode }) {
  // サーバーとクライアントで食い違いを起こさずに切り替える（useOrigin と同じ形）
  const onClient = useSyncExternalStore(neverChanges, () => true, () => false);
  return onClient ? createPortal(children, document.body) : null;
}

/** ブラウザかどうかは変わらないので、購読する先がない。 */
const neverChanges = () => () => {};
