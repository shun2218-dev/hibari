import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  VerifyEmailChecking,
  VerifyEmailDone,
  VerifyEmailInvalid,
  VerifyEmailPending,
} from "@/components/auth/verify-email";

import { auth, noop } from "../screens";

/**
 * 認証 / メールの確認。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`auth-verify--…` ↔ `auth/verify/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "認証/メールの確認",
  // PNG のパス（auth/verify/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "auth-verify",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

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
