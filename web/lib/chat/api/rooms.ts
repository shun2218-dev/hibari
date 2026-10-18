import type {
  CreateRoomRequest,
  Room,
  RoomList,
  RoomMember,
  RoomMemberList,
  RoomNotifications,
  UpdateRoomRequest,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session/auth-session";

import { listAll } from "./paging";

/**
 * ルーム（ADR 0011、アーカイブと削除は ADR 0059）とそのメンバー、ルームごとの通知の設定（ADR 0055）。
 */
export function createRoomApi(request: Session["request"]) {
  return {
    listRooms: (workspaceId: string) =>
      request<RoomList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/rooms`),

    createRoom: (workspaceId: string, body: CreateRoomRequest) =>
      request<Room>("POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/rooms`, body),

    getRoom: (roomId: string) => request<Room>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}`),

    /** 名前と is_default を変える。変えられるのは、そのルームを読める admin 以上（ADR 0011）。 */
    updateRoom: (roomId: string, body: UpdateRoomRequest) =>
      request<Room>("PATCH", `/api/v1/rooms/${encodeURIComponent(roomId)}`, body),

    joinRoom: (roomId: string) => request<Room>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/join`),

    /** アーカイブする・戻す（ADR 0059）。できるのはルームのメンバー（admin 以上は読めれば参加していなくても）。 */
    archiveRoom: (roomId: string) => request<Room>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/archive`),

    unarchiveRoom: (roomId: string) => request<Room>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/unarchive`),

    /** 行ごと削除する（ADR 0059）。元に戻せない。できるのは読める admin 以上。 */
    deleteRoom: (roomId: string) => request<void>("DELETE", `/api/v1/rooms/${encodeURIComponent(roomId)}`),

    /** 非公開ルームに人を追加する。すでにメンバーでも成功する（冪等。ADR 0011）。 */
    addRoomMember: (roomId: string, userId: string) =>
      request<void>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/members`, { user_id: userId }),

    /** ルームから外す（userId が自分なら退出）。 */
    removeRoomMember: (roomId: string, userId: string) =>
      request<void>("DELETE", `/api/v1/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`),

    /** カーソルをたどって全員を取る。パネルに全員を並べるので、途中のページで止めない。 */
    listAllRoomMembers: (roomId: string): Promise<RoomMember[]> =>
      listAll(
        (params) => request<RoomMemberList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/members?${params}`),
        (page) => page.members,
      ),

    /** ルームごとの設定を全部の値で置き換える（PUT。決定 4）。参加していない public ルームは 403。 */
    setRoomNotifications: (roomId: string, body: RoomNotifications) =>
      request<RoomNotifications>("PUT", `/api/v1/rooms/${encodeURIComponent(roomId)}/me/notifications`, body),
  };
}
