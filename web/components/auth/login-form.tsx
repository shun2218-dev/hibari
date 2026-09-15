"use client";

import type { FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordField, TextField } from "@/components/ui/field";
import { TextLink } from "@/components/ui/link";

import { AuthHeading } from "./auth-shell";

/**
 * ログインの失敗。
 * - credentials: メールアドレスかパスワードが違う。どちらが違うか、アカウントがあるかは明かさない
 * - rate_limited: 試行が多すぎる（429）
 */
export type LoginError = "credentials" | "rate_limited";

const errorMessage: Record<LoginError, string> = {
  credentials: "メールアドレスまたはパスワードが違います",
  rate_limited: "ログインの試行が多すぎます。しばらく時間をおいてから再度お試しください。",
};

export type LoginValues = { email: string; password: string };

type LoginFormProps = {
  error?: LoginError;
  submitting?: boolean;
  onSubmit?: (values: LoginValues) => void;
  forgotPasswordHref: string;
  signupHref: string;
};

export function LoginForm({ error, submitting, onSubmit, forgotPasswordHref, signupHref }: LoginFormProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit?.({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <AuthHeading title="ログイン" />
      {error && <Alert tone="danger">{errorMessage[error]}</Alert>}
      <div className="flex flex-col gap-4">
        <TextField label="メールアドレス" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        <PasswordField label="パスワード" name="password" autoComplete="current-password" placeholder="パスワード" required />
      </div>
      <Button type="submit" size="lg" disabled={submitting}>
        ログイン
      </Button>
      <div className="flex justify-between text-xs">
        <TextLink href={forgotPasswordHref}>パスワードをお忘れですか？</TextLink>
        <TextLink href={signupHref}>アカウントを作成</TextLink>
      </div>
    </form>
  );
}
