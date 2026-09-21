import type { ComponentType, ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * メニュー（Popover）の 1 行。Slack のメニューと同じく、文字の前にアイコンを置く（オーナーの要望、2026-09-21）。
 *
 * アイコンは読み上げない（文字が操作の名前）。アイコンのない行も、ほかの行と文字の頭をそろえるため、同じ幅の場所を取る。
 * 削除などの取り返しのつかない操作は danger（文字もアイコンも danger の色）。
 */
export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger = false,
}: {
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-9.5 w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-left text-base hover:bg-surface-muted",
        danger ? "font-medium text-danger" : "text-text",
      )}
    >
      <span aria-hidden className={cx("flex w-4 shrink-0 justify-center", danger ? "text-danger" : "text-text-secondary")}>
        {Icon && <Icon className="size-4" />}
      </span>
      {children}
    </button>
  );
}
