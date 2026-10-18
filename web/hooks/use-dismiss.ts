import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * 浮かせたパネル（メニュー・ピッカー）を、外を押す・Esc で閉じる（アプリで共通の振る舞い。オーナーの要望、2026-09-21）。
 *
 * - 押し下げで閉じる。押したまま外へ動かしても閉じるようにするため
 * - パネルの中は「外」に数えない。ignore（ピッカーを開いたメッセージの行など）の中も数えない
 * - **開いているボタン（`aria-expanded="true"`）の上も数えない**。そのボタンは押すと自分で閉じる。ここで閉じると、
 *   続くボタンの処理がまた開いてしまい、閉じられなくなる。メニューを開くボタンには aria-expanded を付ける決まり
 * - onDismiss を渡さなければ何もしない（story で開いた状態を描くとき）
 */
export function useDismiss(
  panel: HTMLElement | null,
  onDismiss: (() => void) | undefined,
  ignore?: RefObject<HTMLElement | null>,
): void {
  const dismiss = useEffectEvent(() => onDismiss?.());
  const enabled = onDismiss !== undefined;

  useEffect(() => {
    if (!panel || !enabled) return;
    function dismissIfOutside(event: PointerEvent) {
      const target = event.target;
      if (!isNode(target)) return;
      if (panel?.contains(target) || ignore?.current?.contains(target)) return;
      if (target.nodeType === Node.ELEMENT_NODE && (target as Element).closest('[aria-expanded="true"]')) return;
      dismiss();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    // パネルのある document で聞く。ハドルのタブ（about:blank）に portal で描いたメニューもある（ADR 0066 追記 C）
    const doc = panel.ownerDocument;
    doc.addEventListener("pointerdown", dismissIfOutside);
    doc.addEventListener("keydown", dismissOnEscape);
    return () => {
      doc.removeEventListener("pointerdown", dismissIfOutside);
      doc.removeEventListener("keydown", dismissOnEscape);
    };
  }, [panel, enabled, ignore]);
}

/**
 * instanceof Node は使わない。ハドルのタブ（about:blank）の要素は、そのタブの Node から作られていて、
 * チャットのタブの Node の instanceof に当たらないため。
 */
function isNode(target: EventTarget | null): target is Node {
  return target !== null && typeof (target as Partial<Node>).nodeType === "number";
}
