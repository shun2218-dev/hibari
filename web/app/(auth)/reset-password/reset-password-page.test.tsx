import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { problem } from "@/test/fake-api";
import { renderWithSession } from "@/test/render-with-session";

import { ResetPasswordPage } from "./reset-password-page";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

async function submit(password: string) {
  await userEvent.type(screen.getByLabelText("新しいパスワード"), password);
  await userEvent.click(screen.getByRole("button", { name: "パスワードを設定する" }));
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    router.replace.mockReset();
    router.push.mockReset();
  });

  it("sets the new password with the token from the link and asks to log in again", async () => {
    const { api } = renderWithSession(<ResetPasswordPage token="tok-1" />, {
      "POST /api/v1/auth/password-reset/confirm": () => new Response(null, { status: 204 }),
    });

    await submit("new-correct-horse");

    expect(await screen.findByRole("heading", { name: "パスワードを変更しました" })).toBeInTheDocument();
    expect(JSON.parse(String(api.calls[0].init.body))).toEqual({ token: "tok-1", password: "new-correct-horse" });
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    expect(router.replace).toHaveBeenCalledWith("/login");
  });

  it("shows the strength of the password being typed", async () => {
    renderWithSession(<ResetPasswordPage token="tok-1" />, {});

    await userEvent.type(screen.getByLabelText("新しいパスワード"), "short");

    expect(screen.getByText(/短すぎます/)).toBeInTheDocument();
  });

  it("offers a new email when the link has expired or was used", async () => {
    renderWithSession(<ResetPasswordPage token="used" />, {
      "POST /api/v1/auth/password-reset/confirm": () => problem(400, "invalid-one-time-token"),
    });

    await submit("new-correct-horse");

    expect(await screen.findByRole("heading", { name: "このリンクは使えません" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再設定用のメールを送る" }));
    expect(router.push).toHaveBeenCalledWith("/forgot-password");
  });

  it("treats a link without a token as unusable without calling the API", () => {
    const { api } = renderWithSession(<ResetPasswordPage token="" />, {});

    expect(screen.getByRole("heading", { name: "このリンクは使えません" })).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("keeps the form so the same link can be retried when the password is rejected", async () => {
    const confirm = vi
      .fn()
      .mockReturnValueOnce(problem(422, "validation-error"))
      .mockReturnValue(new Response(null, { status: 204 }));
    renderWithSession(<ResetPasswordPage token="tok-1" />, { "POST /api/v1/auth/password-reset/confirm": confirm });

    await submit("short");
    await waitFor(() => expect(screen.getByRole("button", { name: "パスワードを設定する" })).toBeEnabled());
    await userEvent.clear(screen.getByLabelText("新しいパスワード"));
    await submit("new-correct-horse");

    expect(await screen.findByRole("heading", { name: "パスワードを変更しました" })).toBeInTheDocument();
  });
});
