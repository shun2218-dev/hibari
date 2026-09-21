"use client";

import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { type PanelAlign, type PanelPlacement, placePanel } from "@/lib/anchored-position";
import { cx } from "@/lib/cx";

/**
 * アンカー（メッセージの行）に合わせて画面に浮かせるパネル。
 *
 * Popover（`absolute`）と違って **`fixed`** にする理由は 2 つ。
 *
 *  1. タイムラインの中に `absolute` で置くと、スクロールできる範囲がパネルのぶん広がる。
 *     いちばん下のメッセージで開くと、メッセージの下に余白ができてしまう
 *  2. スクロールする領域に切り取られず、入力欄の上に出せる
 *
 * `fixed` は `transform` / `translate` の当たった祖先があるとそれを基準にしてしまうので、
 * `Portal` で body の直下まで出してから置く（`ChatLayout` は横のスライドに `translate` を使う）。
 *
 * 代わりに位置を自分で計算する必要があるので、アンカーを測って `placePanel` に渡し、
 * スクロール・画面の大きさ・パネルの高さが変わったら測り直す。
 */
export function AnchoredPanel({
  anchorRef,
  label,
  className,
  children,
  onDismiss,
  align,
}: {
  /** 位置の基準。メッセージの行（article）を渡す。 */
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  className?: string;
  /** 横の合わせ方（既定はアンカーの右端）。狭いアンカー（ボタン）には "start" を渡す。 */
  align?: PanelAlign;
  children: ReactNode;
  /**
   * 外を押した、または Esc を押したので閉じる。
   * アンカー（メッセージの行）の中は「外」に数えない。開いたボタンを押し直したときに、
   * ここで閉じてからボタンが開き直して、閉じられなくなるため。
   */
  onDismiss?: () => void;
}) {
  // ref ではなく state で持つ。中身は Portal がマウントされた後に現れるので、
  // ref のままだと「まだ無い」まま effect が 1 回走って終わってしまう
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);

  useLayoutEffect(() => {
    if (!panel) return;
    function place() {
      const anchor = anchorRef.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      setPlacement(
        placePanel(
          rect,
          { width: panel.offsetWidth, height: panel.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          align,
        ),
      );
    }
    place();

    // 中身（emoji-mart）は動的 import で後から入るので、高さが決まった時点で測り直す
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(panel);
    window.addEventListener("resize", place);
    // タイムラインのスクロールも拾う（window ではなく内側の要素が動くので、捕捉フェーズで聞く）
    document.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [align, anchorRef, panel]);

  // 外を押す / Esc で閉じる。押し下げで閉じるのは、押したまま外へ動かしても閉じるようにするため
  useEffect(() => {
    if (!panel || !onDismiss) return;
    function dismissIfOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel?.contains(target) || anchorRef.current?.contains(target)) return;
      onDismiss?.();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss?.();
    }
    document.addEventListener("pointerdown", dismissIfOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissIfOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [anchorRef, panel, onDismiss]);

  return (
    <Portal>
      <div
        ref={setPanel}
        role="dialog"
        aria-label={label}
        data-placement={placement === null ? undefined : placement.below ? "below" : "above"}
        // 測る前に見せると、いったん左上に出てから飛ぶ。位置が決まるまでは透明のまま置く
        style={placement === null ? { top: 0, left: 0, opacity: 0 } : { top: placement.top, left: placement.left }}
        className={cx("fixed z-50", className)}
      >
        {children}
      </div>
    </Portal>
  );
}
