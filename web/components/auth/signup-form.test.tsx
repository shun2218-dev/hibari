import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SignupForm } from "./signup-form";

describe("SignupForm", () => {
  it("submits every field and reports password changes", async () => {
    const onSubmit = vi.fn();
    const onPasswordChange = vi.fn();
    render(<SignupForm loginHref="/login" onSubmit={onSubmit} onPasswordChange={onPasswordChange} />);

    await userEvent.type(screen.getByLabelText("表示名"), "佐藤 直樹");
    await userEvent.type(screen.getByLabelText("ハンドル"), "naoki");
    await userEvent.type(screen.getByLabelText("メールアドレス"), "naoki@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "アカウントを作成" }));

    expect(onPasswordChange).toHaveBeenLastCalledWith("pw");
    expect(onSubmit).toHaveBeenCalledWith({
      displayName: "佐藤 直樹",
      handle: "naoki",
      email: "naoki@example.com",
      password: "pw",
    });
  });

  it("shows the password strength", () => {
    render(<SignupForm loginHref="/login" passwordStrength={{ level: 3, label: "良い" }} />);

    const meter = screen.getByRole("meter", { name: "パスワードの強度" });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByText("強度: 良い")).toBeInTheDocument();
  });

  it("describes the handle", () => {
    render(<SignupForm loginHref="/login" />);

    expect(screen.getByLabelText("ハンドル")).toHaveAccessibleDescription("メンションに使われる表示用の ID です。");
  });
});
