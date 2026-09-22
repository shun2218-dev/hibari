"use client";

import { type ReactNode, createContext, useState } from "react";

import { getApiBaseUrl } from "@/lib/api/base-url";
import { type Session, createSession } from "@/lib/auth/session";

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
  const [session] = useState(() => injected ?? createSession({ baseUrl: getApiBaseUrl() }));
  return <SessionContext value={session}>{children}</SessionContext>;
}
