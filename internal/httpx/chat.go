package httpx

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// ChatService は httpx が使うチャットのユースケース（chat.Service が実装する）。
type ChatService interface {
	CreateWorkspace(ctx context.Context, actor ulid.ULID, name string) (chat.Workspace, error)
	ListWorkspaces(ctx context.Context, actor ulid.ULID) ([]chat.Workspace, error)
	GetWorkspace(ctx context.Context, actor, workspaceID ulid.ULID) (chat.Workspace, error)
	UpdateWorkspace(ctx context.Context, actor, workspaceID ulid.ULID, in chat.WorkspaceUpdate) (chat.Workspace, error)
	ListMembers(ctx context.Context, actor, workspaceID ulid.ULID, page chat.PageRequest) (chat.Page[chat.Member], error)
	GetMemberProfile(ctx context.Context, actor, workspaceID, target ulid.ULID) (chat.MemberProfile, error)
	ChangeMemberRole(ctx context.Context, actor, workspaceID, target ulid.ULID, newRole string) (chat.Member, error)
	RemoveMember(ctx context.Context, actor, workspaceID, target ulid.ULID) error
	TransferOwnership(ctx context.Context, actor, workspaceID, target ulid.ULID) error

	CreateInvite(ctx context.Context, actor, workspaceID ulid.ULID, in chat.InviteInput) (chat.CreatedInvite, error)
	ListInvites(ctx context.Context, actor, workspaceID ulid.ULID, page chat.PageRequest) (chat.Page[chat.Invite], error)
	RevokeInvite(ctx context.Context, actor, workspaceID, inviteID ulid.ULID) error
	PreviewInvite(ctx context.Context, actor ulid.ULID, code string) (chat.InvitePreview, error)
	AcceptInvite(ctx context.Context, actor ulid.ULID, code string) (chat.InviteAcceptance, error)

	CreateRoom(ctx context.Context, actor, workspaceID ulid.ULID, in chat.CreateRoomInput) (chat.Room, bool, error)
	ListRooms(ctx context.Context, actor, workspaceID ulid.ULID) ([]chat.Room, error)
	GetRoom(ctx context.Context, actor, roomID ulid.ULID) (chat.Room, error)
	UpdateRoom(ctx context.Context, actor, roomID ulid.ULID, in chat.RoomUpdate) (chat.Room, error)
	ArchiveRoom(ctx context.Context, actor, roomID ulid.ULID) (chat.Room, error)
	UnarchiveRoom(ctx context.Context, actor, roomID ulid.ULID) (chat.Room, error)
	DeleteRoom(ctx context.Context, actor, roomID ulid.ULID) error
	JoinRoom(ctx context.Context, actor, roomID ulid.ULID) (chat.Room, error)
	AddRoomMember(ctx context.Context, actor, roomID, target ulid.ULID) error
	RemoveRoomMember(ctx context.Context, actor, roomID, target ulid.ULID) error
	ListRoomMembers(ctx context.Context, actor, roomID ulid.ULID, page chat.PageRequest) (chat.Page[chat.RoomMember], error)

	SendMessage(ctx context.Context, actor, roomID ulid.ULID, in chat.SendMessageInput) (chat.Message, bool, error)
	ListMessages(ctx context.Context, actor, roomID ulid.ULID, q chat.MessageQuery) (chat.MessagePage, error)
	ResolveMessageLinks(ctx context.Context, actor ulid.ULID, links []chat.MessageLink) ([]chat.MessageLinkResult, error)
	EditMessage(ctx context.Context, actor, roomID, messageID ulid.ULID, body string) (chat.Message, error)
	DeleteMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) error
	AddReaction(ctx context.Context, actor, roomID, messageID ulid.ULID, emoji string) (chat.Message, error)
	RemoveReaction(ctx context.Context, actor, roomID, messageID ulid.ULID, emoji string) (chat.Message, error)
	PinMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) (chat.Message, error)
	UnpinMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) (chat.Message, error)
	ListPins(ctx context.Context, actor, roomID ulid.ULID) ([]chat.Message, error)
	SaveMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) (chat.SavedItem, error)
	MoveSaved(ctx context.Context, actor, workspaceID, messageID ulid.ULID, to chat.SavedState) (chat.SavedItem, error)
	RemoveSaved(ctx context.Context, actor, workspaceID, messageID ulid.ULID) error
	ListSaved(ctx context.Context, actor, workspaceID ulid.ULID, q chat.SavedQuery) (chat.SavedPage, error)
	SearchMessages(ctx context.Context, actor, workspaceID ulid.ULID, q chat.SearchQuery) (chat.SearchPage, error)
	ListActivity(ctx context.Context, actor, workspaceID ulid.ULID, q chat.ActivityQuery) (chat.ActivityPage, error)
	CountUnreadActivity(ctx context.Context, actor, workspaceID ulid.ULID) (int64, error)
	MarkRoomRead(ctx context.Context, actor, roomID ulid.ULID, seq int64) (chat.ReadState, error)
	ListThreadMessages(ctx context.Context, actor, roomID, rootID ulid.ULID, q chat.ThreadQuery) (chat.ThreadPage, error)
	MarkThreadRead(ctx context.Context, actor, roomID, rootID ulid.ULID, seq int64) (chat.ThreadReadState, error)
	ListThreads(ctx context.Context, actor, workspaceID ulid.ULID, page chat.PageRequest) (chat.Page[chat.FollowedThread], error)
	UnreadThreadCount(ctx context.Context, actor, workspaceID ulid.ULID) (int64, error)

	SetManualAway(ctx context.Context, actor ulid.ULID, away bool) (bool, error)
	SetStatus(ctx context.Context, actor, workspaceID ulid.ULID, status chat.UserStatus) (*chat.UserStatus, error)
	ClearStatus(ctx context.Context, actor, workspaceID ulid.ULID) error
	NotificationLevel(ctx context.Context, actor, workspaceID ulid.ULID) (chat.NotifyLevel, error)
	SetNotificationLevel(ctx context.Context, actor, workspaceID ulid.ULID, level chat.NotifyLevel) (chat.NotifyLevel, error)
	SetRoomNotifications(ctx context.Context, actor, roomID ulid.ULID, in chat.RoomNotifications) (chat.RoomNotifications, error)
	SetThreadNotifications(ctx context.Context, actor, roomID, rootID ulid.ULID, notify bool) (chat.ThreadNotifications, error)

	CreateAttachment(ctx context.Context, actor, roomID ulid.ULID, in chat.AttachmentInput) (chat.CreatedAttachment, error)
	CompleteAttachment(ctx context.Context, actor, attachmentID ulid.ULID) (chat.Attachment, error)
	GetAttachmentURL(ctx context.Context, actor, attachmentID ulid.ULID) (chat.DownloadURL, error)
	DeleteMessageAttachment(ctx context.Context, actor, roomID, messageID, attachmentID ulid.ULID) (chat.Message, error)
	PreviewLink(ctx context.Context, actor, roomID ulid.ULID, rawURL string) (*chat.ComposerLinkPreview, error)
	LinkPreviewURLs(ctx context.Context, actor, roomID, messageID, previewID ulid.ULID) (image, icon *chat.SignedURL, err error)
	RemoveLinkPreview(ctx context.Context, actor, roomID, messageID, previewID ulid.ULID) error
}

type chatHandlers struct {
	svc    ChatService
	logger *slog.Logger
}

func registerChatRoutes(mux *http.ServeMux, d Deps) {
	h := &chatHandlers{svc: d.Chat, logger: d.Logger}
	requireAuth := requireChatUser(d)
	handle := func(pattern string, f http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(f))
	}

	handle("POST /api/v1/workspaces", h.createWorkspace)
	handle("GET /api/v1/workspaces", h.listWorkspaces)
	handle("GET /api/v1/workspaces/{workspaceID}", h.getWorkspace)
	handle("PATCH /api/v1/workspaces/{workspaceID}", h.updateWorkspace)
	handle("GET /api/v1/workspaces/{workspaceID}/members", h.listMembers)
	// プロフィールのパネルの 1 人分（ADR 0050 決定 1）。email を返すのはこの API だけ。
	handle("GET /api/v1/workspaces/{workspaceID}/members/{userID}", h.getMemberProfile)
	handle("PATCH /api/v1/workspaces/{workspaceID}/members/{userID}", h.changeMemberRole)
	handle("DELETE /api/v1/workspaces/{workspaceID}/members/{userID}", h.removeMember)
	handle("POST /api/v1/workspaces/{workspaceID}/ownership-transfer", h.transferOwnership)

	// 離席とカスタムステータス（ADR 0049）。手動の離席は人の状態なのでユーザーごと、
	// カスタムステータスはワークスペースごと。パスは auth の /users/me の下に並ぶが、中身は chat のもの。
	handle("PUT /api/v1/users/me/presence", h.setManualAway)
	handle("PUT /api/v1/workspaces/{workspaceID}/me/status", h.setStatus)
	handle("DELETE /api/v1/workspaces/{workspaceID}/me/status", h.clearStatus)
	// 通知の設定（ADR 0055 決定 4）。全体の設定はカスタムステータスと同じくワークスペースごと、
	// ミュートと上書きはルームのメンバーの行にあるのでルームの下に置く。
	handle("GET /api/v1/workspaces/{workspaceID}/me/notifications", h.getNotificationLevel)
	handle("PUT /api/v1/workspaces/{workspaceID}/me/notifications", h.setNotificationLevel)
	handle("PUT /api/v1/rooms/{roomID}/me/notifications", h.setRoomNotifications)

	handle("POST /api/v1/workspaces/{workspaceID}/invites", h.createInvite)
	handle("GET /api/v1/workspaces/{workspaceID}/invites", h.listInvites)
	handle("DELETE /api/v1/workspaces/{workspaceID}/invites/{inviteID}", h.revokeInvite)
	// パス変数の名前 code はログで伏せる対象（secretPathValues）。名前を変えるときはそちらも変える。
	handle("GET /api/v1/invites/{code}", h.previewInvite)
	handle("POST /api/v1/invites/{code}/accept", h.acceptInvite)

	handle("POST /api/v1/workspaces/{workspaceID}/rooms", h.createRoom)
	handle("GET /api/v1/workspaces/{workspaceID}/rooms", h.listRooms)
	handle("GET /api/v1/rooms/{roomID}", h.getRoom)
	handle("PATCH /api/v1/rooms/{roomID}", h.updateRoom)
	// アーカイブ・復元・削除（ADR 0059 決定 8）。PATCH に混ぜないのは、できる人が名前の変更と違い、ログも残す別の操作だから。
	handle("DELETE /api/v1/rooms/{roomID}", h.deleteRoom)
	handle("POST /api/v1/rooms/{roomID}/archive", h.archiveRoom)
	handle("POST /api/v1/rooms/{roomID}/unarchive", h.unarchiveRoom)
	handle("POST /api/v1/rooms/{roomID}/join", h.joinRoom)
	handle("GET /api/v1/rooms/{roomID}/members", h.listRoomMembers)
	handle("POST /api/v1/rooms/{roomID}/members", h.addRoomMember)
	handle("DELETE /api/v1/rooms/{roomID}/members/{userID}", h.removeRoomMember)

	handle("POST /api/v1/rooms/{roomID}/messages", h.sendMessage)
	handle("GET /api/v1/rooms/{roomID}/messages", h.listMessages)
	// 本文に貼られたパーマリンクのカードをまとめて取る（ADR 0040）。ルームをまたぐのでルームのパスの下に置かない。
	handle("POST /api/v1/messages/links", h.resolveMessageLinks)
	handle("PATCH /api/v1/rooms/{roomID}/messages/{messageID}", h.editMessage)
	handle("DELETE /api/v1/rooms/{roomID}/messages/{messageID}", h.deleteMessage)
	// 絵文字のリアクション（ADR 0044 決定 4）。絵文字をパスに置き、PUT / DELETE がそれぞれ
	// 「その行があること / ないこと」を表す（どちらも冪等）。
	handle("PUT /api/v1/rooms/{roomID}/messages/{messageID}/reactions/{emoji}", h.addReaction)
	handle("DELETE /api/v1/rooms/{roomID}/messages/{messageID}/reactions/{emoji}", h.removeReaction)
	// ピン留め（ADR 0054 決定 5）。リアクションと同じく PUT / DELETE が「ピンがあること / ないこと」を表す。
	handle("PUT /api/v1/rooms/{roomID}/messages/{messageID}/pin", h.pinMessage)
	handle("DELETE /api/v1/rooms/{roomID}/messages/{messageID}/pin", h.unpinMessage)
	handle("GET /api/v1/rooms/{roomID}/pins", h.listPins)
	// 「後で」（ADR 0054 決定 9）。保存はメッセージを読めることが要るのでルームの下、
	// タブの移動・外す・一覧は本人の行の操作で、読めなくなっていてもできるのでワークスペースの下に置く。
	handle("PUT /api/v1/rooms/{roomID}/messages/{messageID}/saved", h.saveMessage)
	handle("PATCH /api/v1/workspaces/{workspaceID}/saved/{messageID}", h.moveSaved)
	handle("DELETE /api/v1/workspaces/{workspaceID}/saved/{messageID}", h.removeSaved)
	handle("GET /api/v1/workspaces/{workspaceID}/saved", h.listSaved)
	handle("GET /api/v1/workspaces/{workspaceID}/search/messages", h.searchMessages)
	handle("GET /api/v1/workspaces/{workspaceID}/activity", h.listActivity)
	handle("GET /api/v1/workspaces/{workspaceID}/activity/unread_count", h.activityUnreadCount)
	handle("POST /api/v1/rooms/{roomID}/read", h.markRoomRead)
	handle("GET /api/v1/rooms/{roomID}/threads/{rootID}/messages", h.listThreadMessages)
	handle("POST /api/v1/rooms/{roomID}/threads/{rootID}/read", h.markThreadRead)
	// スレッドの返信の通知（ADR 0056 決定 7）。true は明示的なフォローを兼ねる。
	handle("PUT /api/v1/rooms/{roomID}/threads/{rootID}/me/notifications", h.setThreadNotifications)
	handle("GET /api/v1/workspaces/{workspaceID}/threads", h.listThreads)

	handle("POST /api/v1/rooms/{roomID}/attachments", h.createAttachment)
	// 添付ファイルだけの削除（ADR 0045）。メッセージのパスの下に置き、応答は更新後のメッセージにする。
	handle("DELETE /api/v1/rooms/{roomID}/messages/{messageID}/attachments/{attachmentID}", h.deleteMessageAttachment)
	// 外部のリンクのプレビュー（ADR 0065）
	handle("POST /api/v1/rooms/{roomID}/link-previews", h.previewLink)
	handle("GET /api/v1/rooms/{roomID}/messages/{messageID}/link-previews/{previewID}/urls", h.getLinkPreviewURLs)
	handle("DELETE /api/v1/rooms/{roomID}/messages/{messageID}/link-previews/{previewID}", h.removeLinkPreview)
	handle("POST /api/v1/attachments/{attachmentID}/complete", h.completeAttachment)
	handle("GET /api/v1/attachments/{attachmentID}/url", h.getAttachmentURL)
}
