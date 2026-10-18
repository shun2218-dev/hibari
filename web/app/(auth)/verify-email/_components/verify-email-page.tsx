"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailChecking, VerifyEmailDone, VerifyEmailInvalid } from "@/components/auth/verify-email";
import { useSession } from "@/hooks/auth/use-session";
import { ApiError } from "@/lib/api/error";

type Step = "verifying" | "done" | "invalid";

/**
 * メールのリンクを開いたら、そのまま確認する。
 *
 * 「確認する」ボタンを挟む画面はデザインにない。先読みのスキャナが開いて消費しても、確認済みになるだけで害はない
 * （届いたメールのリンクを開けたことが、確認の中身そのもの）。
 *
 * トークンのないリンク（`/verify-email`）は、無効なリンクと同じ画面にする。
 * ログインしていないときに再送を押したらログインに回し、戻ってきたこの画面から再送できるようにする。
 *
 * `next` は検証のあとに進む先（招待の画面など。ADR 0053 決定 3）。page.tsx で同じオリジンのパスに絞ってある。
 * 再送するときもリンクに載せ直す。
 */
export function VerifyEmailPage({ token, next = "/" }: { token: string; next?: string }) {
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
        // 通信の失敗の表示はデザインにない（docs/ui/README.md の「未解決」）。確認中の表示のままにする。
        else console.error("verifying the email failed", err);
      },
    );
  }, [token, session]);

  async function resend() {
    setResending(true);
    try {
      await session.requestEmailVerification(next === "/" ? {} : { next });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const back = next === "/" ? "/verify-email" : `/verify-email?next=${encodeURIComponent(next)}`;
        router.push(`/login?next=${encodeURIComponent(back)}`);
        return;
      }
      // 再送の結果（成功・回数制限）の表示はデザインにない（docs/ui/README.md の「未解決」）。
      console.error("resending the verification email failed", err);
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell>
      {step === "verifying" && <VerifyEmailChecking />}
      {step === "done" && <VerifyEmailDone onOpen={() => router.push(next)} />}
      {step === "invalid" && <VerifyEmailInvalid resending={resending} onResend={resend} />}
    </AuthShell>
  );
}
