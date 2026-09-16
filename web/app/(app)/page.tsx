"use client";

import { Button } from "@/components/ui/button";
import { useSession, useSessionState } from "@/lib/auth/session-provider";

/**
 * 仮のトップページ。ログインしてログアウトできることだけを確かめる。
 *
 * ワークスペースの画面への振り分けと、ワークスペースが 0 件のときの表示は、
 * 本番のページの構築順 2（ロードマップ Phase 6-2）で、デザインを足してから作る。
 * Phase 1 の骨組み（API の疎通を出すだけのページ）と同じく、docs/ui の画面ではない。
 */
export default function HomePage() {
  const session = useSession();
  const { state } = useSessionState();
  // レイアウトがログイン済みのときだけ描く。
  if (state.status !== "signed_in") return null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <p className="text-2xl font-bold tracking-tight text-text">hibari</p>
      <p className="text-sm text-text-secondary">
        {state.user.display_name}（<span className="font-mono">@{state.user.handle}</span>）でログインしています
      </p>
      <Button variant="secondary" size="md" onClick={() => session.logout()}>
        ログアウト
      </Button>
    </main>
  );
}
