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
 * 知らせが要るものの数。「いま起きていること」なので琥珀にする（primary にしない。docs/ui/tokens.md）。
 * 0 のときは何も出さない。
 *
 * 数字のバッジは「本人に知らせが要るもの」にだけ出す（ADR 0043。オーナーの判断。2026-09-19。Slack に合わせる）。
 * チャンネルでは自分宛てのメンションがそれにあたり、`@3` と出す。DM は 1 通が知らせなので、数をそのまま出す。
 * ただ読んでいないだけのチャンネルにはバッジを出さず、名前を太字にして示す（sidebar.tsx が出し分ける）。
 */
export function UnreadBadge({ count, mention = false, className }: { count: number; mention?: boolean; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={mention ? `メンション ${count} 件` : `未読 ${count} 件`}
      className={cx(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-attention px-1.5 text-2xs leading-none font-semibold text-on-attention",
        className,
      )}
    >
      {mention && "@"}
      {count > 99 ? "99+" : count}
    </span>
  );
}
