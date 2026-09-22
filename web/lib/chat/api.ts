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
  FollowedThread,
  Invite,
  InviteAcceptance,
  PinList,
  InviteList,
  InvitePreview,
  ManualAwayRequest,
  ManualAwayResponse,
  MarkRoomReadRequest,
  Member,
  MemberList,
  MemberProfile,
  Message,
  MessageLinks,
  MessageList,
  ReadState,
  Role,
  Room,
  UpdateRoomRequest,
  RoomList,
  RoomMember,
  RoomMemberList,
  SendMessageRequest,
  SetStatusRequest,
  SignedURL,
  ThreadList,
  ThreadMessageList,
  ThreadReadState,
  TransferOwnershipRequest,
  UpdateWorkspaceRequest,
  WSTicket,
  Workspace,
  WorkspaceList,
  UserStatus,
} from "@/lib/api/types.gen";
import type { Session } from "@/lib/auth/session";

/** 1 ページのメッセージの数。API の既定と同じ（ADR 0012）。 */
export const MESSAGE_PAGE_SIZE = 50;

/** 差分の取得の 1 ページの数。API の上限（ADR 0012）。 */
export const CHANGE_PAGE_SIZE = 100;

/** アバターの URL を 1 回で取れる人数。API の上限（ADR 0020）。 */
export const AVATAR_BATCH_SIZE = 200;

/** メッセージへのリンクのカードを 1 回で取れる件数。API の上限（ADR 0040）。 */
export const LINK_BATCH_SIZE = 20;

/** メンバー・招待の一覧の 1 ページの数。API の上限（ADR 0011）にして、往復を減らす。 */
const PAGE_SIZE = 200;

/** リアクションの PUT / DELETE のパス。絵文字はパーセントエンコードして置く（ADR 0044 決定 4）。 */
function messagePath(roomId: string, messageId: string): string {
  return `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`;
}

function reactionPath(roomId: string, messageId: string, emoji: string): string {
  return `${messagePath(roomId, messageId)}/reactions/${encodeURIComponent(emoji)}`;
}

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

    /** 手動の離席を設定 / 解除する（ユーザーごと。ADR 0049 決定 4）。冪等。 */
    setManualAway: (away: boolean) =>
      request<ManualAwayResponse>("PUT", "/api/v1/users/me/presence", { away } satisfies ManualAwayRequest),

    /** カスタムステータスを設定する（ワークスペースごと。ADR 0049 決定 5）。 */
    setStatus: (workspaceId: string, body: SetStatusRequest) =>
      request<UserStatus>("PUT", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/me/status`, body),

    /** カスタムステータスを解除する。設定していなくても成功（冪等）。 */
    clearStatus: (workspaceId: string) =>
      request<void>("DELETE", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/me/status`),

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

    /**
     * カーソルを省くと最新のページ。messages は常に seq の昇順（ADR 0012）。
     *
     * カーソルは 1 つだけ指定できる（2 つ以上はサーバーが 422 にする。ADR 0042）。
     * - beforeSeq: その seq より古い方へ
     * - afterSeq: その seq より新しい方へ（最初の未読から読み直すのに使う）
     * - aroundMessageId: そのメッセージを真ん中に置いて前後。見つからなければ最新のページが around: null で返る
     */
    listMessages: (
      roomId: string,
      { beforeSeq, afterSeq, aroundMessageId }: { beforeSeq?: number; afterSeq?: number; aroundMessageId?: string } = {},
    ) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
      if (afterSeq !== undefined) params.set("after_seq", String(afterSeq));
      if (aroundMessageId !== undefined) params.set("around_message_id", aroundMessageId);
      return request<MessageList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    },

    /** change_seq が afterChangeSeq より大きいメッセージを、change_seq の昇順で返す（再接続の差分。ADR 0014）。 */
    listChanges: (roomId: string, afterChangeSeq: number) => {
      const params = new URLSearchParams({ after_change_seq: String(afterChangeSeq), limit: String(CHANGE_PAGE_SIZE) });
      return request<MessageList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages?${params}`);
    },

    /**
     * 本文に貼られたパーマリンクのカードの中身をまとめて取る（ADR 0040）。
     * 副作用はないが ID の配列を渡すので POST。結果は送った順・同じ件数で返る。
     */
    resolveMessageLinks: (links: readonly { roomId: string; messageId: string }[]) =>
      request<MessageLinks>("POST", "/api/v1/messages/links", {
        links: links.map((l) => ({ room_id: l.roomId, message_id: l.messageId })),
      }),

    /** 同じ client_msg_id の再送は、既存のメッセージを 200 で返す（ADR 0004 / 0012）。 */
    sendMessage: (roomId: string, body: SendMessageRequest) =>
      request<Message>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, body),

    editMessage: (roomId: string, messageId: string, body: EditMessageRequest) =>
      request<Message>(
        "PATCH",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
        body,
      ),

    /**
     * 絵文字のリアクションを付ける / 外す（ADR 0044 決定 4）。どちらも冪等で、更新後のメッセージを返す。
     * 絵文字はパスに置く（主キーとそのまま対応し、冪等性が URL の形から読める）。
     */
    addReaction: (roomId: string, messageId: string, emoji: string) =>
      request<Message>("PUT", reactionPath(roomId, messageId, emoji)),

    removeReaction: (roomId: string, messageId: string, emoji: string) =>
      request<Message>("DELETE", reactionPath(roomId, messageId, emoji)),

    /** ピン留め（ADR 0054 決定 5）。ピン留め済みでも 200 で、更新後のメッセージを返す（冪等）。 */
    pinMessage: (roomId: string, messageId: string) =>
      request<Message>("PUT", `${messagePath(roomId, messageId)}/pin`),

    /** ピンを外す。ピン留めされていなくても 200（冪等）。 */
    unpinMessage: (roomId: string, messageId: string) =>
      request<Message>("DELETE", `${messagePath(roomId, messageId)}/pin`),

    /** ピン留めした新しい順。上限が 100 件なのでページングしない（ADR 0054 決定 5）。 */
    listPins: (roomId: string) => request<PinList>("GET", `/api/v1/rooms/${encodeURIComponent(roomId)}/pins`),

    /** 削除済みでも 204（冪等。ADR 0012）。 */
    deleteMessage: (roomId: string, messageId: string) =>
      request<void>("DELETE", `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`),

    markRead: (roomId: string, body: MarkRoomReadRequest) =>
      request<ReadState>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/read`, body),

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

    /** 添付の署名付き PUT URL を発行する。pending の行ができる（ADR 0013）。 */
    createAttachment: (roomId: string, body: CreateAttachmentRequest) =>
      request<CreateAttachmentResponse>("POST", `/api/v1/rooms/${encodeURIComponent(roomId)}/attachments`, body),

    /** PUT したオブジェクトを HEAD で検証し、メッセージに付けられる状態（uploaded）にする。冪等。 */
    completeAttachment: (attachmentId: string) =>
      request<Attachment>("POST", `/api/v1/attachments/${encodeURIComponent(attachmentId)}/complete`),

    /**
     * 添付ファイルだけを削除する（ADR 0045）。冪等で、更新後のメッセージを返す。
     * 最後の 1 件で本文も空だったメッセージは、ここで tombstone になる（決定 8）。
     */
    deleteMessageAttachment: (roomId: string, messageId: string, attachmentId: string) =>
      request<Message>(
        "DELETE",
        `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      ),

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

    /** 参加しているスレッドを全部取る。最後の返信が新しい順（ADR 0036）。サイドバーのバッジを手元の一覧から数えるため、途中で止めない。 */
    listAllThreads: (workspaceId: string): Promise<FollowedThread[]> =>
      listAll(
        (params) =>
          request<ThreadList>("GET", `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/threads?${params}`),
        (page) => page.threads,
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
