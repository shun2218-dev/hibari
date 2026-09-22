import type { ProfileView } from "@/components/chat/types";
import type { TransferCandidate } from "@/components/workspace/member-dialogs";
import type { InviteRowView, MemberRowView, WorkspaceRole } from "@/components/workspace/types";
import type { Invite, InvitePolicy, Member, Role } from "@/lib/api/types.gen";

import { formatDayTime } from "@/lib/chat/format/time";
import { memberPresence, statusView } from "./members";
import type { UrlTable } from "./message";

/**
 * ワークスペースの管理画面の表示用の変換（ADR 0018 / 0029）。
 *
 * 操作できるかの判定は、サーバーの authz（internal/chat/authz）と同じ規則をここに写している。
 * 写しているのは「出すかどうか」を決めるためだけで、判定の正は常にサーバーにある（CLAUDE.md ルール 9）。
 */

const roleRanks: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

/** actor のロールが target より上（authz.CanManage）。 */
export function canManage(actor: Role, target: Role): boolean {
  return roleRanks[actor] > roleRanks[target];
}

/** 付与できるロール（authz.CanGrant）。owner は譲渡でしか移らないので入らない。 */
export function grantableRoles(actor: Role): WorkspaceRole[] {
  return (["admin", "member"] as const).filter((role) => roleRanks[role] <= roleRanks[actor]);
}

/** 招待リンクを作れるか（authz.CanCreateInvite）。 */
export function canCreateInvite(actor: Role, policy: InvitePolicy): boolean {
  return roleRanks[actor] >= roleRanks.admin || policy === "all_members";
}

/** 招待リンクを取り消せるか（authz.CanRevokeInvite）。member は自分が作った招待だけ。 */
export function canRevokeInvite(actor: Role, policy: InvitePolicy, isCreator: boolean): boolean {
  return roleRanks[actor] >= roleRanks.admin || (isCreator && canCreateInvite(actor, policy));
}

/** 管理できない理由。自分自身と、自分と同じか上のロールの人が当てはまる。 */
export const MANAGE_LOCKED_REASON = "自分と同じか上のロールのメンバーは変更できません。";

export function toMemberRowView(
  member: Member,
  { userId, myRole, avatarUrls = {} }: { userId: string; myRole: Role; avatarUrls?: UrlTable },
): MemberRowView {
  const manageable = member.user.id !== userId && canManage(myRole, member.role);
  return {
    id: member.user.id,
    name: member.user.display_name,
    handle: member.user.handle,
    avatarUrl: avatarUrls[member.user.id] ?? undefined,
    presence: memberPresence(member),
    role: member.role,
    isSelf: member.user.id === userId,
    manage: manageable
      ? { kind: "menu", grantableRoles: grantableRoles(myRole), canRemove: true }
      : { kind: "locked", reason: MANAGE_LOCKED_REASON },
  };
}

/** プロフィールの email の状態（ADR 0050 決定 1 / 2）。 */
export type ProfileEmail = Extract<ProfileView, { kind: "member" }>["email"];

/**
 * プロフィールのカードとパネルの表示（ADR 0050）。
 *
 * - 手元のメンバー一覧にいれば member。名前・ロール・presence・ステータスは一覧の値（イベントで最新になっている）、
 *   email だけは 1 人分の API の結果を `email` で受け取る
 * - 一覧にいなければ former。名前と handle はメッセージの送信者の値（`fallback`）を使う（決定 5）
 * - どちらも無ければ unknown（外された人のパネルを URL から開き直した）
 *
 * ロールの変更と削除の入口は、管理画面と同じ写し（`toMemberRowView` の `manage`）で決める（決定 3。新しく書き写さない）。
 */
export function toProfileView(
  member: Member | undefined,
  {
    userId,
    myRole,
    email = { state: "loading" },
    fallback,
    avatarUrls = {},
    now = new Date(),
    timeZone,
  }: {
    userId: string;
    myRole: Role | undefined;
    email?: ProfileEmail;
    fallback?: { id: string; display_name: string; handle: string };
    avatarUrls?: UrlTable;
    now?: Date;
    timeZone?: string;
  },
): ProfileView {
  if (member) {
    const manage = myRole ? toMemberRowView(member, { userId, myRole }).manage : undefined;
    return {
      kind: "member",
      user: {
        id: member.user.id,
        name: member.user.display_name,
        handle: member.user.handle,
        avatarUrl: avatarUrls[member.user.id] ?? undefined,
        status: statusView(member.status, now, timeZone),
      },
      presence: memberPresence(member),
      role: member.role,
      email,
      isSelf: member.user.id === userId,
      manage: manage?.kind === "menu" ? { grantableRoles: manage.grantableRoles, canRemove: manage.canRemove } : undefined,
    };
  }
  if (fallback) {
    return {
      kind: "former",
      user: {
        id: fallback.id,
        name: fallback.display_name,
        handle: fallback.handle,
        avatarUrl: avatarUrls[fallback.id] ?? undefined,
      },
    };
  }
  return { kind: "unknown" };
}

/** 譲渡先の候補。自分以外の全員（owner は 1 人しかいないので、残りは admin と member）。 */
export function toTransferCandidates(members: readonly Member[], userId: string, avatarUrls: UrlTable = {}): TransferCandidate[] {
  return members
    .filter((m) => m.user.id !== userId && m.role !== "owner")
    .map((m) => ({
      id: m.user.id,
      name: m.user.display_name,
      handle: m.user.handle,
      avatarUrl: avatarUrls[m.user.id] ?? undefined,
      role: m.role as Exclude<WorkspaceRole, "owner">,
    }));
}

export function toInviteRowView(
  invite: Invite,
  {
    userId,
    myRole,
    invitePolicy,
    timeZone,
  }: { userId: string; myRole: Role; invitePolicy: InvitePolicy; timeZone?: string },
): InviteRowView {
  const expiresAt = new Date(invite.expires_at);
  return {
    id: invite.id,
    status: invite.status,
    createdByName: invite.created_by.display_name,
    usesLabel: `${invite.use_count} / ${invite.max_uses ?? "無制限"} 回使用`,
    expiryLabel:
      invite.status === "expired"
        ? `${formatDayTime(expiresAt, timeZone)} に失効`
        : `${formatDayTime(expiresAt, timeZone)} まで`,
    canRevoke: canRevokeInvite(myRole, invitePolicy, invite.created_by.id === userId),
  };
}

/** 招待リンクの URL。受け入れのページ（/j/{code}）に渡す。 */
export function inviteUrl(origin: string, code: string): string {
  return `${origin}/j/${code}`;
}
