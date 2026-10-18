import { vi } from "vitest";

import { PROBLEM_TYPE_PREFIX, type User } from "@/lib/api/types.gen";

/** テストで API のベース URL として使う値。 */
export const TEST_API_BASE = "http://api.test";

export const testUser: User = {
  id: "01J8ZK3X5R8Q2W4E6T8Y0U2I4O",
  handle: "naoki",
  display_name: "佐藤 直樹",
  email: "naoki@example.com",
  email_verified: false,
  created_at: "2026-09-16T00:00:00Z",
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function problem(status: number, type: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ type: PROBLEM_TYPE_PREFIX + type, title: "x", status }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

export function tokens(accessToken: string, user?: User) {
  return json(200, { ...(user ? { user } : {}), access_token: accessToken, token_type: "Bearer", expires_in: 900 });
}

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** `"METHOD /path"` ごとに応答を決める偽の API。呼ばれた順に記録する。 */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.slice(TEST_API_BASE.length);
    const method = init.method ?? "GET";
    calls.push({ method, path, init });
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`unexpected request: ${method} ${path}`);
    return handler(url, init);
  });
  return { fetch, calls, paths: () => calls.map((c) => `${c.method} ${c.path}`) };
}
