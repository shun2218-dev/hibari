import type {
  FollowedThread,
  MarkRoomReadRequest,
  ThreadList,
  ThreadMessageList,
  ThreadNotifications,
  ThreadReadState,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/auth-session";

import { MESSAGE_PAGE_SIZE } from "./messages";
import { listAll } from "./paging";

/**
 * スレッド（ADR 0036）。返信の通知の切り替えは ADR 0056。
 */
export function createThreadApi(request: Session["request"]) {
  return {
    /** スレッドの親と返信。カーソルの決まりは listMessages と同じ（ADR 0036 / 0042）。 */
    listThreadMessages: (
      roomId: string,
      rootId: string,
      { beforeSeq, afterSeq, aroundMessageId }: { beforeSeq?: number; afterSeq?: number; aroundMessageId?: string } = {},
    ) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
      if (afterSeq !== undefined) params.set("after_seq", String(afterSeq));
      if (aroundMessageId !== undefined) params.set("around_message_id", aroundMessageId);
      return request<ThreadMessageList>(
        "GET",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(rootId)}/messages?${params}`,
      );
    },

    /** 参加していないスレッドでは following: false が返る（エラーにならない。ADR 0036）。 */
    markThreadRead: (roomId: string, rootId: string, body: MarkRoomReadRequest) =>
      request<ThreadReadState>(
        "POST",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(rootId)}/read`,
        body,
      ),

    /**
     * スレッドの返信の通知（ADR 0056 決定 7）。true は「新しい返信の通知を受け取る」で、参加していなければ参加する。
     * 返信のない親・読めないルームは 404、参加していない public ルームは 403。
     */
    setThreadNotifications: (roomId: string, rootId: string, notify: boolean) =>
      request<ThreadNotifications>(
        "PUT",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(rootId)}/me/notifications`,
        { notify_replies: notify },
      ),

    /** 参加しているスレッドを全部取る。最後の返信が新しい順（ADR 0036）。サイドバーのバッジを手元の一覧から数えるため、途中で止めない。 */
    listAllThreads: (workspaceId: string): Promise<FollowedThread[]> =>
      listAll(
        (params) =>
          request<ThreadList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/threads?${params}`),
        (page) => page.threads,
      ),
  };
}
