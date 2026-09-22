"use client";

import type { ReactNode, RefObject } from "react";

import { AnchoredPanel } from "@/components/ui/anchored-panel";
import { Portal } from "@/components/ui/portal";

/**
 * リアクションを選ぶピッカー（ADR 0044）。md 以上は行の横に浮かせ、モバイルは下から出るシートにする。
 */
export function ReactionPicker({
  desktop,
  rowRef,
  picker,
  onTogglePicker,
}: {
  desktop: boolean;
  rowRef: RefObject<HTMLElement | null>;
  picker?: ReactNode;
  onTogglePicker?: () => void;
}) {
  return desktop ? (
    // 画面に浮かせる（fixed）。タイムラインの中に absolute で置くと、スクロールできる範囲が
    // ピッカーのぶん広がって、いちばん下のメッセージで開いたときに下に余白ができる。
    // 入力欄より上に出すのも狙いどおり（絵文字を選んでいる間は入力しない）。
    // 中身（emoji-mart）が自前の地と角丸を持つので、枠は外側で足すだけにして二重の額縁を避ける
    <AnchoredPanel
      anchorRef={rowRef}
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
