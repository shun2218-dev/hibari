import type { ButtonHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/**
 * - primary: 画面の主な操作（緑の地）
 * - secondary: キャンセルなど。枠だけで地は surface
 * - danger: 取り消せない破壊的な操作の確定（キック・退出）
 * - danger-outline: 破壊的な操作への入口（「退出する」「他のすべてのデバイスからログアウト」）
 * - primary-outline: 主ではないが緑の操作（「確認メールを再送する」）
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-outline" | "primary-outline";

/**
 * - lg: 認証カード・フォームの全幅ボタン（高さ 44px、本文と同じ 15px）
 * - md: ダイアログ・設定画面のボタン（高さ 40px）
 * - sm: 入力欄の中などの小さいボタン（高さ 32px）
 */
export type ButtonSize = "lg" | "md" | "sm";

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-text hover:bg-surface-muted",
  danger: "bg-danger text-on-primary",
  "danger-outline": "border border-danger bg-surface text-danger hover:bg-danger-subtle",
  "primary-outline": "border border-primary bg-surface text-primary hover:bg-primary-subtle",
};

// 無効なボタンは種類によらず同じ見た目にする（押せないことが色より先に伝わるように）
const disabledClass = "disabled:border disabled:border-border disabled:bg-surface-muted disabled:text-text-muted";

const sizeClass: Record<ButtonSize, string> = {
  lg: "h-11 w-full rounded-md px-4 text-lg",
  md: "h-10 rounded-md px-4 text-base",
  sm: "h-8 rounded-sm px-3 text-sm",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed",
        variantClass[variant],
        disabledClass,
        sizeClass[size],
        className,
      )}
      {...props}
    />
  );
}

/** 文中や行末に置く、枠のないテキストだけのボタン（「再送する」「取り消す」「ログインに戻る」）。 */
export function TextButton({
  tone = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "danger" }) {
  return (
    <button
      type={type}
      className={cx(
        "font-medium hover:underline disabled:text-text-muted disabled:no-underline",
        tone === "primary" ? "text-primary" : "text-danger",
        className,
      )}
      {...props}
    />
  );
}

/** アイコンだけのボタン。見た目にラベルがないので aria-label を必須にする。 */
export function IconButton({
  label,
  muted = false,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  /** 補助的なボタン（管理できない理由の鍵）。アイコンを薄くする。 */
  muted?: boolean;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent",
        muted ? "text-text-muted" : "text-text-secondary",
        className,
      )}
      {...props}
    />
  );
}
