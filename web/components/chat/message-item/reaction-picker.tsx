"use client";

import type { ReactNode, RefObject } from "react";

import { AnchoredPanel } from "@/components/ui/anchored-panel";
import { Portal } from "@/components/ui/portal";

/**
 * リアクションを選ぶピッカー（ADR 0044）。md 以上は浮かせ、モバイルは下から出るシートにする。
 *
 * md 以上の置き場所は、開いたボタンで変える。行の右上の操作から開いたら行の右上に、
 * メッセージの下のリアクションの「＋」から開いたら、その「＋」のすぐ下に出す（Slack と同じ。押したボタンの近く）。
 */
export function ReactionPicker({
  desktop,
  rowRef,
  addButtonRef,
  picker,
  onTogglePicker,
}: {
  desktop: boolean;
  rowRef: RefObject<HTMLElement | null>;
  /** リアクションの「＋」から開いたときに渡す。渡すとそのボタンのすぐ下に出す。 */
  addButtonRef?: RefObject<HTMLElement | null>;
  picker?: ReactNode;
  onTogglePicker?: () => void;
}) {
  return desktop ? (
    // 画面に浮かせる（fixed）。タイムラインの中に absolute で置くと、スクロールできる範囲が
    // ピッカーのぶん広がって、いちばん下のメッセージで開いたときに下に余白ができる。
    // 入力欄より上に出すのも狙いどおり（絵文字を選んでいる間は入力しない）。
    // 中身（emoji-mart）が自前の地と角丸を持つので、枠は外側で足すだけにして二重の額縁を避ける
    <AnchoredPanel
      anchorRef={addButtonRef ?? rowRef}
      near={addButtonRef !== undefined}
      // 外を押したかは、どちらから開いても行で判定する（行の中の操作を押し直したときに、閉じてすぐ開き直さないように）
      ignoreRef={rowRef}
      label="リアクションを選ぶ"
      onDismiss={onTogglePicker}
      className="w-88 overflow-hidden rounded-md border border-border bg-surface shadow-overlay"
    >
      {picker}
    </AnchoredPanel>
  ) : (
    // モバイルは下から出るシート（メンバーのシートと同じ形）。画面が狭く、浮かせる余地がない
    <Portal>
      <div aria-hidden className="fixed inset-0 z-40 bg-overlay" onClick={onTogglePicker} />
      <div
        role="dialog"
        aria-label="リアクションを選ぶ"
        className="fixed inset-x-0 bottom-0 z-50 overflow-hidden rounded-t-lg bg-surface"
      >
        {picker}
      </div>
    </Portal>
  );
}
