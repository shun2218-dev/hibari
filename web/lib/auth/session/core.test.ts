import { describe, expect, it, vi } from "vitest";
import { createSession } from "@/lib/auth/session/session";
import { type Handler, TEST_API_BASE as BASE, fakeApi, json, problem, testUser as user, tokens as rawTokens } from "@/test/fake-api";

function tokens(accessToken: string, withUser = false) {
  return rawTokens(accessToken, withUser ? user : undefined);
}

function authorization(init: RequestInit) {
  return new Headers(init.headers).get("Authorization");
}

describe("セッションの土台（Access Token と refresh）", () => {
  describe("restore", () => {
    it("signs in from the refresh cookie and loads the user", async () => {
      const api = fakeApi({
        "POST /api/v1/auth/refresh": () => tokens("at-1"),
        "GET /api/v1/users/me": (_url, init) => (authorization(init) === "Bearer at-1" ? json(200, user) : problem(401, "unauthenticated")),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      expect(session.getSnapshot()).toEqual({ status: "loading" });
      await session.restore();

      expect(session.getSnapshot()).toEqual({ status: "signed_in", user });
      // Cookie 方式にする（ADR 0010）。別オリジンなので credentials も要る
      const refresh = api.calls[0].init;
      expect(new Headers(refresh.headers).get("X-Hibari-Client")).toBe("web");
      expect(refresh.credentials).toBe("include");
    });

    it("signs out when there is no usable refresh token", async () => {
      const api = fakeApi({ "POST /api/v1/auth/refresh": () => problem(401, "invalid-refresh-token") });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      await session.restore();

      expect(session.getSnapshot()).toEqual({ status: "signed_out" });
    });

    it("stays loading and can be retried when the server is unreachable", async () => {
      const refresh = vi.fn<Handler>().mockRejectedValueOnce(new TypeError("fetch failed")).mockReturnValue(tokens("at-1"));
      const api = fakeApi({ "POST /api/v1/auth/refresh": refresh, "GET /api/v1/users/me": () => json(200, user) });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      await expect(session.restore()).rejects.toThrow("fetch failed");
      // ネットワークの失敗をログアウトと取り違えない
      expect(session.getSnapshot()).toEqual({ status: "loading" });

      await session.restore();
      expect(session.getSnapshot()).toEqual({ status: "signed_in", user });
    });

    it("refreshes only once however many times it is called", async () => {
      const api = fakeApi({ "POST /api/v1/auth/refresh": () => tokens("at-1"), "GET /api/v1/users/me": () => json(200, user) });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      await Promise.all([session.restore(), session.restore()]);
      await session.restore();

      expect(api.paths()).toEqual(["POST /api/v1/auth/refresh", "GET /api/v1/users/me"]);
    });
  });

  describe("request", () => {
    async function signedIn(routes: Record<string, Handler>, now = () => 0) {
      const api = fakeApi({ "POST /api/v1/auth/login": () => tokens("at-1", true), ...routes });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch, now });
      await session.login({ email: user.email, password: "correct-horse" });
      api.calls.length = 0;
      return { api, session };
    }

    it("sends the access token and parses the JSON", async () => {
      const { api, session } = await signedIn({
        "GET /api/v1/workspaces": (_url, init) => json(200, { workspaces: [], auth: authorization(init) }),
      });

      await expect(session.request("GET", "/api/v1/workspaces")).resolves.toEqual({ workspaces: [], auth: "Bearer at-1" });
      expect(api.paths()).toEqual(["GET /api/v1/workspaces"]);
    });

    it("returns undefined for a success without a body", async () => {
      const { session } = await signedIn({
        "POST /api/v1/auth/verify-email/request": () => new Response(null, { status: 202 }),
      });

      await expect(session.request("POST", "/api/v1/auth/verify-email/request")).resolves.toBeUndefined();
    });

    it("refreshes before the access token expires", async () => {
      let clock = 0;
      const { api, session } = await signedIn(
        {
          "POST /api/v1/auth/refresh": () => tokens("at-2"),
          "GET /api/v1/workspaces": (_url, init) => json(200, { auth: authorization(init) }),
        },
        () => clock,
      );

      // 15 分の期限の 30 秒前を切ったら、401 を待たずに取り直す
      clock = 900_000 - 29_000;
      await expect(session.request("GET", "/api/v1/workspaces")).resolves.toEqual({ auth: "Bearer at-2" });
      expect(api.paths()).toEqual(["POST /api/v1/auth/refresh", "GET /api/v1/workspaces"]);
    });

    it("refreshes once and retries when concurrent requests get 401", async () => {
      // 期限の前に失効した（別の端末でパスワードを再設定したなど）
      const { api, session } = await signedIn({
        "POST /api/v1/auth/refresh": () => tokens("at-2"),
        "GET /api/v1/workspaces": (_url, init) =>
          authorization(init) === "Bearer at-2" ? json(200, { ok: true }) : problem(401, "unauthenticated"),
      });

      const results = await Promise.all([1, 2, 3].map(() => session.request("GET", "/api/v1/workspaces")));

      expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
      expect(api.paths().filter((p) => p === "POST /api/v1/auth/refresh")).toHaveLength(1);
    });

    it("does not refresh again when a 401 arrives after another request already refreshed", async () => {
      let releaseSlow!: () => void;
      const slowGate = new Promise<void>((resolve) => (releaseSlow = resolve));
      const { api, session } = await signedIn({
        "POST /api/v1/auth/refresh": () => tokens("at-2"),
        "GET /api/v1/fast": (_url, init) => (authorization(init) === "Bearer at-2" ? json(200, "fast") : problem(401, "unauthenticated")),
        "GET /api/v1/slow": async (_url, init) => {
          if (authorization(init) === "Bearer at-2") return json(200, "slow");
          await slowGate;
          return problem(401, "unauthenticated");
        },
      });

      const slow = session.request("GET", "/api/v1/slow");
      await session.request("GET", "/api/v1/fast");
      releaseSlow();

      await expect(slow).resolves.toBe("slow");
      expect(api.paths().filter((p) => p === "POST /api/v1/auth/refresh")).toHaveLength(1);
    });

    it("signs out when the refresh token is no longer valid", async () => {
      const { session } = await signedIn({
        "POST /api/v1/auth/refresh": () => problem(401, "invalid-refresh-token"),
        "GET /api/v1/workspaces": () => problem(401, "unauthenticated"),
      });

      await expect(session.request("GET", "/api/v1/workspaces")).rejects.toMatchObject({ status: 401 });
      expect(session.getSnapshot()).toEqual({ status: "signed_out" });
    });

    it("throws ApiError for other failures without signing out", async () => {
      const { session } = await signedIn({ "GET /api/v1/workspaces/x": () => problem(404, "not-found") });

      await expect(session.request("GET", "/api/v1/workspaces/x")).rejects.toMatchObject({ status: 404, type: "not-found" });
      expect(session.getSnapshot().status).toBe("signed_in");
    });
  });

  describe("revalidate", () => {
    it("refreshes even while the access token is still valid", async () => {
      let n = 0;
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/refresh": () => tokens(`at-refreshed-${++n}`),
        "GET /api/v1/users/me": (_url, init) => json(200, { ...user, display_name: authorization(init)! }),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });

      await expect(session.revalidate()).resolves.toBe(true);

      expect(api.paths()).toEqual(["POST /api/v1/auth/login", "POST /api/v1/auth/refresh"]);
      await expect(session.request("GET", "/api/v1/users/me")).resolves.toMatchObject({
        display_name: "Bearer at-refreshed-1",
      });
    });

    it("signs out and returns false when the session was revoked", async () => {
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/refresh": () => problem(401, "invalid-refresh-token"),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });

      await expect(session.revalidate()).resolves.toBe(false);

      expect(session.getSnapshot()).toEqual({ status: "signed_out" });
    });

    it("throws without signing out when the server is unreachable", async () => {
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/refresh": () => Promise.reject(new TypeError("fetch failed")),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });

      await expect(session.revalidate()).rejects.toBeInstanceOf(TypeError);

      expect(session.getSnapshot().status).toBe("signed_in");
    });
  });
});
