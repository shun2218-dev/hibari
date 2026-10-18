import { cx } from "@/lib/cx";

import type { UserStatusView } from "./types";

/**
 * カスタムステータスの絵文字（ADR 0049）。名前の横に出す。
 *
 * 文言はここでは出さない（名前の行の長さが人によってばらばらになるため）。
 * 文言と「いつ消えるか」はホバーの `title` と読み上げに載せる（Slack と同じ）。
 * そのまま読める場所はメンバーパネルとプロフィールのカード（6.9）にする。
 */
export function StatusEmoji({ status, className }: { status: UserStatusView; className?: string }) {
  const hint = [status.text, status.expiresLabel].filter(Boolean).join(" · ");
  const label = hint ? `ステータス: ${status.emoji} ${hint}` : `ステータス: ${status.emoji}`;
  return (
    <span role="img" aria-label={label} title={hint || undefined} className={cx("shrink-0 leading-none", className)}>
      {status.emoji}
    </span>
  );
}
