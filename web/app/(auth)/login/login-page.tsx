"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { type LoginError, type LoginValues, LoginForm } from "@/components/auth/login-form";
import { ApiError } from "@/lib/api/error";
import { useSession, useSessionState } from "@/lib/auth/session-provider";

function loginError(err: unknown): LoginError | undefined {
  if (!(err instanceof ApiError)) return undefined;
  if (err.type === "rate-limited") return "rate_limited";
  // 空の入力もサーバーは invalid-credentials にする。どちらが違うか、アカウントがあるかは出さない
  if (err.type === "invalid-credentials") return "credentials";
  return undefined;
}

/** `next` は page.tsx で同じオリジンのパスに絞ってある。 */
export function LoginPage({ next }: { next: string }) {
  const router = useRouter();
  const session = useSession();
  const { state, unreachable } = useSessionState();
  const [error, setError] = useState<LoginError>();
  const [submitting, setSubmitting] = useState(false);

  // ログインした直後も、ログイン済みで開いたときも、ここで戻り先に進む。
  useEffect(() => {
    if (state.status === "signed_in") router.replace(next);
  }, [state.status, next, router]);

  // ログイン済みかどうかが分かるまでフォームを出さない（ログイン済みの人にフォームが一瞬見えないように）。
  // サーバーに届かないときは、ログインを試せるようにフォームを出す。
  if (state.status === "signed_in" || (state.status === "loading" && !unreachable)) return null;

  async function handleSubmit(values: LoginValues) {
    setSubmitting(true);
    setError(undefined);
    try {
      await session.login(values);
    } catch (err) {
      const reason = loginError(err);
      if (reason) setError(reason);
      // 通信の失敗や 500 の表示はデザインにない（docs/ui に足すまでは、フォームを戻すだけにする）。
      else console.error("login failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <LoginForm
        error={error}
        submitting={submitting}
        onSubmit={handleSubmit}
        forgotPasswordHref="/forgot-password"
        // 招待リンクを持っていてアカウントがない人が、登録してから招待に戻れるように next を引き継ぐ
        signupHref={next === "/" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`}
      />
    </AuthShell>
  );
}
