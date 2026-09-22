import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InviteAccept } from "@/components/invite/invite-accept";

import { auth, inviteFooter, invitePreview, noHref } from "@/stories/screens";

/**
 * 招待 / 受け入れ。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`invite-accept--…` ↔ `invite/accept/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "招待/受け入れ",
  // PNG のパス（invite/accept/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "invite-accept",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const AcceptPreview: Story = {
  name: "招待: プレビュー",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    auth(<InviteAccept state={{ status: "valid", preview: invitePreview }} homeHref={noHref} />, inviteFooter),
};

export const AcceptAlready: Story = {
  name: "招待: 参加済み",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () =>
    auth(<InviteAccept state={{ status: "already_member", preview: invitePreview }} homeHref={noHref} />, inviteFooter),
};

export const AcceptInvalid: Story = {
  name: "招待: 無効",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<InviteAccept state={{ status: "invalid" }} homeHref={noHref} />, inviteFooter),
};

export const AcceptExpired: Story = {
  name: "招待: 期限切れ",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<InviteAccept state={{ status: "expired" }} homeHref={noHref} />, inviteFooter),
};

export const AcceptMaxed: Story = {
  name: "招待: 使用上限",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => auth(<InviteAccept state={{ status: "maxed" }} homeHref={noHref} />, inviteFooter),
};
