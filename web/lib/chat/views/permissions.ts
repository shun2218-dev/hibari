import type { Message, Role, Room } from "@/lib/api/types.gen";

/**
 * 画面に出す操作の可否（サーバーの authz と同じ規則を 1 か所に置く。ADR 0012 / 0018）。
 */
export const roleRanks: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

/**
 * メッセージの「…」に出す操作（ADR 0012 の authz.CanEditMessage / CanDeleteMessage と同じ規則）。
 *
 * 判定の正はサーバーで、ここは出すかどうかを決めるだけ。送信者のロールは、手元にメンバー一覧があって
 * そこにいるときだけ分かる。分からなければ admin 以上には出し、拒否されたらサーバーに従う（ADR 0027）。
 */
export function messageActions(
  message: Message,
  { userId, room, myRole, senderRole }: { userId: string; room: Room; myRole: Role | undefined; senderRole: Role | undefined },
): { canEdit: boolean; canDelete: boolean } {
  // アーカイブ中は誰も編集・削除できない（ADR 0059 決定 2）
  if (message.deleted_at !== null || room.archived_at !== null) return { canEdit: false, canDelete: false };
  // 投稿できるのはルームのメンバーだけ（参加していない public は読めるだけ）
  if (message.sender.id === userId) return { canEdit: room.is_member, canDelete: room.is_member };
  const canModerate =
    room.kind !== "dm" &&
    myRole !== undefined &&
    roleRanks[myRole] >= roleRanks.admin &&
    (senderRole === undefined || roleRanks[myRole] > roleRanks[senderRole]);
  return { canEdit: false, canDelete: canModerate };
}

/**
 * ルームに投稿できるか（リアクション・ピン留め・入力欄も同じ）。参加していない public は読めるだけ（ADR 0044 決定 6）、
 * アーカイブ中は誰も投稿できない（ADR 0059 決定 2）。サーバーの authz.CanWriteRoom と同じ規則にする。
 */
export function canPost(room: Room): boolean {
  return room.archived_at === null && (room.kind !== "public" || room.is_member);
}

/**
 * アーカイブ・復元・削除をできるか（ADR 0059 決定 1）。サーバーの authz.CanArchiveRoom / CanDeleteRoom と同じ規則にする。
 * - アーカイブと復元: ルームのメンバー。admin 以上は、読めるなら参加していなくても（ここに届くルームは読める）
 * - 削除: admin 以上だけ
 * DM と既定のルームは対象外。
 */
export function roomArchiveActions(room: Room, myRole: Role | undefined): { canArchive: boolean; canDelete: boolean } {
  if (room.kind === "dm" || room.is_default || myRole === undefined) return { canArchive: false, canDelete: false };
  const adminOrAbove = roleRanks[myRole] >= roleRanks.admin;
  return { canArchive: room.is_member || adminOrAbove, canDelete: adminOrAbove };
}
