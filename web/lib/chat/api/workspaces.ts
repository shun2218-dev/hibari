import type {
  ChangeMemberRoleRequest,
  CreateWorkspaceRequest,
  ManualAwayRequest,
  ManualAwayResponse,
  Member,
  MemberList,
  MemberProfile,
  NotificationLevel,
  NotifyLevel,
  Role,
  SetStatusRequest,
  TransferOwnershipRequest,
  UpdateWorkspaceRequest,
  UserStatus,
  Workspace,
  WorkspaceList,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/session";

import { listAll } from "./paging";

/**
 * ワークスペースとメンバー（ADR 0006 / 0011）、自分の presence とステータス（ADR 0049）と通知の設定（ADR 0055）。
 */
export function createWorkspaceApi(request: Session["request"]) {
  return {
    listWorkspaces: () => request<WorkspaceList>("GET", "/api/v1/workspaces"),

    createWorkspace: (body: CreateWorkspaceRequest) => request<Workspace>("POST", "/api/v1/workspaces", body),

    /** 名前と招待ポリシーを変える（admin 以上。ADR 0006）。 */
    updateWorkspace: (workspaceId: string, body: UpdateWorkspaceRequest) =>
      request<Workspace>("PATCH", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, body),

    /**
     * プロフィールのパネルの 1 人分（ADR 0050 決定 1）。email を返すのはこれだけ（検証済みのときだけ）。
     * メンバーでない・外された人は 404。
     */
    getMemberProfile: (workspaceId: string, userId: string) =>
      request<MemberProfile>(
        "GET",
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      ),

    changeMemberRole: (workspaceId: string, userId: string, role: Role) =>
      request<Member>(
        "PATCH",
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
        { role } satisfies ChangeMemberRoleRequest,
      ),

    /** キック。userId が自分なら退出（owner は owner-must-transfer で 409）。 */
    removeMember: (workspaceId: string, userId: string) =>
      request<void>(
        "DELETE",
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      ),

    /** owner を譲渡する。自分は admin になる（ADR 0011）。 */
    transferOwnership: (workspaceId: string, userId: string) =>
      request<void>("POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/ownership-transfer`, {
        user_id: userId,
      } satisfies TransferOwnershipRequest),

    /** 手動の離席を設定 / 解除する（ユーザーごと。ADR 0049 決定 4）。冪等。 */
    setManualAway: (away: boolean) =>
      request<ManualAwayResponse>("PUT", "/api/v1/users/me/presence", { away } satisfies ManualAwayRequest),

    /** カスタムステータスを設定する（ワークスペースごと。ADR 0049 決定 5）。 */
    setStatus: (workspaceId: string, body: SetStatusRequest) =>
      request<UserStatus>("PUT", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/me/status`, body),

    /** カスタムステータスを解除する。設定していなくても成功（冪等）。 */
    clearStatus: (workspaceId: string) =>
      request<void>("DELETE", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/me/status`),

    /** そのワークスペースでの全体の通知の設定（ADR 0055 決定 2）。未設定なら mentions が返る。 */
    getNotificationLevel: (workspaceId: string) =>
      request<NotificationLevel>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/me/notifications`),

    setNotificationLevel: (workspaceId: string, level: NotifyLevel) =>
      request<NotificationLevel>("PUT", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/me/notifications`, { level }),

    /** ワークスペースのメンバーを全員取る。管理画面は全員を並べ、人数も出す。 */
    listAllMembers: (workspaceId: string): Promise<Member[]> =>
      listAll(
        (params) =>
          request<MemberList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members?${params}`),
        (page) => page.members,
      ),
  };
}
