"use client";

import type { FormEvent } from "react";

import { Alert, Note } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type PasswordStrength, PasswordField, TextField } from "@/components/ui/field";
import { AlertIcon, CheckCircleIcon, MailIcon } from "@/components/ui/icons";
import { ButtonLink, TextLink } from "@/components/ui/link";

import { AuthHeading, StatusContent } from "./auth-shell";

/** パスワード再設定のメールを頼む。 */
export function ForgotPasswordForm({
  error,
  submitting,
  onSubmit,
  loginHref,
}: {
  /** 依頼が受け付けられなかった理由（回数制限）。ログイン・登録と同じ枠で出す。 */
  error?: string;
  submitting?: boolean;
  onSubmit?: (email: string) => void;
  loginHref: string;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit?.(String(new FormData(e.currentTarget).get("email") ?? ""));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <AuthHeading
        title="パスワードを再設定"
        description="アカウントのメールアドレスを入力してください。再設定用のリンクをお送りします。"
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField label="メールアドレス" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      <Button type="submit" size="lg" disabled={submitting}>
        再設定用のメールを送る
      </Button>
      <TextLink href={loginHref} className="self-center text-xs">
        ログインに戻る
      </TextLink>
    </form>
  );
}

/**
 * 再設定のメールを頼んだあと。アカウントがなくても同じ表示にする（存在の有無を明かさない）。
 */
export function ForgotPasswordSent({ loginHref, onRetry }: { loginHref: string; onRetry?: () => void }) {
  return (
    <StatusContent
      tone="primary"
      icon={<MailIcon className="size-5" />}
      title="メールを確認してください"
      description="入力したアドレスにアカウントがあれば、再設定用のメールを送りました。リンクの有効期限は1時間です。"
    >
      <Note>届かないときは、迷惑メールフォルダと、アドレスの綴りを確かめてください。</Note>
      <div className="flex flex-col items-center gap-3">
        <ButtonLink href={loginHref}>ログインに戻る</ButtonLink>
        <button type="button" onClick={onRetry} className="text-xs font-medium text-primary hover:underline">
          別のアドレスで送り直す
        </button>
      </div>
    </StatusContent>
  );
}

export function ResetPasswordForm({
  error,
  passwordStrength,
  passwordDefaultValue,
  onPasswordChange,
  submitting,
  onSubmit,
}: {
  /** 新しいパスワードが制約を満たさない理由。ログイン・登録と同じ枠で出す。 */
  error?: string;
  passwordStrength?: PasswordStrength;
  passwordDefaultValue?: string;
  onPasswordChange?: (password: string) => void;
  submitting?: boolean;
  onSubmit?: (password: string) => void;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit?.(String(new FormData(e.currentTarget).get("password") ?? ""));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <AuthHeading title="新しいパスワードを設定" description="設定すると、すべてのデバイスからログアウトされます。" />
      {error && <Alert tone="danger">{error}</Alert>}
      <PasswordField
        label="新しいパスワード"
        name="password"
        autoComplete="new-password"
        strength={passwordStrength}
        defaultValue={passwordDefaultValue}
        onChange={(e) => onPasswordChange?.(e.target.value)}
        required
      />
      <Button type="submit" size="lg" disabled={submitting}>
        パスワードを設定する
      </Button>
    </form>
  );
}

export function ResetPasswordDone({ onLogin }: { onLogin?: () => void }) {
  return (
    <StatusContent
      tone="primary"
      icon={<CheckCircleIcon className="size-5" />}
      title="パスワードを変更しました"
      description="すべてのデバイスからログアウトしました。新しいパスワードでログインしてください。"
    >
      <Button size="lg" onClick={onLogin}>
        ログインする
      </Button>
    </StatusContent>
  );
}

/** 再設定のリンクが期限切れか使用済み。どちらかは区別しない。 */
export function ResetPasswordInvalid({ onRequestAgain, loginHref }: { onRequestAgain?: () => void; loginHref: string }) {
  return (
    <StatusContent
      tone="neutral"
      icon={<AlertIcon className="size-5" />}
      title="このリンクは使えません"
      description="再設定用のリンクは有効期限が切れたか、すでに使われています。もう一度メールを送ってください。"
    >
      <div className="flex flex-col items-center gap-3">
        <Button size="lg" onClick={onRequestAgain}>
          再設定用のメールを送る
        </Button>
        <TextLink href={loginHref} className="text-xs">
          ログインに戻る
        </TextLink>
      </div>
    </StatusContent>
  );
}
