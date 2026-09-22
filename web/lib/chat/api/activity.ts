import type { ActivityFilter, ActivityList, ActivityUnreadCount } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/session";

/** アクティビティの 1 ページの数（ADR 0058 決定 6。API の既定と同じ）。 */
export const ACTIVITY_PAGE_SIZE = 50;

/**
 * アクティビティ（ADR 0058）。
 */
export function createActivityApi(request: Session["request"]) {
  return {
    /** アクティビティの 1 ページ（ADR 0058 決定 6）。before は前のページの next_cursor をそのまま渡す。 */
    listActivity: (workspaceId: string, query: { filter: ActivityFilter; unreadOnly: boolean; before?: string }) => {
      const params = new URLSearchParams({ filter: query.filter, limit: String(ACTIVITY_PAGE_SIZE) });
      if (query.unreadOnly) params.set("unread", "true");
      if (query.before !== undefined) params.set("before", query.before);
      return request<ActivityList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/activity?${params}`);
    },

    /** 未読のアクティビティの件数（メニューのバッジ）。100 で打ち切る。 */
    activityUnreadCount: (workspaceId: string) =>
      request<ActivityUnreadCount>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/activity/unread_count`),
  };
}
