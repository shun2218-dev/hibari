"use client";

import { type ReactNode, useState } from "react";

import { useDismiss } from "@/hooks/use-dismiss";
import { cx } from "@/lib/cx";

/**
 * ボタンの近くに浮かせる小さなパネル（メニュー、ワークスペースの切り替え、ロールの選択、管理できない理由）。
 * 位置は親（relative）からの absolute で、置き場所は呼び出し側が className で決める。
 *
 * onDismiss を渡すと、外を押す・Esc で閉じる（hooks/use-dismiss.ts。アプリで共通の振る舞い）。
 * 開くボタンには aria-expanded を付ける（開いているボタンを押したときは、ボタン自身が閉じる）。
 */
export function Popover({
  children,
  className,
  label,
  onDismiss,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  onDismiss?: () => void;
}) {
  // ref ではなく state で持つ。描いたあとの要素で購読を始めるため（AnchoredPanel と同じ）
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  useDismiss(panel, onDismiss);
  return (
    <div
      ref={setPanel}
      role="dialog"
      aria-label={label}
      className={cx("absolute z-40 rounded-md border border-border bg-surface p-1.5 shadow-overlay", className)}
    >
      {children}
    </div>
  );
}
