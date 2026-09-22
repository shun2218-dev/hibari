/** ワークスペースの管理画面の表示用の型。値の意味は API（ADR 0006 / 0011）に合わせる。 */

import type { PresenceView } from "@/lib/chat/presence";

export type WorkspaceRole = "owner" | "admin" | "member";

export type InvitePolicy = "admins_only" | "all_members";

export const roleLabel: Record<WorkspaceRole, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

/**
 * メンバーの行で自分ができること。判定（canManage / canGrant）はデータ層が API のルールと同じ関数で行い、
 * ここでは結果だけを受け取る（CLAUDE.md ルール 9: 判断を画面に散らさない）。
 * - menu: ロールを変更できる。grantableRoles は付与できるロール、canRemove ならワークスペースから削除もできる
 * - locked: 操作できない。reason はその理由（鍵のボタンを押すと出す）
 */
export type MemberManageView =
  | { kind: "menu"; grantableRoles: WorkspaceRole[]; canRemove: boolean }
  | { kind: "locked"; reason: string };

export type MemberRowView = {
  id: string;
  name: string;
  handle: string;
  /** アバター画像の URL（署名付き。ADR 0020）。なければ頭文字を出す。 */
  avatarUrl?: string;
  /** 自動の状態と手動の離席を合わせた結果（ADR 0049）。 */
  presence: PresenceView;
  role: WorkspaceRole;
  isSelf: boolean;
  manage: MemberManageView;
};

/**
 * 招待リンクの状態。API の status と同じ値。
 * - exhausted は画面では「上限到達」
 */
export type InviteStatus = "active" | "exhausted" | "expired" | "revoked";

export type InviteRowView = {
  id: string;
  status: InviteStatus;
  createdByName: string;
  /** 「3 / 10 回使用」「1 / 無制限 回使用」 */
  usesLabel: string;
  /** 「9月20日 18:00 まで」「9月1日 12:00 に失効」 */
  expiryLabel: string;
  canRevoke: boolean;
};
