import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SignupForm } from "@/components/auth/signup-form";

import { auth, goodStrength, login } from "@/stories/screens/auth";
import { noHref } from "@/stories/screens/shared";

/**
 * 認証 / ログインと登録。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`auth-signin--…` ↔ `auth/signin/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "認証/ログインと登録",
  // PNG のパス（auth/signin/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "auth-signin",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
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
