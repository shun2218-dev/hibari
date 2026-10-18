"use client";

import type { FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type PasswordStrength, PasswordField, TextField } from "@/components/ui/field";
import { TextLink } from "@/components/ui/link";

import { AuthHeading } from "./auth-shell";

export type SignupValues = { displayName: string; handle: string; email: string; password: string };

type SignupFormProps = {
  /** サーバーが返した入力エラーの文言（ハンドルが使われている、など）。 */
  error?: string;
  passwordStrength?: PasswordStrength;
  /** 入力エラーで戻ってきたときなどに、入力済みのパスワードを残す。 */
  passwordDefaultValue?: string;
  onPasswordChange?: (password: string) => void;
  submitting?: boolean;
  onSubmit?: (values: SignupValues) => void;
  loginHref: string;
};

export function SignupForm({
  error,
  passwordStrength,
  passwordDefaultValue,
  onPasswordChange, submitting, onSubmit, loginHref }: SignupFormProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit?.({
      displayName: String(data.get("display_name") ?? ""),
      handle: String(data.get("handle") ?? ""),
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <AuthHeading title="アカウントを作成" />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col gap-4">
        <TextField label="表示名" name="display_name" autoComplete="name" placeholder="佐藤 直樹" required />
        <TextField
          label="ハンドル"
          name="handle"
          prefix="@"
          mono
          autoComplete="username"
          placeholder="naoki"
          hint="メンションに使われる表示用の ID です。"
          required
        />
        <TextField label="メールアドレス" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        <PasswordField
          label="パスワード"
          name="password"
          autoComplete="new-password"
          strength={passwordStrength}
          defaultValue={passwordDefaultValue}
          onChange={(e) => onPasswordChange?.(e.target.value)}
          required
        />
      </div>
      <Button type="submit" size="lg" disabled={submitting}>
        アカウントを作成
      </Button>
      <p className="text-center text-xs text-text-muted">
        すでにアカウントをお持ちですか？ <TextLink href={loginHref} className="ml-1">ログイン</TextLink>
      </p>
    </form>
  );
}
