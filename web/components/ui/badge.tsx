import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * 状態やロールを表す小さなラベル。押せる要素ではない。
 * - neutral: メンバー、上限到達、期限切れ
 * - primary: 管理者、有効、「あなた」「このデバイス」
 * - attention: オーナー（ワークスペースにひとりだけの特別な状態）
 * - danger: 取り消し済み
 */
export type BadgeTone = "neutral" | "primary" | "attention" | "danger";

const toneClass: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-text-secondary",
  primary: "bg-primary-subtle text-primary",
  attention: "bg-attention-subtle text-attention-text",
  danger: "bg-danger-subtle text-danger",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs leading-none font-semibold whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * 未読数。「いま起きていること」なので琥珀にする（primary にしない。docs/ui/tokens.md）。
 * 0 のときは何も出さない。
 */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`未読 ${count} 件`}
      className={cx(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-attention px-1.5 text-2xs leading-none font-semibold text-on-attention",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
