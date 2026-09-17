import type {
  CreateRoomRequest,
  CreateWorkspaceRequest,
  MarkRoomReadRequest,
  MessageList,
  ReadState,
  Room,
  RoomList,
  RoomMember,
  RoomMemberList,
  Workspace,
  WorkspaceList,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

/** 1 ページのメッセージの数。API の既定と同じ（ADR 0012）。 */
export const MESSAGE_PAGE_SIZE = 50;

/** メンバー一覧の 1 ページの数。API の上限（ADR 0011）にして、往復を減らす。 */
const MEMBER_PAGE_SIZE = 200;

/**
 * チャットの REST API。パスとリクエスト・レスポンスの型の対応だけを持ち、状態は持たない。
 * 失敗は session.request が ApiError で投げる。
 */
export function createChatApi(request: Session["request"]) {
  return {
    listWorkspaces: () => request<WorkspaceList>("GET", "/api/v1/workspaces"),

    createWorkspace: (body: CreateWorkspaceRequest) => request<Workspace>("POST", "/api/v1/workspaces", body),

    listRooms: (workspaceId: string) =>
      request<RoomList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/rooms`),

    createRoom: (workspaceId: string, body: CreateRoomRequest) =>
      request<Room>("POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/rooms`, body),

    getRoom: (roomId: string) => request<Room>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}`),

    joinRoom: (roomId: string) => request<Room>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/join`),

    /** before_seq を省くと最新のページ。messages は常に seq の昇順（ADR 0012）。 */
    listMessages: (roomId: string, { beforeSeq }: { beforeSeq?: number } = {}) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
      return request<MessageList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    },

    markRead: (roomId: string, body: MarkRoomReadRequest) =>
      request<ReadState>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/read`, body),

    /** カーソルをたどって全員を取る。パネルに全員を並べるので、途中のページで止めない。 */
    async listAllRoomMembers(roomId: string): Promise<RoomMember[]> {
      const members: RoomMember[] = [];
      let after: string | null = null;
      do {
        const params = new URLSearchParams({ limit: String(MEMBER_PAGE_SIZE) });
        if (after) params.set("after", after);
        const page: RoomMemberList = await request<RoomMemberList>(
          "GET",
          `/api/v1/rooms/${encodeURIComponent(roomId)}/members?${params}`,
        );
        members.push(...page.members);
        after = page.next_cursor;
      } while (after);
      return members;
    },
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;
