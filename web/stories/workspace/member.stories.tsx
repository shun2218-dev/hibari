import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { KickMemberDialog } from "@/components/workspace/member-dialogs";

import { users } from "@/stories/fixtures/users";
import { membersPage } from "@/stories/screens/workspace";

/**
 * ワークスペースの管理 / メンバー。
 *
 * story の id がそのまま docs/ui/screenshots/ の PNG のパスになる（`workspace-member--…` ↔ `workspace/member/….png`。ADR 0047 決定 2）。
 * title は日本語にできるが、id は PNG のパスに合わせて固定する。
 */
const meta = {
  title: "ワークスペースの管理/メンバー",
  // PNG のパス（workspace/member/）と対応させる。title を日本語にしているので、id は自動生成に任せない。
  id: "workspace-member",
  // この tag が「docs/ui/screenshots/ の PNG と 1 対 1 の画面」の印。撮影ツールと 1 対 1 の検査がこれで選ぶ。
  tags: ["screenshot"],
  // 画面を見るための story で、引数をいじる想定がないので下のパネルは出さない。
  // screenshot はこの tag と対で「撮影の対象」を表す。既定は実装から撮ったもの（story ごとに上書きする）。
  parameters: { options: { showPanel: false }, screenshot: { source: "app" } },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const MembersAsOwner: Story = {
  name: "メンバー（オーナー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("owner"),
};

export const MembersAsAdmin: Story = {
  name: "メンバー（管理者）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("admin"),
};

export const MembersAsMember: Story = {
  name: "メンバー（メンバー）",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("member"),
};

export const MembersDark: Story = {
  name: "メンバー（ダーク）",
  tags: ["since:1.5"],
  parameters: { theme: "dark", screenshot: { source: "design" } },
  render: () => membersPage("owner"),
};

export const MobileMembers: Story = {
  name: "メンバー（モバイル）",
  tags: ["since:1.5"],
  parameters: { screenshot: { size: "390x844", source: "design" } },
  globals: { viewport: { value: "mobile" } },
  render: () => membersPage("owner"),
};

export const MemberMenuRolePicker: Story = {
  name: "ロールの選択",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("owner", { userId: users.misaki.id, kind: "roles" }),
};

export const MemberMenuLockedReason: Story = {
  name: "管理できない理由",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("admin", { userId: users.misaki.id, kind: "locked" }),
};

export const MemberMenuWithKick: Story = {
  name: "ロールの選択とキック",
  tags: ["since:6-1"],
  parameters: { screenshot: { source: "design", size: "760x420" } },
  render: () => membersPage("owner", { userId: users.suzuki.id, kind: "roles" }),
};

export const DialogKick: Story = {
  name: "キックの確認",
  tags: ["since:1.5"],
  parameters: { screenshot: { source: "design" } },
  render: () => membersPage("owner", null, <KickMemberDialog open memberName={users.suzuki.name} />),
};
