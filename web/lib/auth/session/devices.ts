import type { RevokeSessionsResponse, SessionList } from "@/lib/api/types.gen";

import type { SessionCore } from "./core";

/**
 * ログイン中のデバイス（セッション）の一覧と失効（ADR 0031）。
 */
export function createDevices(core: SessionCore) {
  const { request } = core;

  return {
    /** ログイン中のセッション（= 端末）の一覧。last_used_at の新しい順（ADR 0019）。 */
    listSessions(): Promise<SessionList> {
      return request<SessionList>("GET", "/api/v1/auth/sessions");
    },

    /** セッションを 1 つ失効させる。他人のものやすでに失効したものは 404。 */
    revokeSession(sessionId: string): Promise<void> {
      return request<void>("DELETE", `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`);
    },

    /** いま使っているセッション以外をすべて失効させる。 */
    revokeOtherSessions(): Promise<RevokeSessionsResponse> {
      return request<RevokeSessionsResponse>("DELETE", "/api/v1/auth/sessions");
    },
  };
}

export type Devices = ReturnType<typeof createDevices>;
