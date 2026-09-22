import type { WSTicket } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

/**
 * WebSocket の ws-ticket（短命。URL に載せてよい唯一のもの。ADR 0015）。
 */
export function createRealtimeApi(request: Session["request"]) {
  return {
    /** WebSocket の接続に使う ws-ticket（30 秒で失効し、1 回しか使えない。ADR 0007）。 */
    issueTicket: async () => (await request<WSTicket>("POST", "/api/v1/ws/ticket")).ticket,
  };
}
