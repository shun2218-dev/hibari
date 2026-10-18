"use client";

import { type InputHTMLAttributes, type ReactNode, useId, useState } from "react";

import { cx } from "@/lib/cx";

import { EyeIcon, EyeOffIcon } from "./icons";

// 入力欄はフォーカスリングを枠の内側に出す（docs/ui/tokens.md「フォーカス」）
const inputClass =
  "h-11 w-full rounded-md border border-border bg-surface px-3 text-lg text-text focus-visible:-outline-offset-2 disabled:bg-surface-muted disabled:text-text-muted";

type FieldProps = {
  label: string;
  hint?: ReactNode;
  children: (id: string, hintId: string | undefined) => ReactNode;
  className?: string;
};

/** ラベル・入力・補足をまとめる。ラベルと補足を input に関連付ける id はここで作る。 */
export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-text">
        {label}
      </label>
      {children(id, hintId)}
      {hint && (
        <p id={hintId} className="text-2xs text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: ReactNode;
  /** 入力欄の左に固定で出す文字（ハンドルの「@」）。 */
  prefix?: string;
  /**
   * 入力欄の左に並べる操作（カスタムステータスの絵文字のボタン）。
   * ラベルと補足の外ではなく**入力欄と同じ行**に置くので、高さがそろう（外に置くと補足のぶん下にずれる）。
   */
  leading?: ReactNode;
  mono?: boolean;
};

export function TextField({ label, hint, prefix, leading, mono, className, ...props }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id, hintId) => {
        const input = prefix ? (
          <div className="relative">
            <span
              aria-hidden
              className={cx("absolute top-1/2 left-3 -translate-y-1/2 text-lg text-text-muted", mono && "font-mono")}
            >
              {prefix}
            </span>
            <input id={id} aria-describedby={hintId} className={cx(inputClass, "pl-7", mono && "font-mono")} {...props} />
          </div>
        ) : (
          <input id={id} aria-describedby={hintId} className={cx(inputClass, mono && "font-mono")} {...props} />
        );
        if (!leading) return input;
        return (
          <div className="flex items-center gap-2">
            {leading}
            <div className="min-w-0 flex-1">{input}</div>
          </div>
        );
      }}
    </Field>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "prefix" | "mono"> & {
  /** 入力中のパスワードの強さ。登録と再設定のときだけ出す。 */
  strength?: PasswordStrength;
};

export type PasswordStrength = { level: 0 | 1 | 2 | 3 | 4; label: string };

export function PasswordField({ label, hint, strength, className, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} className={className}>
      {(id, hintId) => (
        <>
          <div className="relative">
            <input
              id={id}
              type={visible ? "text" : "password"}
              aria-describedby={hintId}
              className={cx(inputClass, "pr-11")}
              {...props}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? "パスワードを隠す" : "パスワードを表示する"}
              aria-pressed={visible}
              className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-muted"
            >
              {visible ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
            </button>
          </div>
          {strength && <StrengthMeter strength={strength} />}
        </>
      )}
    </Field>
  );
}

function StrengthMeter({ strength }: { strength: PasswordStrength }) {
  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <div
        role="meter"
        aria-label="パスワードの強度"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength.level}
        aria-valuetext={strength.label}
        className="grid grid-cols-4 gap-1"
      >
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cx("h-1 rounded-full", step <= strength.level ? "bg-text-secondary" : "bg-border")}
          />
        ))}
      </div>
      <p className="text-2xs text-text-muted">強度: {strength.label}</p>
    </div>
  );
}
