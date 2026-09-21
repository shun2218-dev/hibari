import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { json, problem, testUser, tokens } from "@/test/fake-api";
import { renderWithSession } from "@/test/render-with-session";

import { SignupPage } from "./signup-page";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const signedOut = { "POST /api/v1/auth/refresh": () => problem(401, "invalid-refresh-token") };

async function fillAndSubmit() {
  await userEvent.type(await screen.findByLabelText("表示名"), "佐藤 直樹");
  await userEvent.type(screen.getByLabelText("ハンドル"), "naoki");
  await userEvent.type(screen.getByLabelText("メールアドレス"), "naoki@example.com");
  await userEvent.type(screen.getByLabelText("パスワード"), "correct-horse");
  await userEvent.click(screen.getByRole("button", { name: "アカウントを作成" }));
}

describe("SignupPage", () => {
  beforeEach(() => {
    router.replace.mockReset();
  });

  it("registers, stays on the page and waits for the email verification", async () => {
    const { api } = renderWithSession(<SignupPage />, {
      ...signedOut,
      "POST /api/v1/auth/register": () => tokens("at-1", testUser),
      "POST /api/v1/auth/verify-email/request": () => new Response(null, { status: 202 }),
    });

    await fillAndSubmit();

    expect(await screen.findByRole("heading", { name: "確認メールを送りました" })).toBeInTheDocument();
    expect(screen.getByText("naoki@example.com")).toBeInTheDocument();
    // 登録でログイン状態になっても、確認待ちの画面から勝手に移らない
    expect(router.replace).not.toHaveBeenCalled();
    // email を変える API はないので出さない
    expect(screen.queryByRole("button", { name: "別のアドレスに変更する" })).not.toBeInTheDocument();
    expect(JSON.parse(String(api.calls.find((c) => c.path === "/api/v1/auth/register")?.init.body))).toEqual({
      display_name: "佐藤 直樹",
      handle: "naoki",
      email: "naoki@example.com",
      password: "correct-horse",
    });

    await userEvent.click(screen.getByRole("button", { name: "確認メールを再送する" }));
    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/auth/verify-email/request"));
  });

  it("puts the invite page into the verification link so the new member comes back to it (ADR 0053)", async () => {
    const { api } = renderWithSession(<SignupPage next="/j/abc" />, {
      ...signedOut,
      "POST /api/v1/auth/register": () => tokens("at-1", testUser),
      "POST /api/v1/auth/verify-email/request": () => new Response(null, { status: 202 }),
    });

    await fillAndSubmit();
    await screen.findByRole("heading", { name: "確認メールを送りました" });
    const body = (path: string) => JSON.parse(String(api.calls.find((c) => c.path === path)?.init.body));
    expect(body("/api/v1/auth/register")).toMatchObject({ next: "/j/abc" });

    await userEvent.click(screen.getByRole("button", { name: "確認メールを再送する" }));
    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/auth/verify-email/request"));
    expect(body("/api/v1/auth/verify-email/request")).toEqual({ next: "/j/abc" });
  });

  it("logs out from the waiting screen back to the form", async () => {
    const { api } = renderWithSession(<SignupPage />, {
      ...signedOut,
      "POST /api/v1/auth/register": () => tokens("at-1", testUser),
      "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }),
    });

    await fillAndSubmit();
    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(await screen.findByRole("button", { name: "アカウントを作成" })).toBeInTheDocument();
    expect(api.paths()).toContain("POST /api/v1/auth/logout");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows why the server rejected the input", async () => {
    renderWithSession(<SignupPage />, { ...signedOut, "POST /api/v1/auth/register": () => problem(409, "handle-taken") });

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("このハンドルはすでに使われています。");
    expect(screen.getByRole("button", { name: "アカウントを作成" })).toBeEnabled();
  });

  it("rates the password while typing", async () => {
    renderWithSession(<SignupPage />, signedOut);

    await userEvent.type(await screen.findByLabelText("パスワード"), "correct-horse");

    expect(screen.getByRole("meter", { name: "パスワードの強度" })).toHaveAttribute("aria-valuetext", "良い");
  });

  it("sends a signed-in user to the app", async () => {
    renderWithSession(<SignupPage />, {
      "POST /api/v1/auth/refresh": () => tokens("at-1"),
      "GET /api/v1/users/me": () => json(200, testUser),
    });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });
});
