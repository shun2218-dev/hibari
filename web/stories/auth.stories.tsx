import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ForgotPasswordForm, ForgotPasswordSent, ResetPasswordDone, ResetPasswordForm, ResetPasswordInvalid } from "@/components/auth/password-reset";
import { SignupForm } from "@/components/auth/signup-form";
import { VerifyEmailChecking, VerifyEmailDone, VerifyEmailInvalid, VerifyEmailPending } from "@/components/auth/verify-email";

import { auth, goodStrength, login, noHref, noop } from "./screens";

/**
 * 認証（ログイン・登録・パスワードの再設定・メールの確認）。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`auth--…` ↔ `auth/….png`。ADR 0047 決定 2）。
 * 表示名は `name`、足したフェーズは `since:` の tag、撮影の大きさと出どころは `parameters.screenshot` に置く。
 */
const meta = {
  title: "auth",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Login: Story = {
  name: "ログイン",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => login(),
};

export const LoginErrorCredentials: Story = {
  name: "ログイン: 認証情報の誤り",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => login("credentials"),
};

export const LoginErrorRateLimit: Story = {
  name: "ログイン: 試行回数の上限",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => login("rate_limited"),
};

export const LoginDark: Story = {
  name: "ログイン（ダーク）",
  tags: ["since:1.5"],
  parameters: { theme: "dark", screenshot: { source: "design" } },
  render: () => login("credentials"),
};

export const MobileLogin: Story = {
  name: "ログイン（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => login("credentials"),
};

export const Signup: Story = {
  name: "アカウントを作成",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<SignupForm loginHref={noHref} passwordStrength={goodStrength} passwordDefaultValue="correct-horse" />),
};

export const Forgot: Story = {
  name: "パスワードの再設定を依頼",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<ForgotPasswordForm loginHref={noHref} />),
};

export const ForgotErrorRateLimit: Story = {
  name: "再設定メールの依頼: 回数制限",
  tags: ["since:6-2"],
  parameters: { screenshot: { source: "design", size: "480x540" } },
  render: () =>
    auth(
      <ForgotPasswordForm
        loginHref={noHref}
        error="再設定メールの送信が多すぎます。しばらく時間をおいてから再度お試しください。"
      />,
    ),
};

export const ForgotSent: Story = {
  name: "再設定メールを送信済み",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<ForgotPasswordSent loginHref={noHref} />),
};

export const Reset: Story = {
  name: "新しいパスワードを設定",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<ResetPasswordForm passwordStrength={goodStrength} passwordDefaultValue="correct-horse" />),
};

export const ResetErrorInvalidInput: Story = {
  name: "新しいパスワード: 入力エラー",
  tags: ["since:6-2"],
  parameters: { screenshot: { source: "design", size: "480x520" } },
  render: () =>
    auth(
      <ResetPasswordForm
        error="パスワードは8文字以上にしてください。"
        passwordStrength={{ level: 1, label: "短すぎます" }}
        passwordDefaultValue="horse"
      />,
    ),
};

export const ResetDone: Story = {
  name: "パスワードを変更済み",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<ResetPasswordDone />),
};

export const ResetInvalid: Story = {
  name: "再設定リンクが無効",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<ResetPasswordInvalid loginHref={noHref} />),
};

export const VerifyPending: Story = {
  name: "メール確認待ち",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<VerifyEmailPending email="naoki@example.com" onChangeEmail={noop} />),
};

export const VerifyChecking: Story = {
  name: "メールを確認中",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "480x360", source: "design" } },
  render: () => auth(<VerifyEmailChecking />),
};

export const VerifyDone: Story = {
  name: "メール確認済み",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<VerifyEmailDone />),
};

export const VerifyInvalid: Story = {
  name: "確認リンクが無効",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<VerifyEmailInvalid />),
};
