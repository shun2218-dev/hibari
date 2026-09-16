import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ForgotPasswordSent, ResetPasswordDone, ResetPasswordInvalid } from "./password-reset";
import { VerifyEmailDone, VerifyEmailInvalid, VerifyEmailPending } from "./verify-email";

describe("password reset screens", () => {
  it("does not reveal whether the account exists after requesting a reset", () => {
    render(<ForgotPasswordSent loginHref="/login" />);

    expect(screen.getByRole("heading", { name: "メールを確認してください" })).toBeInTheDocument();
    expect(screen.getByText(/入力したアドレスにアカウントがあれば/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログインに戻る" })).toHaveAttribute("href", "/login");
  });

  it("asks to log in again after the reset", async () => {
    const onLogin = vi.fn();
    render(<ResetPasswordDone onLogin={onLogin} />);

    expect(screen.getByText(/すべてのデバイスからログアウトしました/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("offers a new email when the reset link is unusable", () => {
    render(<ResetPasswordInvalid loginHref="/login" />);

    expect(screen.getByRole("heading", { name: "このリンクは使えません" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再設定用のメールを送る" })).toBeInTheDocument();
  });
});

describe("email verification screens", () => {
  it("shows the address waiting for verification", async () => {
    const onResend = vi.fn();
    render(<VerifyEmailPending email="naoki@example.com" onResend={onResend} />);

    expect(screen.getByText("naoki@example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "確認メールを再送する" }));
    expect(onResend).toHaveBeenCalledOnce();
  });

  it("disables resending while a resend is in flight", () => {
    render(<VerifyEmailPending email="naoki@example.com" resending />);

    expect(screen.getByRole("button", { name: "確認メールを再送する" })).toBeDisabled();
  });

  it.each([
    ["done", <VerifyEmailDone key="done" />, "メールアドレスを確認しました"],
    ["invalid", <VerifyEmailInvalid key="invalid" />, "確認リンクが無効です"],
  ])("shows the %s state", (_name, element, heading) => {
    render(element);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });
});
