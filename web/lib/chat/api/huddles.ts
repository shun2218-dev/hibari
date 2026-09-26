import type {
  Features,
  HuddleICEServers,
  JoinedHuddle,
  JoinHuddleRequest,
  SessionDescription,
  SubscribedHuddle,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/auth-session";

/**
 * 音声のハドル（ADR 0066 決定 4）。入った後の操作は、参加 ID（この端末のこの参加）のパスの下に置く。
 * SDP は Go のサーバーを通して Cloudflare に渡り、音声そのものはブラウザと Cloudflare の間を直接流れる（決定 2）。
 */
export function createHuddleApi(request: Session["request"]) {
  const participant = (huddleId: string, participantId: string) =>
    `/api/v1/huddles/${encodeURIComponent(huddleId)}/participants/${encodeURIComponent(participantId)}`;
  return {
    /** サーバーの設定で使えるかが変わる機能（ハドルは Cloudflare の設定がなければ使えない。決定 15）。 */
    features: () => request<Features>("GET", "/api/v1/features"),

    /** RTCPeerConnection を作る前に取る。TURN の認証情報は 12 時間で切れる（決定 14）。 */
    huddleIceServers: (roomId: string) =>
      request<HuddleICEServers>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/huddle/ice-servers`),

    /** 入る（進行中のハドルがなければ始める）。offer を渡して answer を受け取る。 */
    joinHuddle: (roomId: string, body: JoinHuddleRequest) =>
      request<JoinedHuddle>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/huddle/participants`, body),

    /** 同じハドルにいる人の音声を受ける（決定 9）。offer が返ったら answer を renegotiateHuddle で返す。 */
    subscribeHuddle: (huddleId: string, participantId: string, userIds: string[]) =>
      request<SubscribedHuddle>("POST", `${participant(huddleId, participantId)}/subscriptions`, { user_ids: userIds }),

    renegotiateHuddle: (huddleId: string, participantId: string, answer: SessionDescription) =>
      request<void>("PUT", `${participant(huddleId, participantId)}/renegotiate`, { answer }),

    /** 抜けた人の分の受けるトラックを閉じる。 */
    unsubscribeHuddle: (huddleId: string, participantId: string, mids: string[]) =>
      request<void>("POST", `${participant(huddleId, participantId)}/subscriptions/close`, { mids }),

    /** ミュートの印（決定 10）。音を止めるのはブラウザで、これはほかの人の画面の印のため。 */
    setHuddleMuted: (huddleId: string, participantId: string, muted: boolean) =>
      request<void>("PATCH", participant(huddleId, participantId), { muted }),

    /** 抜ける。keepalive はタブを閉じるときに使う（ページが消えても届くように。決定 4）。 */
    leaveHuddle: (huddleId: string, participantId: string, options: { keepalive?: boolean } = {}) =>
      request<void>("DELETE", participant(huddleId, participantId), undefined, options),

    /** DM の呼び出しの「もうすぐ参加する」（決定 11）。 */
    huddleJoiningSoon: (huddleId: string) =>
      request<void>("POST", `/api/v1/huddles/${encodeURIComponent(huddleId)}/joining-soon`),
  };
}
