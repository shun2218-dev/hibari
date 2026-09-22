import type { WorkspaceRef } from "@/components/chat/types";
import type { TransferCandidate } from "@/components/workspace/member-dialogs";
import type { InviteRowView, MemberRowView, WorkspaceRole } from "@/components/workspace/types";
import type { PresenceView } from "@/lib/chat/presence";

import { users } from "./users";

/**
 * ワークスペースと、管理画面のメンバー・招待（ADR 0029 / 0030）。
 */
export const workspaces = {
  dev: { id: "01J8ZH5K00000000000000000N", name: "hibari 開発" },
  memo: { id: "01J8ZH5K00000000000000000Q", name: "個人メモ" },
  yama: { id: "01J8ZH5K00000000000000000R", name: "山と印刷" },
} satisfies Record<string, WorkspaceRef>;

// ---- ワークスペースの管理（山と印刷） ----

export const lockedReason = "自分と同じか上のロールのメンバーは変更できません。";

type Viewer = Exclude<WorkspaceRole, never>;

const roster: Array<{ user: (typeof users)[keyof typeof users]; presence: PresenceView; role: WorkspaceRole }> = [
  { user: users.you, presence: "online", role: "owner" },
  { user: users.naoki, presence: "online", role: "admin" },
  { user: users.misaki, presence: "online", role: "admin" },
  { user: users.suzuki, presence: "offline", role: "member" },
  { user: users.haru, presence: "offline", role: "member" },
  { user: users.kei, presence: "offline", role: "member" },
];

const rank: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };

/**
 * 表示する人の立場ごとのメンバー一覧。スクリーンショットでは、オーナーの画面は「あなた」がオーナー、
 * 管理者とメンバーの画面は佐藤 直樹がオーナーで「あなた」が 3 番目に並ぶ。
 * 操作できるかは canManage（actor のロールが target より上）と canGrant（actor 以下で owner 以外）で決める。
 */
export function membersAs(viewer: Viewer): MemberRowView[] {
  const people: typeof roster =
    viewer === "owner"
      ? roster
      : [
          { user: users.naoki, presence: "online" as const, role: "owner" as const },
          { user: users.misaki, presence: "online" as const, role: "admin" as const },
          { user: users.you, presence: "online", role: viewer },
          ...roster.slice(3),
        ];
  return people.map(({ user, presence, role }) => {
    const canManage = user.id !== users.you.id && rank[viewer] > rank[role];
    return {
      id: user.id,
      name: user.name,
      handle: user.handle,
      presence,
      role,
      isSelf: user.id === users.you.id,
      manage: canManage
        ? {
            kind: "menu",
            grantableRoles: (["admin", "member"] as const).filter((r) => rank[r] <= rank[viewer]),
            canRemove: true,
          }
        : { kind: "locked", reason: lockedReason },
    };
  });
}

export function invitesAs(viewer: Viewer): InviteRowView[] {
  const admin = viewer !== "member";
  return [
    { id: "i-1", status: "active", createdByName: users.misaki.name, usesLabel: "3 / 10 回使用", expiryLabel: "9月20日 18:00 まで", canRevoke: admin },
    { id: "i-2", status: "exhausted", createdByName: users.naoki.name, usesLabel: "10 / 10 回使用", expiryLabel: "9月30日 09:00 まで", canRevoke: admin },
    { id: "i-3", status: "expired", createdByName: users.misaki.name, usesLabel: "1 / 無制限 回使用", expiryLabel: "9月1日 12:00 に失効", canRevoke: admin },
    { id: "i-4", status: "revoked", createdByName: users.you.name, usesLabel: "2 / 5 回使用", expiryLabel: "9月18日 20:00 まで", canRevoke: true },
  ];
}

export const transferCandidates: TransferCandidate[] = [
  { id: users.naoki.id, name: users.naoki.name, handle: users.naoki.handle, role: "admin" },
  { id: users.misaki.id, name: users.misaki.name, handle: users.misaki.handle, role: "admin" },
  { id: users.suzuki.id, name: users.suzuki.name, handle: users.suzuki.handle, role: "member" },
  { id: users.haru.id, name: users.haru.name, handle: users.haru.handle, role: "member" },
  { id: users.kei.id, name: users.kei.name, handle: users.kei.handle, role: "member" },
];
