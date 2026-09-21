package httpx

import (
	"context"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
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
	MarkRoomRead(ctx context.Context, actor, roomID ulid.ULID, seq int64) (chat.ReadState, error)
	ListThreadMessages(ctx context.Context, actor, roomID, rootID ulid.ULID, q chat.ThreadQuery) (chat.ThreadPage, error)
	MarkThreadRead(ctx context.Context, actor, roomID, rootID ulid.ULID, seq int64) (chat.ThreadReadState, error)
	ListThreads(ctx context.Context, actor, workspaceID ulid.ULID, page chat.PageRequest) (chat.Page[chat.FollowedThread], error)
	UnreadThreadCount(ctx context.Context, actor, workspaceID ulid.ULID) (int64, error)

	SetManualAway(ctx context.Context, actor ulid.ULID, away bool) (bool, error)
	SetStatus(ctx context.Context, actor, workspaceID ulid.ULID, status chat.UserStatus) (*chat.UserStatus, error)
	ClearStatus(ctx context.Context, actor, workspaceID ulid.ULID) error

	CreateAttachment(ctx context.Context, actor, roomID ulid.ULID, in chat.AttachmentInput) (chat.CreatedAttachment, error)
	CompleteAttachment(ctx context.Context, actor, attachmentID ulid.ULID) (chat.Attachment, error)
	GetAttachmentURL(ctx context.Context, actor, attachmentID ulid.ULID) (chat.DownloadURL, error)
	DeleteMessageAttachment(ctx context.Context, actor, roomID, messageID, attachmentID ulid.ULID) (chat.Message, error)
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
	handle("POST /api/v1/rooms/{roomID}/read", h.markRoomRead)
	handle("GET /api/v1/rooms/{roomID}/threads/{rootID}/messages", h.listThreadMessages)
	handle("POST /api/v1/rooms/{roomID}/threads/{rootID}/read", h.markThreadRead)
	handle("GET /api/v1/workspaces/{workspaceID}/threads", h.listThreads)

	handle("POST /api/v1/rooms/{roomID}/attachments", h.createAttachment)
	// 添付ファイルだけの削除（ADR 0045）。メッセージのパスの下に置き、応答は更新後のメッセージにする。
	handle("DELETE /api/v1/rooms/{roomID}/messages/{messageID}/attachments/{attachmentID}", h.deleteMessageAttachment)
	handle("POST /api/v1/attachments/{attachmentID}/complete", h.completeAttachment)
	handle("GET /api/v1/attachments/{attachmentID}/url", h.getAttachmentURL)
}

// actorOf は認証済みのリクエストの主体を返す。requireAuth の内側でだけ呼ぶ。
func actorOf(r *http.Request) ulid.ULID {
	id, _ := authn.FromContext(r.Context())
	return id.UserID
}

// pathID はパスの ID を読む。ULID として読めなければ、存在しない ID と同じく 404 にする。
// 400 にすると「形式は正しいが存在しない ID」と区別できてしまうが、それで得られる情報はないので、クライアントの分岐を減らす方を選ぶ。
func pathID(r *http.Request, name string) (ulid.ULID, error) {
	id, err := ulid.ParseStrict(r.PathValue(name))
	if err != nil {
		return ulid.ULID{}, chat.ErrNotFound
	}
	return id, nil
}

// pageRequest はクエリ文字列の after と limit を読む。
func pageRequest(r *http.Request) (chat.PageRequest, error) {
	var p chat.PageRequest
	q := r.URL.Query()
	if s := q.Get("after"); s != "" {
		after, err := ulid.ParseStrict(s)
		if err != nil {
			return p, &errBadRequest{status: http.StatusBadRequest, detail: "after must be an ID"}
		}
		p.After = after
	}
	if s := q.Get("limit"); s != "" {
		limit, err := strconv.Atoi(s)
		if err != nil || limit < 1 {
			return p, &errBadRequest{status: http.StatusBadRequest, detail: "limit must be a positive integer"}
		}
		// 上限を超えた値は chat.PageRequest が切り詰める。
		p.Limit = limit
	}
	return p, nil
}

func nextCursor(c *ulid.ULID) *string {
	if c == nil {
		return nil
	}
	s := c.String()
	return &s
}

type userProfileResponse struct {
	ID          string `json:"id"`
	Handle      string `json:"handle"`
	DisplayName string `json:"display_name"`
}

func newUserProfileResponse(u chat.UserProfile) userProfileResponse {
	return userProfileResponse{ID: u.ID.String(), Handle: u.Handle, DisplayName: u.DisplayName}
}

type workspaceResponse struct {
	ID           string             `json:"id"`
	Slug         string             `json:"slug"`
	Name         string             `json:"name"`
	InvitePolicy authz.InvitePolicy `json:"invite_policy"`
	MyRole       authz.Role         `json:"my_role"`
	// MemberCount は 1 件の取得でだけ返す。
	MemberCount *int64    `json:"member_count,omitzero"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func newWorkspaceResponse(w chat.Workspace, withCount bool) workspaceResponse {
	resp := workspaceResponse{
		ID:           w.ID.String(),
		Slug:         w.Slug,
		Name:         w.Name,
		InvitePolicy: w.InvitePolicy,
		MyRole:       w.MyRole,
		CreatedAt:    w.CreatedAt,
		UpdatedAt:    w.UpdatedAt,
	}
	if withCount {
		resp.MemberCount = &w.MemberCount
	}
	return resp
}

// memberResponse はワークスペースのメンバー。
//
// presence は自動で決まる状態の初期値で、変化は WebSocket の presence.changed で届く（ADR 0015 / 0049）。
// away（本人が選んだ離席）と status（カスタムステータス）は member.status_changed で届く。
// **画面に出す 3 つの状態は、presence と away をクライアントが合わせて決める**（ADR 0049 決定 1）。
type memberResponse struct {
	User     userProfileResponse `json:"user"`
	Role     authz.Role          `json:"role"`
	JoinedAt time.Time           `json:"joined_at"`
	Presence chat.Presence       `json:"presence"`
	Away     bool                `json:"away"`
	// Status は設定していなければ null（期限切れも null）。
	Status *userStatusResponse `json:"status"`
}

// userStatusResponse はカスタムステータス（ADR 0049）。expires_at が null なら消えない。
type userStatusResponse struct {
	Emoji     string     `json:"emoji"`
	Text      string     `json:"text"`
	ExpiresAt *time.Time `json:"expires_at"`
}

func newUserStatusResponse(s *chat.UserStatus) *userStatusResponse {
	if s == nil {
		return nil
	}
	return &userStatusResponse{Emoji: s.Emoji, Text: s.Text, ExpiresAt: s.ExpiresAt}
}

func newMemberResponse(m chat.Member) memberResponse {
	return memberResponse{
		User: newUserProfileResponse(m.User), Role: m.Role, JoinedAt: m.JoinedAt,
		Presence: m.Presence, Away: m.Away, Status: newUserStatusResponse(m.Status),
	}
}

type createWorkspaceRequest struct {
	Name string `json:"name"`
}

func (h *chatHandlers) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var req createWorkspaceRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	ws, err := h.svc.CreateWorkspace(r.Context(), actorOf(r), req.Name)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, newWorkspaceResponse(ws, true))
}

func (h *chatHandlers) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.ListWorkspaces(r.Context(), actorOf(r))
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := workspaceListResponse{Workspaces: make([]workspaceResponse, len(list))}
	for i, ws := range list {
		resp.Workspaces[i] = newWorkspaceResponse(ws, false)
	}
	writeJSON(w, http.StatusOK, resp)
}

type workspaceListResponse struct {
	Workspaces []workspaceResponse `json:"workspaces"`
}

func (h *chatHandlers) getWorkspace(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	ws, err := h.svc.GetWorkspace(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newWorkspaceResponse(ws, true))
}

// updateWorkspaceRequest は PATCH の入力。省略した項目（と null）は変更しない。
type updateWorkspaceRequest struct {
	Name         *string `json:"name"`
	InvitePolicy *string `json:"invite_policy"`
}

func (h *chatHandlers) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req updateWorkspaceRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	ws, err := h.svc.UpdateWorkspace(r.Context(), actorOf(r), wsID, chat.WorkspaceUpdate{Name: req.Name, InvitePolicy: req.InvitePolicy})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newWorkspaceResponse(ws, true))
}

func (h *chatHandlers) listMembers(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := pageRequest(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	p, err := h.svc.ListMembers(r.Context(), actorOf(r), wsID, page)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := memberListResponse{Members: make([]memberResponse, len(p.Items)), NextCursor: nextCursor(p.NextCursor)}
	for i, m := range p.Items {
		resp.Members[i] = newMemberResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
}

// memberProfileResponse はメンバーの一覧の 1 行に email を足したもの（ADR 0050 決定 1）。
// email は検証済みのときだけ入り、未検証なら null（決定 2）。
type memberProfileResponse struct {
	memberResponse
	Email *string `json:"email"`
}

func (h *chatHandlers) getMemberProfile(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	target, err := pathID(r, "userID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	p, err := h.svc.GetMemberProfile(r.Context(), actorOf(r), wsID, target)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, memberProfileResponse{memberResponse: newMemberResponse(p.Member), Email: p.Email})
}

type memberListResponse struct {
	Members    []memberResponse `json:"members"`
	NextCursor *string          `json:"next_cursor"`
}

type manualAwayRequest struct {
	Away bool `json:"away"`
}

type manualAwayResponse struct {
	Away bool `json:"away"`
}

// setManualAway は本人の離席を固定する / 解除する（ADR 0049 決定 4）。冪等。
func (h *chatHandlers) setManualAway(w http.ResponseWriter, r *http.Request) {
	var req manualAwayRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	away, err := h.svc.SetManualAway(r.Context(), actorOf(r), req.Away)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, manualAwayResponse{Away: away})
}

// setStatusRequest は expires_at が null なら「消えない」。相対の期限（今日・今週）を
// 絶対の時刻にするのはクライアント（サーバーはユーザーのタイムゾーンを知らない。ADR 0049 決定 5）。
type setStatusRequest struct {
	Emoji     string     `json:"emoji"`
	Text      string     `json:"text"`
	ExpiresAt *time.Time `json:"expires_at"`
}

func (h *chatHandlers) setStatus(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req setStatusRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	status, err := h.svc.SetStatus(r.Context(), actorOf(r), wsID, chat.UserStatus{
		Emoji: req.Emoji, Text: strings.TrimSpace(req.Text), ExpiresAt: req.ExpiresAt,
	})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newUserStatusResponse(status))
}

func (h *chatHandlers) clearStatus(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.ClearStatus(r.Context(), actorOf(r), wsID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type changeMemberRoleRequest struct {
	Role string `json:"role"`
}

func (h *chatHandlers) changeMemberRole(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	target, err := pathID(r, "userID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req changeMemberRoleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	m, err := h.svc.ChangeMemberRole(r.Context(), actorOf(r), wsID, target, req.Role)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newMemberResponse(m))
}

// removeMember はキック。パスの userID が自分なら退出。
func (h *chatHandlers) removeMember(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	target, err := pathID(r, "userID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.RemoveMember(r.Context(), actorOf(r), wsID, target); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type transferOwnershipRequest struct {
	UserID string `json:"user_id"`
}

func (h *chatHandlers) transferOwnership(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req transferOwnershipRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	target, err := bodyUserID(req.UserID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.TransferOwnership(r.Context(), actorOf(r), wsID, target); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type inviteResponse struct {
	ID          string              `json:"id"`
	WorkspaceID string              `json:"workspace_id"`
	CreatedBy   userProfileResponse `json:"created_by"`
	MaxUses     *int                `json:"max_uses"`
	UseCount    int                 `json:"use_count"`
	ExpiresAt   time.Time           `json:"expires_at"`
	RevokedAt   *time.Time          `json:"revoked_at"`
	CreatedAt   time.Time           `json:"created_at"`
	Status      chat.InviteStatus   `json:"status"`
	// Code は作成のレスポンスでだけ返す。一覧では再表示しない（ADR 0006）。
	Code string `json:"code,omitempty"`
}

func newInviteResponse(inv chat.Invite) inviteResponse {
	return inviteResponse{
		ID:          inv.ID.String(),
		WorkspaceID: inv.WorkspaceID.String(),
		CreatedBy:   newUserProfileResponse(inv.CreatedBy),
		MaxUses:     inv.MaxUses,
		UseCount:    inv.UseCount,
		ExpiresAt:   inv.ExpiresAt,
		RevokedAt:   inv.RevokedAt,
		CreatedAt:   inv.CreatedAt,
		Status:      inv.Status,
	}
}

type createInviteRequest struct {
	// MaxUses が null（または省略）なら無制限。
	MaxUses          *int   `json:"max_uses"`
	ExpiresInSeconds *int64 `json:"expires_in_seconds"`
}

func (h *chatHandlers) createInvite(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req createInviteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	in := chat.InviteInput{MaxUses: req.MaxUses}
	if req.ExpiresInSeconds != nil {
		// 巨大な値で time.Duration があふれて負にならないよう、表せる最大に丸めてから渡す（範囲の検証は chat が行う）。
		secs := min(*req.ExpiresInSeconds, int64(math.MaxInt64/time.Second))
		d := time.Duration(secs) * time.Second
		in.ExpiresIn = &d
	}
	inv, err := h.svc.CreateInvite(r.Context(), actorOf(r), wsID, in)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := newInviteResponse(inv.Invite)
	resp.Code = inv.Code
	writeJSON(w, http.StatusCreated, resp)
}

func (h *chatHandlers) listInvites(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := pageRequest(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	p, err := h.svc.ListInvites(r.Context(), actorOf(r), wsID, page)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := inviteListResponse{Invites: make([]inviteResponse, len(p.Items)), NextCursor: nextCursor(p.NextCursor)}
	for i, inv := range p.Items {
		resp.Invites[i] = newInviteResponse(inv)
	}
	writeJSON(w, http.StatusOK, resp)
}

type inviteListResponse struct {
	Invites    []inviteResponse `json:"invites"`
	NextCursor *string          `json:"next_cursor"`
}

func (h *chatHandlers) revokeInvite(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	inviteID, err := pathID(r, "inviteID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.RevokeInvite(r.Context(), actorOf(r), wsID, inviteID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type invitePreviewResponse struct {
	Workspace     invitePreviewWorkspaceResponse `json:"workspace"`
	Inviter       userProfileResponse            `json:"inviter"`
	AlreadyMember bool                           `json:"already_member"`
	ExpiresAt     time.Time                      `json:"expires_at"`
}

// invitePreviewWorkspaceResponse は、まだメンバーでない人に見せてよいワークスペースの情報だけを持つ。
type invitePreviewWorkspaceResponse struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	MemberCount     int64  `json:"member_count"`
	PublicRoomCount int64  `json:"public_room_count"`
}

func (h *chatHandlers) previewInvite(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.PreviewInvite(r.Context(), actorOf(r), r.PathValue("code"))
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var resp invitePreviewResponse
	resp.Workspace.ID = p.WorkspaceID.String()
	resp.Workspace.Name = p.WorkspaceName
	resp.Workspace.MemberCount = p.MemberCount
	resp.Workspace.PublicRoomCount = p.PublicRoomCount
	resp.Inviter = newUserProfileResponse(p.Inviter)
	resp.AlreadyMember = p.AlreadyMember
	resp.ExpiresAt = p.ExpiresAt
	writeJSON(w, http.StatusOK, resp)
}

type inviteAcceptanceResponse struct {
	Workspace     workspaceResponse `json:"workspace"`
	AlreadyMember bool              `json:"already_member"`
}

// acceptInvite は、新しく参加したときもすでにメンバーだったときも 200 を返す。
// どちらでもクライアントの次の動作（ワークスペースを開く）は同じで、違いは already_member で分かる。
func (h *chatHandlers) acceptInvite(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.AcceptInvite(r.Context(), actorOf(r), r.PathValue("code"))
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, inviteAcceptanceResponse{Workspace: newWorkspaceResponse(res.Workspace, true), AlreadyMember: res.AlreadyMember})
}

type roomResponse struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspace_id"`
	Kind        authz.RoomKind `json:"kind"`
	// Name は dm では null。
	Name      *string `json:"name"`
	IsDefault bool    `json:"is_default"`
	IsMember  bool    `json:"is_member"`
	// MemberCount は 1 件の取得でだけ返す。
	MemberCount    *int64          `json:"member_count,omitzero"`
	DMPeer         *dmPeerResponse `json:"dm_peer,omitzero"`
	LastMessageSeq int64           `json:"last_message_seq"`
	LastMessageAt  *time.Time      `json:"last_message_at"`
	// LastReadSeq はルームのメンバーでなければ null。
	LastReadSeq *int64 `json:"last_read_seq"`
	// LastUserSeq は人の発言の総数、LastReadUserSeq はその既読位置（未読数の根拠。ADR 0033）。
	LastUserSeq     int64  `json:"last_user_seq"`
	LastReadUserSeq *int64 `json:"last_read_user_seq"`
	UnreadCount     int64  `json:"unread_count"`
	// MentionCount は未読の範囲にある自分宛てのメンションの数（ADR 0041）。未読とは別のバッジに出す。
	MentionCount int64 `json:"mention_count"`
	// LastMessage はメッセージが 1 件もなければ null。
	LastMessage *lastMessageResponse `json:"last_message"`
	CreatedAt   time.Time            `json:"created_at"`
}

// dmPeerResponse は DM の相手。presence は自動で決まる状態の初期値（ADR 0015 / 0049）。
//
// 相手の away とカスタムステータスはここに載せない。クライアントはワークスペースのメンバー一覧から引く
// （メッセージの送信者の横に出すステータスと同じ経路にして、載せ場所を増やさない。ADR 0049 決定 7 の追記）。
type dmPeerResponse struct {
	userProfileResponse
	Presence chat.Presence `json:"presence"`
}

func newLastMessageResponse(m chat.MessagePreview) lastMessageResponse {
	return lastMessageResponse{
		ID: m.ID.String(), Sender: newUserProfileResponse(m.Sender), Kind: m.Kind,
		System: newSystemEventResponse(m.System), Body: m.Body, CreatedAt: m.CreatedAt, Deleted: m.Deleted,
	}
}

// lastMessageResponse はサイドバーの最終メッセージ。相対時刻の表示はクライアントが created_at から作る。
type lastMessageResponse struct {
	ID     string              `json:"id"`
	Sender userProfileResponse `json:"sender"`
	// Kind と System は、サイドバーの 1 行にログの文言を出すために返す（ADR 0033）。
	Kind      chat.MessageKind     `json:"kind"`
	System    *systemEventResponse `json:"system,omitzero"`
	Body      string               `json:"body"`
	CreatedAt time.Time            `json:"created_at"`
	Deleted   bool                 `json:"deleted"`
}

func newRoomResponse(r chat.Room, withCount bool) roomResponse {
	resp := roomResponse{
		ID:              r.ID.String(),
		WorkspaceID:     r.WorkspaceID.String(),
		Kind:            r.Kind,
		IsDefault:       r.IsDefault,
		IsMember:        r.IsMember,
		LastMessageSeq:  r.LastMessageSeq,
		LastMessageAt:   r.LastMessageAt,
		LastReadSeq:     r.LastReadSeq,
		LastUserSeq:     r.LastUserSeq,
		LastReadUserSeq: r.LastReadUserSeq,
		UnreadCount:     r.UnreadCount,
		MentionCount:    r.MentionCount,
		CreatedAt:       r.CreatedAt,
	}
	if m := r.LastMessage; m != nil {
		lm := newLastMessageResponse(*m)
		resp.LastMessage = &lm
	}
	if r.Kind != authz.RoomDM {
		resp.Name = &r.Name
	}
	if withCount {
		resp.MemberCount = &r.MemberCount
	}
	if r.DMPeer != nil {
		resp.DMPeer = &dmPeerResponse{userProfileResponse: newUserProfileResponse(*r.DMPeer), Presence: r.DMPeerPresence}
	}
	return resp
}

// bodyUserID はリクエストボディの user_id を読む。
func bodyUserID(s string) (ulid.ULID, error) {
	if s == "" {
		return ulid.ULID{}, &chat.ValidationError{Fields: []chat.FieldError{{Field: "user_id", Reason: chat.ReasonRequired}}}
	}
	id, err := ulid.ParseStrict(s)
	if err != nil {
		return ulid.ULID{}, &chat.ValidationError{Fields: []chat.FieldError{{Field: "user_id", Reason: chat.ReasonInvalidFormat}}}
	}
	return id, nil
}

// createRoomRequest の name は public / private で、user_id は dm で使う。
type createRoomRequest struct {
	Kind   string `json:"kind"`
	Name   string `json:"name,omitempty"`
	UserID string `json:"user_id,omitempty"`
}

// createRoom は新しく作ったら 201、既存の DM を返したら 200。
func (h *chatHandlers) createRoom(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req createRoomRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	in := chat.CreateRoomInput{Kind: req.Kind, Name: req.Name}
	if req.Kind == string(authz.RoomDM) {
		if in.UserID, err = bodyUserID(req.UserID); err != nil {
			writeError(h.logger, w, r, err)
			return
		}
	}
	room, created, err := h.svc.CreateRoom(r.Context(), actorOf(r), wsID, in)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, newRoomResponse(room, true))
}

func (h *chatHandlers) listRooms(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	rooms, err := h.svc.ListRooms(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	// サイドバーの「スレッド」のバッジも同じ呼び出しで返す（ADR 0036）。ルームと同じ時点である必要はないので、別に数える。
	unreadThreads, err := h.svc.UnreadThreadCount(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := roomListResponse{Rooms: make([]roomResponse, len(rooms)), UnreadThreadCount: unreadThreads}
	for i, room := range rooms {
		resp.Rooms[i] = newRoomResponse(room, false)
	}
	writeJSON(w, http.StatusOK, resp)
}

type roomListResponse struct {
	Rooms []roomResponse `json:"rooms"`
	// UnreadThreadCount は、未読の返信がある参加中のスレッドの数（ADR 0036）。
	UnreadThreadCount int64 `json:"unread_thread_count"`
}

func (h *chatHandlers) getRoom(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	room, err := h.svc.GetRoom(r.Context(), actorOf(r), roomID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomResponse(room, true))
}

type updateRoomRequest struct {
	Name      *string `json:"name"`
	IsDefault *bool   `json:"is_default"`
}

func (h *chatHandlers) updateRoom(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req updateRoomRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	room, err := h.svc.UpdateRoom(r.Context(), actorOf(r), roomID, chat.RoomUpdate{Name: req.Name, IsDefault: req.IsDefault})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomResponse(room, true))
}

// joinRoom は public ルームに参加する。すでにメンバーでも 200 を返す。
func (h *chatHandlers) joinRoom(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	room, err := h.svc.JoinRoom(r.Context(), actorOf(r), roomID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomResponse(room, true))
}

func (h *chatHandlers) listRoomMembers(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := pageRequest(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	p, err := h.svc.ListRoomMembers(r.Context(), actorOf(r), roomID, page)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := roomMemberListResponse{Members: make([]roomMemberResponse, len(p.Items)), NextCursor: nextCursor(p.NextCursor)}
	for i, m := range p.Items {
		resp.Members[i] = roomMemberResponse{
			memberResponse{
				User: newUserProfileResponse(m.User), Role: m.Role, JoinedAt: m.JoinedAt,
				Presence: m.Presence, Away: m.Away, Status: newUserStatusResponse(m.Status),
			},
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// roomMemberResponse はルームのメンバー。role はワークスペースでのロール（ルーム単位のロールは持たない。ADR 0006）。
// 形はワークスペースのメンバー一覧と同じだが、別の型にして API ごとに独立して変えられるようにしておく。
type roomMemberResponse struct {
	memberResponse
}

type roomMemberListResponse struct {
	Members    []roomMemberResponse `json:"members"`
	NextCursor *string              `json:"next_cursor"`
}

type addRoomMemberRequest struct {
	UserID string `json:"user_id"`
}

// addRoomMember は private ルームに人を追加する。すでにメンバーでも 204 を返す。
func (h *chatHandlers) addRoomMember(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req addRoomMemberRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	target, err := bodyUserID(req.UserID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.AddRoomMember(r.Context(), actorOf(r), roomID, target); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// removeRoomMember はルームから外す。パスの userID が自分なら退出。
func (h *chatHandlers) removeRoomMember(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	target, err := pathID(r, "userID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.RemoveRoomMember(r.Context(), actorOf(r), roomID, target); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
