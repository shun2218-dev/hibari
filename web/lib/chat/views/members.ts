import type { RoomMemberRowView } from "@/components/chat/dialogs/room-settings";
import type { DmCandidateView } from "@/components/chat/dialogs/start-dm";
import type { RoleLabel, RoomKind, RoomMemberView, UserStatusView } from "@/components/chat/types";
import type { Member, Presence, Role, RoomMember, UserStatus } from "@/lib/api/types.gen";
import type { MentionCandidate } from "@/lib/chat/format/mentions";
import { formatStatusExpiry } from "@/lib/chat/format/time";
import { displayPresence, type PresenceView } from "@/lib/chat/presence";

import type { UrlTable } from "./message";
import { roleRanks } from "./permissions";

/**
 * メンバーの一覧・プロフィール・presence とステータス（ADR 0049）、メンションと DM の候補（ADR 0043）。
 */
const roleLabels: Record<Role, RoleLabel> = { owner: "オーナー", admin: "管理者", member: "メンバー" };

/**
 * API の presence（自動）と away（本人の設定）から、画面に出す 3 つの状態を決める（ADR 0049 決定 1）。
 * 合わせるのはここだけで、部品には結果だけを渡す。
 */
/**
 * API のステータスを表示用にする。期限切れはサーバーが落として null を返す（ADR 0049 決定 6）。
 * 「いつ消えるか」はここで文言にする（ホバーに出す。Slack と同じ）。
 */
export function statusView(
  status: UserStatus | null | undefined,
  now: Date = new Date(),
  timeZone?: string,
): UserStatusView | undefined {
  if (!status) return undefined;
  return {
    emoji: status.emoji,
    text: status.text === "" ? undefined : status.text,
    expiresLabel: status.expires_at ? formatStatusExpiry(new Date(status.expires_at), now, timeZone) : undefined,
  };
}

/**
 * ワークスペースのメンバー一覧から、user_id 引きの表を作る（ADR 0049 決定 7 の追記）。
 * メッセージの送信者・DM の相手のステータスと presence は、この表から引く。
 */
export function memberSettings(
  members: readonly Member[] | undefined,
  now: Date = new Date(),
  timeZone?: string,
): Record<string, { presence: PresenceView; status?: UserStatusView }> {
  const table: Record<string, { presence: PresenceView; status?: UserStatusView }> = {};
  for (const m of members ?? []) {
    table[m.user.id] = { presence: memberPresence(m), status: statusView(m.status, now, timeZone) };
  }
  return table;
}

export function memberPresence(member: { presence: Presence; away?: boolean }): PresenceView {
  return displayPresence(member.presence, member.away ?? false);
}

export function toRoomMemberView(
  member: RoomMember,
  avatarUrls: UrlTable = {},
  { now = new Date(), timeZone }: { now?: Date; timeZone?: string } = {},
): RoomMemberView {
  return {
    id: member.user.id,
    name: member.user.display_name,
    avatarUrl: avatarUrls[member.user.id] ?? undefined,
    presence: memberPresence(member),
    // 「いつ消えるか」の文言は、見る人の時計とタイムゾーンで作る（サーバーは絶対の時刻だけを返す）
    status: statusView(member.status, now, timeZone),
    roleLabel: roleLabels[member.role],
  };
}

/**
 * `@` の補完に出す候補（ADR 0043）。ルームのメンバーと `@channel` / `@here`。
 *
 * 自分も候補に残す（Slack と同じ。自分を指して書くことはある）。
 * メンバーでない人は出さない。メンションしても知らせが飛ばないため（ADR 0041）。
 * DM では `@channel` / `@here` を出さない（相手は 1 人で、個人のメンションと変わらないため）。
 */
export function toMentionCandidates(
  members: readonly RoomMember[] | undefined,
  { kind, avatarUrls = {} }: { kind: RoomKind; avatarUrls?: UrlTable },
): MentionCandidate[] {
  const users: MentionCandidate[] = (members ?? []).map((m) => ({
    kind: "user",
    id: m.user.id,
    handle: m.user.handle,
    name: m.user.display_name,
    avatarUrl: avatarUrls[m.user.id] ?? undefined,
  }));
  if (kind === "dm") return users;
  return [
    ...users,
    { kind: "channel", description: "このチャンネルの全員" },
    { kind: "here", description: "いまオンラインの人" },
  ];
}

/** user_id → 表示名。本文の `<@ID>` をチップにするのに使う（ADR 0043）。 */
export function toMemberNames(
  members: readonly Pick<RoomMember, "user">[] | undefined,
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const m of members ?? []) names[m.user.id] = m.user.display_name;
  return names;
}

/**
 * `@channel` / `@here` を送るときの確認に出す人数（ADR 0043）。
 * `@channel` はルームのメンバー、`@here` はそのうちオンラインの人。自分は数に入れない（自分には知らせが要らない）。
 */
export function mentionAllRecipients(
  members: readonly RoomMember[] | undefined,
  kind: "channel" | "here",
  meId: string | undefined,
): number {
  // @here は「いま見ている人」（自動の presence が active）。手動の離席は数に含める（通知は止めない。ADR 0049 決定 11）
  return (members ?? []).filter((m) => m.user.id !== meId && (kind === "channel" || m.presence === "active")).length;
}

/**
 * DM の相手や、非公開チャンネルに追加する人の候補。自分と、除きたい人（すでにチャンネルにいる人）を外し、
 * 表示名かハンドルで絞り込む。presence はワークスペースのメンバー一覧が返す（ADR 0015）。
 */
export function toDmCandidates(
  members: readonly Member[],
  { userId, search = "", exclude = [] }: { userId: string; search?: string; exclude?: readonly string[] },
): DmCandidateView[] {
  const query = search.trim().toLowerCase();
  const excluded = new Set([userId, ...exclude]);
  return members
    .filter((m) => !excluded.has(m.user.id))
    .filter(
      (m) =>
        query === "" ||
        m.user.display_name.toLowerCase().includes(query) ||
        m.user.handle.toLowerCase().includes(query),
    )
    .map((m) => ({
      id: m.user.id,
      name: m.user.display_name,
      handle: m.user.handle,
      presence: memberPresence(m),
      status: statusView(m.status),
    }));
}

/** チャンネルの設定に並べる、いま参加している人。外せるかはサーバーと同じ規則で決める（ADR 0011）。 */
export function toRoomMemberRows(
  members: readonly RoomMember[],
  { userId, myRole, avatarUrls = {} }: { userId: string; myRole: Role | undefined; avatarUrls?: UrlTable },
): RoomMemberRowView[] {
  return members.map((member) => ({
    id: member.user.id,
    name: member.user.display_name,
    avatarUrl: avatarUrls[member.user.id] ?? undefined,
    isSelf: member.user.id === userId,
    // 外せるのは、自分より下のロールの人だけ（authz.CanRemoveRoomMember）
    canRemove:
      member.user.id !== userId && myRole !== undefined && roleRanks[myRole] > roleRanks[member.role],
  }));
}
