import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";
import { createSession } from "@/lib/auth/session/session";
import { TEST_API_BASE as BASE, fakeApi, problem, testUser as user, tokens as rawTokens } from "@/test/fake-api";

function tokens(accessToken: string, withUser = false) {
  return rawTokens(accessToken, withUser ? user : undefined);
}


describe("登録・ログイン・ログアウト", () => {
  describe("login and register", () => {
    it.each([
      ["login", () => ({ email: user.email, password: "correct-horse" })],
      ["register", () => ({ email: user.email, password: "correct-horse", handle: user.handle, display_name: user.display_name })],
    ] as const)("%s signs in with the returned user", async (method, input) => {
      const api = fakeApi({ [`POST /api/v1/auth/${method}`]: () => tokens("at-1", true) });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      await session[method](input() as never);

      expect(session.getSnapshot()).toEqual({ status: "signed_in", user });
      const init = api.calls[0].init;
      expect(JSON.parse(String(init.body))).toEqual(input());
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      expect(init.credentials).toBe("include");
    });

    it("throws the problem type and Retry-After on failure", async () => {
      const api = fakeApi({ "POST /api/v1/auth/login": () => problem(429, "rate-limited", { "Retry-After": "60" }) });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      const err = await session.login({ email: user.email, password: "x" }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 429, type: "rate-limited", retryAfterSeconds: 60 });
    });
  });

  describe("logout", () => {
    it("revokes the session with the cookie and signs out", async () => {
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });
      const listener = vi.fn();
      session.subscribe(listener);

      await session.logout();

      expect(session.getSnapshot()).toEqual({ status: "signed_out" });
      expect(listener).toHaveBeenCalled();
      expect(api.calls.at(-1)?.init.credentials).toBe("include");
    });

    it("signs out locally even when the server is unreachable", async () => {
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/logout": () => Promise.reject(new TypeError("fetch failed")),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });

      await session.logout();

      expect(session.getSnapshot()).toEqual({ status: "signed_out" });
    });
  });
});
