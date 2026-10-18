"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useSessionState } from "@/hooks/auth/use-session";
import { ChatProvider } from "@/providers/chat-provider";

import { UnverifiedEmail } from "@/app/(app)/_components/unverified-email";

/**
 * ログインが必要な画面の振り分け。
 *
 * Refresh Token の Cookie は API のオリジンの `Path=/api/v1/auth` にしか付かず、Next.js のサーバーからは見えない。
 * なので proxy（旧 middleware）やサーバーコンポーネントでは判定できず、ブラウザで refresh した結果で振り分ける。
 * ここは表示の振り分けにすぎず、守るのは API の認可（CLAUDE.md ルール 9）。
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { state } = useSessionState();

  useEffect(() => {
    if (state.status !== "signed_out") return;
    const back = pathname + window.location.search;
    router.replace(back === "/" ? "/login" : `/login?next=${encodeURIComponent(back)}`);
  }, [state.status, pathname, router]);

  // サーバーに届かないときの画面はデザインにない（chat/connection/server-error.png は接続後の切断用）。いまは何も出さない。
  if (state.status !== "signed_in") return null;
  // chat の API に email-unverified で止められたら、チャットの画面ごと外して確認待ちにする（ADR 0053 決定 3）。
  // ChatProvider を外すので WebSocket も閉じる。検証が済むと作り直す。
  if (state.emailUnverified) return <UnverifiedEmail email={state.user.email} />;
  // user の id を key にして、別の人がログインし直したらチャットの状態を作り直す（前の人のデータを見せない）
  return (
    <ChatProvider key={state.user.id} userId={state.user.id}>
      {children}
    </ChatProvider>
  );
}
