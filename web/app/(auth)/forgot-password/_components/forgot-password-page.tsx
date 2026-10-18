"use client";

import { useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm, ForgotPasswordSent } from "@/components/auth/password-reset";
import { useSession } from "@/hooks/auth/use-session";
import { forgotPasswordErrorMessage } from "@/lib/auth/password-reset-error";

/**
 * パスワード再設定のメールを頼む。
 *
 * ログイン状態は見ない（refresh もしない）。ログインしていてもパスワードを忘れて再設定したい場合はあるし、
 * ここで呼ぶ API は Cookie も Access Token も使わない。
 */
export function ForgotPasswordPage() {
  const session = useSession();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(email: string) {
    setSubmitting(true);
    setError(undefined);
    try {
      await session.requestPasswordReset({ email });
      // アカウントがなくても同じ画面にする（サーバーも同じ 202 を返す）。
      setSent(true);
    } catch (err) {
      const message = forgotPasswordErrorMessage(err);
      if (message) setError(message);
      // 通信の失敗や 500 の表示はデザインにない（docs/ui/README.md の「未解決」）。フォームを戻すだけにする。
      else console.error("requesting a password reset failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      {sent ? (
        <ForgotPasswordSent loginHref="/login" onRetry={() => setSent(false)} />
      ) : (
        <ForgotPasswordForm error={error} submitting={submitting} onSubmit={handleSubmit} loginHref="/login" />
      )}
    </AuthShell>
  );
}
