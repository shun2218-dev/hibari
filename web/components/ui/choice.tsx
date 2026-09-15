import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

type RadioCardProps = {
  name: string;
  value: string;
  checked: boolean;
  onChange?: (value: string) => void;
  disabled?: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** タイトルの右や下に置く補足（アバター、ロールなど）。 */
  leading?: ReactNode;
  trailing?: ReactNode;
};

/**
 * 選択肢を枠で囲んだラジオボタン（招待ポリシー、テーマ、譲渡先）。
 * 本物の input[type=radio] を使い、キーボード操作と読み上げはブラウザに任せる。
 */
export function RadioCard({ name, value, checked, onChange, disabled, title, description, leading, trailing }: RadioCardProps) {
  return (
    <label
      className={cx(
        "flex items-center gap-3 rounded-md border px-3.5 has-focus-visible:outline-2 has-focus-visible:outline-primary",
        leading ? "py-2" : "py-3",
        checked ? "border-primary bg-primary-subtle" : "border-border bg-surface",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange?.(value)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-primary bg-primary" : "border-border bg-surface",
        )}
      >
        {checked && <span className="size-1.5 rounded-full bg-on-primary" />}
      </span>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold text-text">{title}</span>
        {description && <span className="text-2xs text-text-muted">{description}</span>}
      </span>
      {trailing}
    </label>
  );
}

/** 横に並べる丸いラジオ（招待リンクの使用回数・有効期限）。 */
export function ChoiceChip({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange?: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cx(
        "inline-flex h-8.5 cursor-pointer items-center rounded-full border px-3.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-primary",
        checked ? "border-primary bg-primary-subtle font-semibold text-primary" : "border-border bg-surface text-text",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange?.(value)}
        className="sr-only"
      />
      {children}
    </label>
  );
}
