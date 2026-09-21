"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmailPending } from "@/components/auth/verify-email";
import { useSession } from "@/lib/auth/session-provider";

/**
 * email を検証するまで chat を使えない間に、アプリの画面の代わりに出す（ADR 0053 決定 3）。
 *
 * 再送した確認メールのリンクには、いま開いている画面を戻り先として載せる。招待のリンク（`/j/{code}`）から来た人は、
 * 検証のあとに受け入れの画面に戻る。別のタブや端末で検証を済ませたときのために、このタブに戻ってきたら確かめ直す。
 */
export function UnverifiedEmail({ email }: { email: string }) {
  const session = useSession();
  const pathname = usePathname();
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      session.recheckEmailVerification().catch((err: unknown) => {
        // 確かめられなくても確認待ちのまま。次に戻ってきたときにまた確かめる。
        console.error("rechecking the email verification failed", err);
      });
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [session]);

  async function resend() {
    setResending(true);
    const next = pathname + window.location.search;
    try {
      await session.requestEmailVerification(next === "/" ? {} : { next });
    } catch (err) {
      // 再送の結果（成功・回数制限）の表示はデザインにない（docs/ui/README.md の「未解決」）。
      console.error("resending the verification email failed", err);
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell>
      {/* メールアドレスを変える API がないので、「別のアドレスに変更する」は出さない（onChangeEmail を渡さない） */}
      <VerifyEmailPending email={email} resending={resending} onResend={resend} onLogout={() => void session.logout()} />
    </AuthShell>
  );
}
