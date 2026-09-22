import type { SavedItem, SavedList, SavedState } from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

import { CHANGE_PAGE_SIZE, messagePath } from "./messages";

/** 「後で」の 1 ページの件数（サーバーの既定と同じ。ADR 0054 決定 9）。 */
export const SAVED_PAGE_SIZE = 50;

/** リアクションの PUT / DELETE のパス。絵文字はパーセントエンコードして置く（ADR 0044 決定 4）。 */
export function savedPath(workspaceId: string, messageId: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/saved/${encodeURIComponent(messageId)}`;
}

/**
 * 「後で」（自分用の保存。ADR 0054）。
 */
export function createSavedApi(request: Session["request"]) {
  return {
    /** 「後で」に保存する（ADR 0054 決定 9）。保存済みなら状態を変えずに 200（冪等）。 */
    saveMessage: (roomId: string, messageId: string) =>
      request<SavedItem>("PUT", `${messagePath(roomId, messageId)}/saved`),

    /** 保存をタブの間で動かす。読めなくなったメッセージの保存でも動かせる。 */
    moveSaved: (workspaceId: string, messageId: string, state: Exclude<SavedState, "removed">) =>
      request<SavedItem>("PATCH", savedPath(workspaceId, messageId), { state }),

    /** 「後で」から外す。保存していなくても 204（冪等）。 */
    removeSaved: (workspaceId: string, messageId: string) => request<void>("DELETE", savedPath(workspaceId, messageId)),

    /** タブの一覧（保存した新しい順）。before は前のページの最後の保存の ID。 */
    listSaved: (workspaceId: string, state: Exclude<SavedState, "removed">, before?: string) => {
      const params = new URLSearchParams({ state, limit: String(SAVED_PAGE_SIZE) });
      if (before !== undefined) params.set("before", before);
      return request<SavedList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/saved?${params}`);
    },

    /** 再接続の差分（ADR 0054 決定 7）。外した行（removed）も返る。 */
    listSavedChanges: (workspaceId: string, afterChangeSeq: number) => {
      const params = new URLSearchParams({ after_change_seq: String(afterChangeSeq), limit: String(CHANGE_PAGE_SIZE) });
      return request<SavedList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/saved?${params}`);
    },
  };
}
