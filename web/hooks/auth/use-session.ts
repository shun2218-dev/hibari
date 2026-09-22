"use client";

import { useContext, useEffect, useState, useSyncExternalStore } from "react";

import type { Session, SessionState } from "@/lib/auth/session";
import { SessionContext } from "@/providers/session-provider";

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
