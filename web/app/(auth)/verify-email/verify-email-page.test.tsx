import { configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { problem, tokens } from "@/test/fake-api";
import { renderWithSession } from "@/test/render-with-session";

import { VerifyEmailPage } from "./verify-email-page";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const noContent = () => new Response(null, { status: 204 });

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    router.replace.mockReset();
    router.push.mockReset();
  });

  afterEach(() => {
    configure({ reactStrictMode: false });
  });

  it("verifies once on opening the link, even under Strict Mode", async () => {
    // 入れ子の <StrictMode> では effect が 2 回走らないので、ルートを Strict Mode にする（Next.js の reactStrictMode と同じ）
    configure({ reactStrictMode: true });
    const { api } = renderWithSession(<VerifyEmailPage token="tok-1" />, {
      "POST /api/v1/auth/verify-email/confirm": noContent,
    });

    expect(await screen.findByRole("heading", { name: "メールアドレスを確認しました" })).toBeInTheDocument();
    // 2 回目を送ると使用済みで「無効」になり、成功の表示を上書きしてしまう
    expect(api.paths()).toEqual(["POST /api/v1/auth/verify-email/confirm"]);
    expect(JSON.parse(String(api.calls[0].init.body))).toEqual({ token: "tok-1" });

    await userEvent.click(screen.getByRole("button", { name: "hibari を開く" }));
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("shows nothing until the result arrives", () => {
    renderWithSession(<VerifyEmailPage token="tok-1" />, {
      "POST /api/v1/auth/verify-email/confirm": () => new Promise<Response>(() => {}),
    });

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("resends from the invalid link when signed in", async () => {
    const { api } = renderWithSession(<VerifyEmailPage token="used" />, {
      "POST /api/v1/auth/verify-email/confirm": () => problem(400, "invalid-one-time-token"),
      "POST /api/v1/auth/refresh": () => tokens("at-1"),
      "POST /api/v1/auth/verify-email/request": () => new Response(null, { status: 202 }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "確認メールを再送する" }));

    await waitFor(() => expect(api.paths()).toContain("POST /api/v1/auth/verify-email/request"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("sends a signed-out user to log in and back to this screen to resend", async () => {
    renderWithSession(<VerifyEmailPage token="" />, {
      "POST /api/v1/auth/refresh": () => problem(401, "invalid-refresh-token"),
    });

    await userEvent.click(screen.getByRole("button", { name: "確認メールを再送する" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fverify-email"));
  });
});
