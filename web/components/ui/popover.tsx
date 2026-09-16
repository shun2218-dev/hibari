import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * ボタンの近くに浮かせる小さなパネル（ワークスペースの切り替え、ロールの選択、管理できない理由）。
 * 位置は親（relative）からの absolute で、置き場所は呼び出し側が className で決める。
 */
export function Popover({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className={cx("absolute z-40 rounded-md border border-border bg-surface p-1.5 shadow-overlay", className)}
    >
      {children}
    </div>
  );
}
