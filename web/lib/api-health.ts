/**
 * API の /healthz の結果。
 * - ok: API とその依存先（Postgres / Redis）がすべて使える
 * - unavailable: API には届いたが、依存先のどれかが使えない（503）
 * - unreachable: API に届かない（起動していない、URL が違う、タイムアウト）
 */
export type ApiHealth = "ok" | "unavailable" | "unreachable";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchApiHealth(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
  timeoutMs = 2000,
): Promise<ApiHealth> {
  try {
    const res = await fetchImpl(`${baseUrl}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? "ok" : "unavailable";
  } catch {
    return "unreachable";
  }
}
