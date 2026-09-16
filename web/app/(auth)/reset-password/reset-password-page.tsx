"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordDone, ResetPasswordForm, ResetPasswordInvalid } from "@/components/auth/password-reset";
import { ApiError } from "@/lib/api/error";
import { passwordStrength } from "@/lib/auth/password-strength";
import { useSession } from "@/lib/auth/session-provider";

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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(newPassword: string) {
    setSubmitting(true);
    try {
      await session.resetPassword({ token, password: newPassword });
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && err.type === "invalid-one-time-token") setStep("invalid");
      // パスワードが制約を満たさない（422）ときの表示はデザインにない（docs/ui/README.md の「未解決」）。
      // トークンは消費されていないので、フォームを戻して入力し直せるようにする。
      else console.error("resetting the password failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      {step === "form" && (
        <ResetPasswordForm
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
