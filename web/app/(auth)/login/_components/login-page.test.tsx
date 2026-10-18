import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { json, problem, testUser, tokens } from "@/test/fake-api";
import { renderWithSession } from "@/test/render-with-session";

import { LoginPage } from "./login-page";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const signedOut = { "POST /api/v1/auth/refresh": () => problem(401, "invalid-refresh-token") };

async function submit(email = "naoki@example.com", password = "correct-horse") {
  await userEvent.type(await screen.findByLabelText("メールアドレス"), email);
  await userEvent.type(screen.getByLabelText("パスワード"), password);
  await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    router.replace.mockReset();
  });

  it("logs in and goes to the requested page", async () => {
    const { api } = renderWithSession(<LoginPage next="/w/123" />, {
      ...signedOut,
      "POST /api/v1/auth/login": () => tokens("at-1", testUser),
    });

    await submit();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/w/123"));
    expect(JSON.parse(String(api.calls.at(-1)?.init.body))).toEqual({ email: "naoki@example.com", password: "correct-horse" });
  });

  it.each([
    ["wrong credentials", problem(401, "invalid-credentials"), "メールアドレスまたはパスワードが違います"],
    ["too many attempts", problem(429, "rate-limited", { "Retry-After": "60" }), /ログインの試行が多すぎます/],
  ])("shows the error for %s and lets the user retry", async (_name, response, message) => {
    renderWithSession(<LoginPage next="/" />, { ...signedOut, "POST /api/v1/auth/login": () => response });

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("skips the form when already signed in", async () => {
    renderWithSession(<LoginPage next="/w/123" />, {
      "POST /api/v1/auth/refresh": () => tokens("at-1"),
      "GET /api/v1/users/me": () => json(200, testUser),
    });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/w/123"));
    expect(screen.queryByLabelText("メールアドレス")).not.toBeInTheDocument();
  });

  it("still shows the form when the server cannot be reached to restore the session", async () => {
    renderWithSession(<LoginPage next="/" />, { "POST /api/v1/auth/refresh": () => Promise.reject(new TypeError("fetch failed")) });

    expect(await screen.findByLabelText("メールアドレス")).toBeInTheDocument();
  });
});
