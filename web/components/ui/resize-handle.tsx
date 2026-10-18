"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

import { cx } from "@/lib/cx";
import { PANES, type PaneId, paneSize, paneVar, setPaneSize, subscribePaneSize } from "@/lib/pane-size";

/** キーボードで動かす 1 回の量（px）。Shift を押していれば 4 倍。 */
const STEP = 16;

type ResizeHandleProps = {
  pane: PaneId;
  /** どちらへ引くと大きくなるか。サイドバーは右、右のパネルは左、入力欄は上。 */
  grow: "right" | "left" | "up";
  /**
   * 大きさを測る相手。CSS が clamp した**結果**を読むために要る。
   * この部品は最小・最大の数値を持たない（正本は globals.css の `--pane-*`。ADR 0048）。
   */
  measure: RefObject<HTMLElement | null>;
};

/**
 * エリアの境目をドラッグして大きさを変える取っ手（ADR 0048）。
 *
 * 普段は見せない。画面に線が 1 本増えると `docs/ui/` の見た目が変わってしまうので、
 * ポインタを乗せたときと動かしている間だけ primary の線を出す（緑 = 操作できるもの）。
 * モバイルでは出さない（幅を変える余地がなく、当たりが本文と重なる）。
 *
 * 読み上げには `separator` の役で出す。矢印で動かし、Home / End で最小・最大、
 * Enter かダブルクリックで既定に戻す。
 */
export function ResizeHandle({ pane, grow, measure }: ResizeHandleProps) {
  const axis = PANES[pane].axis;
  const [dragging, setDragging] = useState(false);
  // 読み上げ用の現在値と限界。描くのに使わないので、測れるようになってから入れる
  const [now, setNow] = useState<number | null>(null);
  const [limits, setLimits] = useState<{ min: number; max: number } | null>(null);
  // 動かしている間の後始末。途中で消えても listener を残さないため
  const stopDrag = useRef<(() => void) | null>(null);

  /** いまの大きさ。ref を読むので、描画には使わずイベントの中だけで呼ぶ。 */
  function read() {
    return measured(measure.current, axis);
  }

  // 限界は CSS が決めるので、極端な値を入れて描かせた結果から測る。
  // 窓の大きさで変わる（最大に vw / vh を混ぜてある）ので、窓が変わるたびに測り直す
  useEffect(() => {
    const sync = () => {
      setLimits(measureLimits(pane, () => measured(measure.current, axis)));
      setNow(measured(measure.current, axis));
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [pane, measure, axis]);

  // 引っ張っている最中と、既定に戻したときの現在値を追う
  useEffect(() => subscribePaneSize(() => setNow(measured(measure.current, axis))), [measure, axis]);

  useEffect(() => () => stopDrag.current?.(), []);

  function apply(size: number, remember: boolean) {
    // CSS も clamp するが、TS でも止める。止めないと、限界の先まで動かしたポインタを
    // 同じだけ戻すまで大きさが変わらず、引っかかったように見える
    const bounded = limits ? Math.min(Math.max(size, limits.min), limits.max) : size;
    setPaneSize(pane, bounded, remember);
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    // 主ボタンだけ。ついでにドラッグ中の文字の選択も止める
    if (e.button !== 0) return;
    e.preventDefault();
    const start = read();
    if (start === null) return;
    const from = axis === "width" ? e.clientX : e.clientY;
    const sign = grow === "right" ? 1 : -1;

    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);

    const move = (event: globalThis.PointerEvent) => {
      const to = axis === "width" ? event.clientX : event.clientY;
      // 動かしている間は覚えない。離したときに 1 度だけ書く
      apply(start + (to - from) * sign, false);
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      stopDrag.current = null;
      setDragging(false);
      const size = paneSize(pane);
      if (size !== undefined) setPaneSize(pane, size);
    };
    stopDrag.current = end;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = read();
    if (current === null) return;
    const step = e.shiftKey ? STEP * 4 : STEP;
    // 境目を動かす向きで考える。横の境目は左右、入力欄の上辺は上下
    const back = axis === "width" ? "ArrowLeft" : "ArrowUp";
    const forward = axis === "width" ? "ArrowRight" : "ArrowDown";
    // 境目を「後ろ」へ動かしたときに大きくなるか、小さくなるか
    const sign = grow === "right" ? 1 : -1;

    switch (e.key) {
      case back:
        e.preventDefault();
        return apply(current - step * sign, true);
      case forward:
        e.preventDefault();
        return apply(current + step * sign, true);
      case "Home":
        if (!limits) return;
        e.preventDefault();
        return apply(limits.min, true);
      case "End":
        if (!limits) return;
        e.preventDefault();
        return apply(limits.max, true);
      case "Enter":
        e.preventDefault();
        return setPaneSize(pane, undefined);
    }
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={PANES[pane].label}
      aria-orientation={axis === "width" ? "vertical" : "horizontal"}
      aria-valuenow={now ?? undefined}
      aria-valuemin={limits?.min}
      aria-valuemax={limits?.max}
      aria-valuetext={now === null ? undefined : `${Math.round(now)} ピクセル`}
      title={`ドラッグで${PANES[pane].label}を変える（ダブルクリックで既定に戻す）`}
      onPointerDown={handlePointerDown}
      onDoubleClick={() => setPaneSize(pane, undefined)}
      onKeyDown={handleKeyDown}
      className={cx(
        // 当たりは 8px 取り、見えるのは真ん中の 2px の線（::after）だけにする
        // （サイドバーの選択中の縦バーと同じ太さ）。z-10 は隣の内容より前に出すため
        "absolute z-10 hidden md:block",
        "after:absolute after:bg-transparent hover:after:bg-primary",
        dragging && "after:bg-primary",
        axis === "width"
          ? "inset-y-0 w-2 cursor-col-resize after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2"
          : "inset-x-0 h-2 cursor-row-resize after:inset-x-0 after:top-1/2 after:h-0.5 after:-translate-y-1/2",
        grow === "right" && "-right-1",
        grow === "left" && "-left-1",
        grow === "up" && "-top-1",
      )}
    />
  );
}

/** いまの大きさ（px）。まだ描かれていなければ null。 */
function measured(el: HTMLElement | null, axis: "width" | "height"): number | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return axis === "width" ? rect.width : rect.height;
}

/**
 * 最小と最大を測る。CSS の clamp が正本なので、極端な値をいったん入れて、描かれた結果を読む。
 * 同じ処理の中で元に戻すので、途中の姿は画面に出ない。
 */
function measureLimits(pane: PaneId, read: () => number | null): { min: number; max: number } | null {
  if (typeof document === "undefined") return null;
  const style = document.documentElement.style;
  const saved = style.getPropertyValue(paneVar(pane));

  style.setProperty(paneVar(pane), "0px");
  const min = read();
  style.setProperty(paneVar(pane), "1000000px");
  const max = read();

  if (saved) style.setProperty(paneVar(pane), saved);
  else style.removeProperty(paneVar(pane));

  return min === null || max === null || max <= min ? null : { min, max };
}
