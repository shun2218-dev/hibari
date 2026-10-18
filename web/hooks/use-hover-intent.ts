"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 乗せてから開くまで。名前の上をポインタが通り過ぎただけでは開かない。 */
export const HOVER_OPEN_DELAY_MS = 500;
/** 離れてから閉じるまで。アバターからカードへポインタを移す間に閉じない。 */
export const HOVER_CLOSE_DELAY_MS = 200;

/**
 * ホバーで開くもの（プロフィールのカード。ADR 0050 決定 6 の追記）の開け閉て。
 *
 * きっかけ（アバターや名前）とカードの両方に `bind` を付ける。どちらかに乗っている間は開いたままにし、
 * 両方から離れて少したったら閉じる。タッチの操作では開かない（タッチの「ホバー」は押したのと区別できず、
 * 押したら開くパネルと二重になる）。
 */
export function useHoverIntent({
  openDelay = HOVER_OPEN_DELAY_MS,
  closeDelay = HOVER_CLOSE_DELAY_MS,
}: { openDelay?: number; closeDelay?: number } = {}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // 開いたまま外れた（行が消えた）ときにタイマーを残さない
  useEffect(() => clear, [clear]);

  const onPointerEnter = useCallback(
    (event: { pointerType: string }) => {
      if (event.pointerType !== "mouse") return;
      clear();
      timer.current = setTimeout(() => setOpen(true), openDelay);
    },
    [clear, openDelay],
  );

  const onPointerLeave = useCallback(
    (event: { pointerType: string }) => {
      if (event.pointerType !== "mouse") return;
      clear();
      timer.current = setTimeout(() => setOpen(false), closeDelay);
    },
    [clear, closeDelay],
  );

  /** 押して別のもの（パネル）を開いたなど、すぐに閉じたいとき。 */
  const close = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  return { open, close, bind: { onPointerEnter, onPointerLeave } };
}
