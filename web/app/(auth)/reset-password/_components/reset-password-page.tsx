"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordDone, ResetPasswordForm, ResetPasswordInvalid } from "@/components/auth/password-reset";
import { useSession } from "@/hooks/auth/use-session";
import { ApiError } from "@/lib/api/error";
import { resetPasswordErrorMessage } from "@/lib/auth/password-reset-error";
import { passwordStrength } from "@/lib/auth/password-strength";

type Step = "form" | "done" | "invalid";

/**
 * 新しいパスワードを設定する。
 *
 * トークンが使えるかを先に確かめる API はないので、フォームを出しておき、送信した結果で「使えない」を出す。
 * 開いただけでトークンを消費しないようにもなる（メールのリンクを先読みするスキャナで使えなくならない）。
 */
export function ResetPasswordPage({ token }: { token: string }) {
  const router = useRouter();
  const session = useSession();
  const [step, setStep] = useState<Step>(token ? "form" : "invalid");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(newPassword: string) {
    setSubmitting(true);
    setError(undefined);
    try {
      await session.resetPassword({ token, password: newPassword });
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && err.type === "invalid-one-time-token") {
        setStep("invalid");
        return;
      }
      // パスワードが制約を満たさない（422）ときは、トークンは消費されていないので、同じリンクのまま入力し直せる。
      const message = resetPasswordErrorMessage(err);
      if (message) setError(message);
      // 通信の失敗や 500 の表示はデザインにない（docs/ui/README.md の「未解決」）。
      else console.error("resetting the password failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      {step === "form" && (
        <ResetPasswordForm
          error={error}
          passwordStrength={passwordStrength(password)}
          onPasswordChange={setPassword}
          submitting={submitting}
          onSubmit={handleSubmit}
        />
      )}
      {step === "done" && <ResetPasswordDone onLogin={() => router.replace("/login")} />}
      {step === "invalid" && <ResetPasswordInvalid onRequestAgain={() => router.push("/forgot-password")} loginHref="/login" />}
    </AuthShell>
  );
}
