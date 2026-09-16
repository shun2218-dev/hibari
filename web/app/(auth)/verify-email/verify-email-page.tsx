"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailDone, VerifyEmailInvalid } from "@/components/auth/verify-email";
import { ApiError } from "@/lib/api/error";
import { useSession } from "@/lib/auth/session-provider";

type Step = "verifying" | "done" | "invalid";

/**
 * メールのリンクを開いたら、そのまま確認する。
 *
 * 「確認する」ボタンを挟む画面はデザインにない。先読みのスキャナが開いて消費しても、確認済みになるだけで害はない
 * （届いたメールのリンクを開けたことが、確認の中身そのもの）。
 *
 * トークンのないリンク（`/verify-email`）は、無効なリンクと同じ画面にする。
 * ログインしていないときに再送を押したらログインに回し、戻ってきたこの画面から再送できるようにする。
 */
export function VerifyEmailPage({ token }: { token: string }) {
  const router = useRouter();
  const session = useSession();
  const [step, setStep] = useState<Step>(token ? "verifying" : "invalid");
  const [resending, setResending] = useState(false);
  // トークンは 1 回しか使えない。Strict Mode で effect が 2 回走ると、2 回目が「無効」になって成功の表示を上書きする。
  const verified = useRef<string>(undefined);

  useEffect(() => {
    if (!token || verified.current === token) return;
    verified.current = token;
    session.verifyEmail({ token }).then(
      () => setStep("done"),
      (err: unknown) => {
        if (err instanceof ApiError && err.type === "invalid-one-time-token") setStep("invalid");
        // 通信の失敗の表示はデザインにない（ADR 0024）。何も描かないままにする。
        else console.error("verifying the email failed", err);
      },
    );
  }, [token, session]);

  async function resend() {
    setResending(true);
    try {
      await session.request("POST", "/api/v1/auth/verify-email/request");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?next=${encodeURIComponent("/verify-email")}`);
        return;
      }
      // 再送の結果（成功・回数制限）の表示はデザインにない（docs/ui/README.md の「未解決」）。
      console.error("resending the verification email failed", err);
    } finally {
      setResending(false);
    }
  }

  if (step === "verifying") return null;
  return (
    <AuthShell>
      {step === "done" ? (
        <VerifyEmailDone onOpen={() => router.push("/")} />
      ) : (
        <VerifyEmailInvalid resending={resending} onResend={resend} />
      )}
    </AuthShell>
  );
}
