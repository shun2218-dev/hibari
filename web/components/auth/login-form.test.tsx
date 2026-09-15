import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";

function renderForm(props: Partial<Parameters<typeof LoginForm>[0]> = {}) {
  return render(<LoginForm forgotPasswordHref="/forgot" signupHref="/signup" {...props} />);
}

describe("LoginForm", () => {
  it("shows no error before the first attempt", () => {
    renderForm();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    // どちらが違うか、アカウントがあるかを明かさない文言にする
    ["credentials", "メールアドレスまたはパスワードが違います"],
    ["rate_limited", "ログインの試行が多すぎます。しばらく時間をおいてから再度お試しください。"],
  ] as const)("shows the %s error", (error, text) => {
    renderForm({ error });

    expect(screen.getByRole("alert")).toHaveTextContent(text);
  });

  it("submits the entered credentials", async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    await userEvent.type(screen.getByLabelText("メールアドレス"), "naoki@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(onSubmit).toHaveBeenCalledWith({ email: "naoki@example.com", password: "correct-horse" });
  });

  it("disables the button while submitting", () => {
    renderForm({ submitting: true });

    expect(screen.getByRole("button", { name: "ログイン" })).toBeDisabled();
  });

  it("toggles password visibility", async () => {
    renderForm();
    const password = screen.getByLabelText("パスワード");
    expect(password).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "パスワードを表示する" }));
    expect(password).toHaveAttribute("type", "text");

    await userEvent.click(screen.getByRole("button", { name: "パスワードを隠す" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("links to password reset and signup", () => {
    renderForm();

    expect(screen.getByRole("link", { name: "パスワードをお忘れですか？" })).toHaveAttribute("href", "/forgot");
    expect(screen.getByRole("link", { name: "アカウントを作成" })).toHaveAttribute("href", "/signup");
  });
});
