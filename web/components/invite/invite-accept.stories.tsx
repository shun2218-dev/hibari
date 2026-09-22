import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { users } from "@/stories/fixtures/users";
import { workspaces } from "@/stories/fixtures/workspaces";

import { InviteAccept } from "./invite-accept";

const preview = {
  workspace: { id: workspaces.yama.id, name: workspaces.yama.name, memberCount: 6, publicRoomCount: 8 },
  inviter: { id: users.misaki.id, name: users.misaki.name },
};

/**
 * 招待リンクを開いたときの中身（ADR 0030）。
 * 無効・期限切れ・使用上限では**ワークスペースの情報を返さない**ので、ここでも何も出さない（ADR 0011）。
 */
const meta = {
  title: "components/invite/InviteAccept",
  component: InviteAccept,
  tags: ["autodocs"],
  args: { state: { status: "valid", preview }, homeHref: "#", onAccept: () => {}, onOpen: () => {} },
  decorators: [(Story) => <div className="w-100 rounded-lg border border-border bg-surface p-6">{Story()}</div>],
} satisfies Meta<typeof InviteAccept>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Valid: Story = { name: "有効（参加できる）" };

export const Accepting: Story = { name: "参加の処理中", args: { state: { status: "valid", preview, accepting: true } } };

export const AlreadyMember: Story = { name: "すでにメンバー", args: { state: { status: "already_member", preview } } };

export const Invalid: Story = { name: "無効", args: { state: { status: "invalid" } } };

export const Expired: Story = { name: "期限切れ", args: { state: { status: "expired" } } };

export const Maxed: Story = { name: "使用上限", args: { state: { status: "maxed" } } };
