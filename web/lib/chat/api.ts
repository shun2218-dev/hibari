import type {
  Attachment,
  AvatarURLs,
  ChangeMemberRoleRequest,
  CreateAttachmentRequest,
  CreateAttachmentResponse,
  CreateInviteRequest,
  CreateRoomRequest,
  CreateWorkspaceRequest,
  EditMessageRequest,
  Invite,
  InviteAcceptance,
  InviteList,
  InvitePreview,
  MarkRoomReadRequest,
  Member,
  MemberList,
  Message,
  MessageList,
  ReadState,
  Role,
  Room,
  UpdateRoomRequest,
  RoomList,
  RoomMember,
  RoomMemberList,
  SendMessageRequest,
  SignedURL,
  TransferOwnershipRequest,
  UpdateWorkspaceRequest,
  WSTicket,
  Workspace,
  WorkspaceList,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

/** 1 ページのメッセージの数。API の既定と同じ（ADR 0012）。 */
export const MESSAGE_PAGE_SIZE = 50;

/** 差分の取得の 1 ページの数。API の上限（ADR 0012）。 */
export const CHANGE_PAGE_SIZE = 100;

/** アバターの URL を 1 回で取れる人数。API の上限（ADR 0020）。 */
export const AVATAR_BATCH_SIZE = 200;

/** メンバー・招待の一覧の 1 ページの数。API の上限（ADR 0011）にして、往復を減らす。 */
const PAGE_SIZE = 200;

/**
 * チャットの REST API。パスとリクエスト・レスポンスの型の対応だけを持ち、状態は持たない。
 * 失敗は session.request が ApiError で投げる。
 */
export function createChatApi(request: Session["request"]) {
  return {
    listWorkspaces: () => request<WorkspaceList>("GET", "/api/v1/workspaces"),

    createWorkspace: (body: CreateWorkspaceRequest) => request<Workspace>("POST", "/api/v1/workspaces", body),

    /** 名前と招待ポリシーを変える（admin 以上。ADR 0006）。 */
    updateWorkspace: (workspaceId: string, body: UpdateWorkspaceRequest) =>
      request<Workspace>("PATCH", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`, body),

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

    listRooms: (workspaceId: string) =>
      request<RoomList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/rooms`),

    createRoom: (workspaceId: string, body: CreateRoomRequest) =>
      request<Room>("POST", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/rooms`, body),

    getRoom: (roomId: string) => request<Room>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}`),

    joinRoom: (roomId: string) => request<Room>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/join`),

    /** 名前と is_default を変える。変えられるのは、そのルームを読める admin 以上（ADR 0011）。 */
    updateRoom: (roomId: string, body: UpdateRoomRequest) =>
      request<Room>("PATCH", `/api/v1/rooms/${encodeURIComponent(roomId)}`, body),

    /** 非公開ルームに人を追加する。すでにメンバーでも成功する（冪等。ADR 0011）。 */
    addRoomMember: (roomId: string, userId: string) =>
      request<void>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/members`, { user_id: userId }),

    /** ルームから外す（userId が自分なら退出）。 */
    removeRoomMember: (roomId: string, userId: string) =>
      request<void>("DELETE", `/api/v1/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`),

    /** before_seq を省くと最新のページ。messages は常に seq の昇順（ADR 0012）。 */
    listMessages: (roomId: string, { beforeSeq }: { beforeSeq?: number } = {}) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
      return request<MessageList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    },

    /** change_seq が afterChangeSeq より大きいメッセージを、change_seq の昇順で返す（再接続の差分。ADR 0014）。 */
    listChanges: (roomId: string, afterChangeSeq: number) => {
      const params = new URLSearchParams({ after_change_seq: String(afterChangeSeq), limit: String(CHANGE_PAGE_SIZE) });
      return request<MessageList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    },

    /** 同じ client_msg_id の再送は、既存のメッセージを 200 で返す（ADR 0004 / 0012）。 */
    sendMessage: (roomId: string, body: SendMessageRequest) =>
      request<Message>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, body),

    editMessage: (roomId: string, messageId: string, body: EditMessageRequest) =>
      request<Message>(
        "PATCH",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
        body,
      ),

    /** 削除済みでも 204（冪等。ADR 0012）。 */
    deleteMessage: (roomId: string, messageId: string) =>
      request<void>("DELETE", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`),

    markRead: (roomId: string, body: MarkRoomReadRequest) =>
      request<ReadState>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/read`, body),

    /** 添付の署名付き PUT URL を発行する。pending の行ができる（ADR 0013）。 */
    createAttachment: (roomId: string, body: CreateAttachmentRequest) =>
      request<CreateAttachmentResponse>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/attachments`, body),

    /** PUT したオブジェクトを HEAD で検証し、メッセージに付けられる状態（uploaded）にする。冪等。 */
    completeAttachment: (attachmentId: string) =>
      request<Attachment>("POST", `/api/v1/attachments/${encodeURIComponent(attachmentId)}/complete`),

    /** メッセージに付いた添付の署名付き GET URL（TTL 5 分。ADR 0013）。 */
    getAttachmentUrl: (attachmentId: string) =>
      request<SignedURL>("GET", `/api/v1/attachments/${encodeURIComponent(attachmentId)}/url`),

    /**
     * アバターの署名付き GET URL をまとめて取る（TTL 1 時間。ADR 0020）。画像がある人の分だけ返る。
     * パスは auth の API だが、chat のレスポンスに URL を載せない代わりに画面の側で引くので、ここに置く。
     */
    avatarUrls: (userIds: string[]) => request<AvatarURLs>("POST", "/api/v1/users/avatars", { user_ids: userIds }),

    /** WebSocket の接続に使う ws-ticket（30 秒で失効し、1 回しか使えない。ADR 0007）。 */
    issueTicket: async () => (await request<WSTicket>("POST", "/api/v1/ws/ticket")).ticket,

    /** カーソルをたどって全員を取る。パネルに全員を並べるので、途中のページで止めない。 */
    listAllRoomMembers: (roomId: string): Promise<RoomMember[]> =>
      listAll(
        (params) => request<RoomMemberList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/members?${params}`),
        (page) => page.members,
      ),

    /** ワークスペースのメンバーを全員取る。管理画面は全員を並べ、人数も出す。 */
    listAllMembers: (workspaceId: string): Promise<Member[]> =>
      listAll(
        (params) =>
          request<MemberList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members?${params}`),
        (page) => page.members,
      ),

    /** 招待リンクを全部取る。取り消し済み・期限切れも含む（ADR 0011）。 */
    listAllInvites: (workspaceId: string): Promise<Invite[]> =>
      listAll(
        (params) =>
          request<InviteList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/invites?${params}`),
        (page) => page.invites,
      ),
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;

/** カーソル（ADR 0011）をたどって全件を集める。 */
async function listAll<T, P extends { next_cursor: string | null }>(
  fetchPage: (params: URLSearchParams) => Promise<P>,
  itemsOf: (page: P) => T[],
): Promise<T[]> {
  const items: T[] = [];
  let after: string | null = null;
  do {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (after) params.set("after", after);
    const page = await fetchPage(params);
    items.push(...itemsOf(page));
    after = page.next_cursor;
  } while (after);
  return items;
}
