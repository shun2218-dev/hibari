import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  ForgotPasswordForm,
  ForgotPasswordSent,
  ResetPasswordDone,
  ResetPasswordForm,
  ResetPasswordInvalid,
} from "@/components/auth/password-reset";

import { auth, goodStrength } from "@/stories/screens/auth";
import { noHref } from "@/stories/screens/shared";

/**
 * 認証 / パスワードの再設定。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`auth-password--…` ↔ `auth/password/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "認証/パスワードの再設定",
  // PNG のパス（auth/password/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "auth-password",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

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
