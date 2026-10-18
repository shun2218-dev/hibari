import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { problem } from "@/test/fake-api";
import { renderWithSession } from "@/test/render-with-session";

import { ForgotPasswordPage } from "./forgot-password-page";

const accepted = () => new Response(null, { status: 202 });

async function submit(email: string) {
  await userEvent.type(screen.getByLabelText("メールアドレス"), email);
  await userEvent.click(screen.getByRole("button", { name: "再設定用のメールを送る" }));
}

describe("ForgotPasswordPage", () => {
  it("requests the email and shows the same result whether or not the account exists", async () => {
    const { api } = renderWithSession(<ForgotPasswordPage />, { "POST /api/v1/auth/password-reset/request": accepted });

    await submit("naoki@example.com");

    expect(await screen.findByRole("heading", { name: "メールを確認してください" })).toBeInTheDocument();
    expect(JSON.parse(String(api.calls[0].init.body))).toEqual({ email: "naoki@example.com" });
    // ログイン状態を戻すための refresh はしない
    expect(api.paths()).toEqual(["POST /api/v1/auth/password-reset/request"]);
  });

  it("goes back to the form to try another address", async () => {
    renderWithSession(<ForgotPasswordPage />, { "POST /api/v1/auth/password-reset/request": accepted });
    await submit("naoki@example.com");

    await userEvent.click(await screen.findByRole("button", { name: "別のアドレスで送り直す" }));

    expect(screen.getByLabelText("メールアドレス")).toHaveValue("");
  });

  it("shows the rate limit and keeps the address to retry later", async () => {
    renderWithSession(<ForgotPasswordPage />, {
      "POST /api/v1/auth/password-reset/request": () => problem(429, "rate-limited", { "Retry-After": "60" }),
    });

    await submit("naoki@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent("再設定メールの送信が多すぎます");
    expect(screen.getByRole("button", { name: "再設定用のメールを送る" })).toBeEnabled();
    expect(screen.getByLabelText("メールアドレス")).toHaveValue("naoki@example.com");
  });

  it("keeps the form usable without an alert when the server cannot be reached", async () => {
    renderWithSession(<ForgotPasswordPage />, {
      "POST /api/v1/auth/password-reset/request": () => Promise.reject(new TypeError("fetch failed")),
    });

    await submit("naoki@example.com");

    expect(await screen.findByRole("button", { name: "再設定用のメールを送る" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "メールを確認してください" })).not.toBeInTheDocument();
  });
});
