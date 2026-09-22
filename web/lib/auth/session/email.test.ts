import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/error";
import { createSession } from "@/lib/auth/session/auth-session";
import { type Handler, TEST_API_BASE as BASE, fakeApi, json, problem, testUser as user, tokens as rawTokens } from "@/test/fake-api";

function tokens(accessToken: string, withUser = false) {
  return rawTokens(accessToken, withUser ? user : undefined);
}

function authorization(init: RequestInit) {
  return new Headers(init.headers).get("Authorization");
}

describe("メールの確認とパスワードの再設定（ADR 0053）", () => {
  describe("email verification required (ADR 0053)", () => {
    async function signedIn(routes: Record<string, Handler>) {
      const api = fakeApi({ "POST /api/v1/auth/login": () => tokens("at-1", true), ...routes });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });
      api.calls.length = 0;
      return { api, session };
    }

    it("refreshes once and marks the session as unverified when chat still refuses", async () => {
      const { api, session } = await signedIn({
        "POST /api/v1/auth/refresh": () => tokens("at-2"),
        "GET /api/v1/workspaces": () => problem(403, "email-unverified"),
      });

      await expect(session.request("GET", "/api/v1/workspaces")).rejects.toMatchObject({ status: 403, type: "email-unverified" });

      expect(api.paths()).toEqual(["GET /api/v1/workspaces", "POST /api/v1/auth/refresh", "GET /api/v1/workspaces"]);
      expect(session.getSnapshot()).toEqual({ status: "signed_in", user, emailUnverified: true });
    });

    it("passes when the email was verified in another tab and the token was only stale", async () => {
      const { session } = await signedIn({
        "POST /api/v1/auth/refresh": () => tokens("at-2"),
        "GET /api/v1/workspaces": (_url, init) =>
          authorization(init) === "Bearer at-2" ? json(200, { ok: true }) : problem(403, "email-unverified"),
      });

      await expect(session.request("GET", "/api/v1/workspaces")).resolves.toEqual({ ok: true });
      expect(session.getSnapshot()).toEqual({ status: "signed_in", user });
    });

    it("does not refresh again for requests refused after the session is marked", async () => {
      const { api, session } = await signedIn({
        "POST /api/v1/auth/refresh": () => tokens("at-2"),
        "GET /api/v1/workspaces": () => problem(403, "email-unverified"),
      });
      await expect(session.request("GET", "/api/v1/workspaces")).rejects.toBeInstanceOf(ApiError);
      api.calls.length = 0;

      await expect(session.request("GET", "/api/v1/workspaces")).rejects.toBeInstanceOf(ApiError);
      expect(api.paths()).toEqual(["GET /api/v1/workspaces"]);
    });

    it("treats other 403s as plain errors", async () => {
      const { api, session } = await signedIn({ "GET /api/v1/rooms/x": () => problem(403, "forbidden") });

      await expect(session.request("GET", "/api/v1/rooms/x")).rejects.toMatchObject({ status: 403, type: "forbidden" });
      expect(api.paths()).toEqual(["GET /api/v1/rooms/x"]);
      expect(session.getSnapshot()).toEqual({ status: "signed_in", user });
    });

    it("sends next with the resend request only when given", async () => {
      const bodies: (BodyInit | null | undefined)[] = [];
      const { session } = await signedIn({
        "POST /api/v1/auth/verify-email/request": (_url, init) => {
          bodies.push(init.body);
          return new Response(null, { status: 202 });
        },
      });

      await session.requestEmailVerification();
      await session.requestEmailVerification({ next: "/j/abc" });

      expect(bodies).toEqual([undefined, JSON.stringify({ next: "/j/abc" })]);
    });

    it("lifts the block on recheck once the email is verified", async () => {
      let verified = false;
      const { session } = await signedIn({
        "POST /api/v1/auth/refresh": () => tokens("at-2"),
        "GET /api/v1/workspaces": () => problem(403, "email-unverified"),
        "GET /api/v1/users/me": () => json(200, { ...user, email_verified: verified }),
      });
      await expect(session.request("GET", "/api/v1/workspaces")).rejects.toBeInstanceOf(ApiError);

      await session.recheckEmailVerification();
      expect(session.getSnapshot()).toEqual({ status: "signed_in", user, emailUnverified: true });

      verified = true;
      await session.recheckEmailVerification();
      expect(session.getSnapshot()).toEqual({ status: "signed_in", user: { ...user, email_verified: true } });
    });
  });

  describe("password reset and email verification", () => {
    const noContent = () => new Response(null, { status: 204 });

    it.each([
      ["requestPasswordReset", "password-reset/request", { email: user.email }],
      ["resetPassword", "password-reset/confirm", { token: "tok", password: "correct-horse" }],
      ["verifyEmail", "verify-email/confirm", { token: "tok" }],
    ] as const)("%s works without the refresh cookie or an access token", async (method, path, input) => {
      const api = fakeApi({ [`POST /api/v1/auth/${path}`]: () => new Response(null, { status: 202 }) });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      await session[method](input as never);

      // メールのリンクは、ログインしていないブラウザで開かれることもある
      expect(api.paths()).toEqual([`POST /api/v1/auth/${path}`]);
      const init = api.calls[0].init;
      expect(JSON.parse(String(init.body))).toEqual(input);
      expect(init.credentials).toBeUndefined();
      expect(authorization(init)).toBeNull();
    });

    it("throws the problem type when the link is unusable", async () => {
      const api = fakeApi({ "POST /api/v1/auth/password-reset/confirm": () => problem(400, "invalid-one-time-token") });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      await expect(session.resetPassword({ token: "used", password: "correct-horse" })).rejects.toMatchObject({
        status: 400,
        type: "invalid-one-time-token",
      });
    });

    it("signs out after resetting the password because every session is revoked", async () => {
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/password-reset/confirm": noContent,
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });

      await session.resetPassword({ token: "tok", password: "new-correct-horse" });

      expect(session.getSnapshot()).toEqual({ status: "signed_out" });
    });

    it("stays signed in when the new password is rejected", async () => {
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/password-reset/confirm": () => problem(422, "validation-error"),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });

      await expect(session.resetPassword({ token: "tok", password: "short" })).rejects.toBeInstanceOf(ApiError);

      expect(session.getSnapshot()).toEqual({ status: "signed_in", user });
    });

    it("refreshes and reloads the signed-in user after verifying instead of assuming whose email it was", async () => {
      const verifiedUser = { ...user, email_verified: true };
      const api = fakeApi({
        "POST /api/v1/auth/login": () => tokens("at-1", true),
        "POST /api/v1/auth/verify-email/confirm": noContent,
        // 検証の前の Access Token では chat を使えないので、取り直してから読む（ADR 0053 決定 2）。
        "POST /api/v1/auth/refresh": () => tokens("at-2"),
        "GET /api/v1/users/me": (_url, init) => json(200, { ...verifiedUser, auth: authorization(init) }),
      });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });
      await session.login({ email: user.email, password: "correct-horse" });
      api.calls.length = 0;

      await session.verifyEmail({ token: "tok" });

      expect(api.paths()).toEqual(["POST /api/v1/auth/verify-email/confirm", "POST /api/v1/auth/refresh", "GET /api/v1/users/me"]);
      expect(session.getSnapshot()).toEqual({ status: "signed_in", user: { ...verifiedUser, auth: "Bearer at-2" } });
    });

    it("does not restore the session just to verify", async () => {
      const api = fakeApi({ "POST /api/v1/auth/verify-email/confirm": noContent });
      const session = createSession({ baseUrl: BASE, fetch: api.fetch });

      await session.verifyEmail({ token: "tok" });

      expect(api.paths()).toEqual(["POST /api/v1/auth/verify-email/confirm"]);
      expect(session.getSnapshot()).toEqual({ status: "loading" });
    });
  });
});
