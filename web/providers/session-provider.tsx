"use client";

import { type ReactNode, createContext, useState } from "react";

import { getApiBaseUrl } from "@/lib/api/base-url";
import { createSession, type Session } from "@/lib/auth/session/auth-session";
import { forgetBrowserPush } from "@/lib/chat/notifications/web-push";

/** 値を読むフックは hooks/auth/use-session.ts に置く（ADR 0060）。 */
export const SessionContext = createContext<Session | null>(null);

/**
 * 認証の状態をアプリ全体で 1 つにする。
 *
 * ルートのレイアウトに置く。ルートグループ（`(auth)` と `(app)`）のレイアウトに置くと、
 * ログインの画面からアプリに移ったときにレイアウトごと作り直され、メモリにだけある Access Token を失う。
 * モジュールの変数（シングルトン）にしないのは、テストで偽の API を注入するため。
 */
export function SessionProvider({ children, session: injected }: { children: ReactNode; session?: Session }) {
  const [session] = useState(
    () =>
      injected ??
      createSession({
        baseUrl: getApiBaseUrl(),
        // ログアウトしたブラウザに、次にログインした人の通知が勝手に届き始めないよう、購読を外す（ADR 0069 決定 3）
        beforeLogout: () => forgetBrowserPush("serviceWorker" in navigator ? navigator.serviceWorker : undefined),
      }),
  );
  return <SessionContext value={session}>{children}</SessionContext>;
}
