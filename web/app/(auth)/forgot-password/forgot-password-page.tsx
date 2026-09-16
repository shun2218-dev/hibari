"use client";

import { useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm, ForgotPasswordSent } from "@/components/auth/password-reset";
import { useSession } from "@/lib/auth/session-provider";

/**
 * パスワード再設定のメールを頼む。
 *
 * ログイン状態は見ない（refresh もしない）。ログインしていてもパスワードを忘れて再設定したい場合はあるし、
 * ここで呼ぶ API は Cookie も Access Token も使わない。
 */
export function ForgotPasswordPage() {
  const session = useSession();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(email: string) {
    setSubmitting(true);
    try {
      await session.requestPasswordReset({ email });
      // アカウントがなくても同じ画面にする（サーバーも同じ 202 を返す）。
      setSent(true);
    } catch (err) {
      // 回数制限（429）や通信の失敗の表示はデザインにない（docs/ui/README.md の「未解決」）。フォームを戻すだけにする。
      console.error("requesting a password reset failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      {sent ? (
        <ForgotPasswordSent loginHref="/login" onRetry={() => setSent(false)} />
      ) : (
        <ForgotPasswordForm submitting={submitting} onSubmit={handleSubmit} loginHref="/login" />
      )}
    </AuthShell>
  );
}
