"use client";

import { useEffect, useMemo, useState } from "react";

import { DevicesSettings } from "@/components/settings/devices-settings";
import { useSession } from "@/hooks/auth/use-session";
import type { Session } from "@/lib/api/types.gen";
import { toDeviceView } from "@/lib/auth/devices";

/**
 * ログイン中のデバイス（セッション）の一覧と失効（ADR 0019）。
 *
 * 失効した瞬間に切れるのは WebSocket だけで、相手の Access Token は最長 15 分残る。
 * その説明はコンポーネント側の文言にある。
 */
export function DevicesSection() {
  const session = useSession();
  const [sessions, setSessions] = useState<Session[]>();
  // 失効に失敗したとき（すでに失効していた、など）に取り直すための世代
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    session.listSessions().then(
      (list) => {
        if (!cancelled) setSessions(list.sessions);
      },
      (err) => {
        // 取得の失敗の画面はデザインにない（docs/ui/README.md の未解決）。何も描かずにコンソールへ出す
        if (!cancelled) console.error("failed to list the sessions", err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session, generation]);

  // 「2分前」は開いた時点の時刻で決める。開いたまま時間が経っても勝手に書き換えない
  const openedAt = useMemo(() => new Date(), []);
  const devices = useMemo(() => (sessions ?? []).map((s) => toDeviceView(s, openedAt)), [sessions, openedAt]);

  if (!sessions) return null;

  async function logout(sessionId: string) {
    try {
      await session.revokeSession(sessionId);
      setSessions((current) => current?.filter((s) => s.id !== sessionId));
    } catch (err) {
      // すでに失効していれば 404。一覧を取り直すと消える
      console.error("failed to revoke the session", err);
      setGeneration((n) => n + 1);
    }
  }

  async function logoutOthers() {
    try {
      await session.revokeOtherSessions();
      setSessions((current) => current?.filter((s) => s.current));
    } catch (err) {
      console.error("failed to revoke the other sessions", err);
      setGeneration((n) => n + 1);
    }
  }

  return <DevicesSettings devices={devices} onLogout={logout} onLogoutOthers={logoutOthers} />;
}
