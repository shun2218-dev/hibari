import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

import { AlertIcon, LockIcon } from "./icons";

/**
 * 画面内に置く注意書き。
 * - danger: 操作が失敗した（ログインエラー）。role="alert" で読み上げる
 * - attention: いま知っておくべきこと（招待リンクは再表示できない）
 * - locked: 権限が足りなくて操作できない理由。鍵のアイコンを付ける
 */
export type AlertTone = "danger" | "attention" | "locked";

const toneClass: Record<AlertTone, string> = {
  danger: "bg-danger-subtle text-danger",
  attention: "bg-attention-subtle text-attention-text",
  locked: "bg-surface-muted text-text-secondary",
};

export function Alert({ tone, children, className }: { tone: AlertTone; children: ReactNode; className?: string }) {
  const Icon = tone === "locked" ? LockIcon : AlertIcon;
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx("flex items-start gap-2 rounded-md px-3 py-2.5 text-xs leading-normal", toneClass[tone], className)}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** 補足を枠で囲んで置く（「届かないときは、迷惑メールフォルダと…」）。 */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-md border border-border px-3.5 py-3 text-xs leading-relaxed text-text-secondary", className)}>
      {children}
    </div>
  );
}
