"use client";

import { type ReactNode, createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { getApiBaseUrl } from "@/lib/api-base-url";

import { type Session, type SessionState, createSession } from "./session";

const SessionContext = createContext<Session | null>(null);

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

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}

/**
 * 認証の状態を購読し、まだなら Cookie からログイン状態を戻す。
 * `unreachable` は、戻すための通信が失敗した（サーバーに届かない）ことを表す。
 */
export function useSessionState(): { state: SessionState; unreachable: boolean } {
  const session = useSession();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    // 何度呼んでも refresh は 1 回（Strict Mode で effect が 2 回走っても同じ）。
    session.restore().then(
      () => setUnreachable(false),
      () => setUnreachable(true),
    );
  }, [session]);

  return { state, unreachable };
}
