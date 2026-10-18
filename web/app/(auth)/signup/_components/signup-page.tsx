"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { type SignupValues, SignupForm } from "@/components/auth/signup-form";
import { VerifyEmailPending } from "@/components/auth/verify-email";
import { useSession, useSessionState } from "@/hooks/auth/use-session";
import { passwordStrength } from "@/lib/auth/password-strength";
import { signupErrorMessage } from "@/lib/auth/signup-error";

/**
 * `next` は page.tsx で同じオリジンのパスに絞ってある（招待リンクから来た人の戻り先）。
 * 確認メールのリンクにも載せ、検証のあとにそこへ戻す（ADR 0053 決定 3）。
 */
export function SignupPage({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const session = useSession();
  const { state, unreachable } = useSessionState();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string>();
  const [resending, setResending] = useState(false);
  // 登録するとログイン状態になる。登録した直後は確認待ちの画面を出したいので、下の振り分けを止める。
  const registering = useRef(false);

  useEffect(() => {
    if (state.status === "signed_in" && !registering.current) router.replace(next);
  }, [state.status, next, router]);

  if (registeredEmail) {
    return (
      <AuthShell>
        {/* メールアドレスを変える API がないので、「別のアドレスに変更する」は出さない（onChangeEmail を渡さない） */}
        <VerifyEmailPending email={registeredEmail} resending={resending} onResend={resend} onLogout={logout} />
      </AuthShell>
    );
  }

  if (state.status === "signed_in" || (state.status === "loading" && !unreachable)) return null;

  async function handleSubmit(values: SignupValues) {
    setSubmitting(true);
    setError(undefined);
    registering.current = true;
    try {
      await session.register({
        handle: values.handle,
        display_name: values.displayName,
        email: values.email,
        password: values.password,
        ...nextParam(),
      });
      setRegisteredEmail(values.email);
    } catch (err) {
      registering.current = false;
      const message = signupErrorMessage(err);
      if (message) setError(message);
      // 通信の失敗や 500 の表示はデザインにない（docs/ui に足すまでは、フォームを戻すだけにする）。
      else console.error("signup failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    setResending(true);
    try {
      await session.requestEmailVerification(nextParam());
    } catch (err) {
      // 再送の結果（成功・回数制限）の表示もデザインにない。
      console.error("resending the verification email failed", err);
    } finally {
      setResending(false);
    }
  }

  /** 戻り先が既定（`/`）なら載せない。検証のあとは既定でも `/` に進む。 */
  function nextParam(): { next?: string } {
    return next === "/" ? {} : { next };
  }

  async function logout() {
    await session.logout();
    // 確認待ちの画面を閉じて、登録のフォームに戻す。
    registering.current = false;
    setRegisteredEmail(undefined);
  }

  return (
    <AuthShell>
      <SignupForm
        error={error}
        passwordStrength={passwordStrength(password)}
        onPasswordChange={setPassword}
        submitting={submitting}
        onSubmit={handleSubmit}
        loginHref="/login"
      />
    </AuthShell>
  );
}
