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
      if (!(target instanceof Node)) return;
      if (panel?.contains(target) || ignore?.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[aria-expanded="true"]')) return;
      dismiss();
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("pointerdown", dismissIfOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissIfOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [panel, enabled, ignore]);
}
