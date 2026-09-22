import type { CreateInviteRequest, Invite, InviteAcceptance, InviteList, InvitePreview } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

import { listAll } from "./paging";

/**
 * 招待リンク（ADR 0030）。
 */
export function createInviteApi(request: Session["request"]) {
  return {
    /** code はこの応答にだけ入る。一覧では再表示できない（ADR 0006）。 */
    createInvite: (workspaceId: string, body: CreateInviteRequest) =>
      request<Invite>("POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invites`, body),

    revokeInvite: (workspaceId: string, inviteId: string) =>
      request<void>(
        "DELETE",
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(inviteId)}`,
      ),

    /** 招待リンクのプレビュー。要ログイン（ADR 0011）。使えない招待は 404 / 410 を投げる。 */
    previewInvite: (code: string) => request<InvitePreview>("GET", `/api/v1/invites/${encodeURIComponent(code)}`),

    /** 招待を受け入れる。すでにメンバーなら使用回数を消費せずに成功する（ADR 0011）。 */
    acceptInvite: (code: string) =>
      request<InviteAcceptance>("POST", `/api/v1/invites/${encodeURIComponent(code)}/accept`),

    /** 招待リンクを全部取る。取り消し済み・期限切れも含む（ADR 0011）。 */
    listAllInvites: (workspaceId: string): Promise<Invite[]> =>
      listAll(
        (params) =>
          request<InviteList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invites?${params}`),
        (page) => page.invites,
      ),
  };
}
