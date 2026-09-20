import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InviteAccept } from "@/components/invite/invite-accept";

import { auth, inviteFooter, invitePreview, noHref } from "./screens";

/**
 * 招待の受け入れ。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`invite--…` ↔ `invite/….png`。ADR 0047 決定 2）。
 * 表示名は `name`、足したフェーズは `since:` の tag、撮影の大きさと出どころは `parameters.screenshot` に置く。
 */
const meta = {
  title: "invite",
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
