import { cx } from "@/lib/cx";

import type { UserStatusView } from "./types";

/**
 * カスタムステータスの絵文字（ADR 0049）。名前の横に出す。
 *
 * 文言はここでは出さない（名前の行の長さが人によってばらばらになるため）。
 * 文言はホバーの `title` と読み上げに載せ、そのまま読める場所はメンバーパネルとプロフィールのカード（6.9）にする。
 */
export function StatusEmoji({ status, className }: { status: UserStatusView; className?: string }) {
  const label = status.text ? `ステータス: ${status.emoji} ${status.text}` : `ステータス: ${status.emoji}`;
  return (
    <span role="img" aria-label={label} title={status.text} className={cx("shrink-0 leading-none", className)}>
      {status.emoji}
    </span>
  );
}
