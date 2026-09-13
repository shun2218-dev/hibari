package httpx

import (
	"context"
	"log/slog"
	"math"
	"net/http"
	"strconv"
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
	EditMessage(ctx context.Context, actor, roomID, messageID ulid.ULID, body string) (chat.Message, error)
	DeleteMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) error
	MarkRoomRead(ctx context.Context, actor, roomID ulid.ULID, seq int64) (chat.ReadState, error)

	CreateAttachment(ctx context.Context, actor, roomID ulid.ULID, in chat.AttachmentInput) (chat.CreatedAttachment, error)
	CompleteAttachment(ctx context.Context, actor, attachmentID ulid.ULID) (chat.Attachment, error)
	GetAttachmentURL(ctx context.Context, actor, attachmentID ulid.ULID) (chat.DownloadURL, error)
}

type chatHandlers struct {
	svc    ChatService
	logger *slog.Logger
}

func registerChatRoutes(mux *http.ServeMux, d Deps) {
	h := &chatHandlers{svc: d.Chat, logger: d.Logger}
	requireAuth := authn.Require(d.Verifier, writeUnauthorized)
	handle := func(pattern string, f http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(f))
	}

	handle("POST /api/v1/workspaces", h.createWorkspace)
	handle("GET /api/v1/workspaces", h.listWorkspaces)
	handle("GET /api/v1/workspaces/{workspaceID}", h.getWorkspace)
	handle("PATCH /api/v1/workspaces/{workspaceID}", h.updateWorkspace)
	handle("GET /api/v1/workspaces/{workspaceID}/members", h.listMembers)
	handle("PATCH /api/v1/workspaces/{workspaceID}/members/{userID}", h.changeMemberRole)
	handle("DELETE /api/v1/workspaces/{workspaceID}/members/{userID}", h.removeMember)
	handle("POST /api/v1/workspaces/{workspaceID}/ownership-transfer", h.transferOwnership)

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
	handle("PATCH /api/v1/rooms/{roomID}/messages/{messageID}", h.editMessage)
	handle("DELETE /api/v1/rooms/{roomID}/messages/{messageID}", h.deleteMessage)
	handle("POST /api/v1/rooms/{roomID}/read", h.markRoomRead)

	handle("POST /api/v1/rooms/{roomID}/attachments", h.createAttachment)
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
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	InvitePolicy string `json:"invite_policy"`
	MyRole       string `json:"my_role"`
	// MemberCount は 1 件の取得でだけ返す。
	MemberCount *int64    `json:"member_count,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func newWorkspaceResponse(w chat.Workspace, withCount bool) workspaceResponse {
	resp := workspaceResponse{
		ID:           w.ID.String(),
		Slug:         w.Slug,
		Name:         w.Name,
		InvitePolicy: string(w.InvitePolicy),
		MyRole:       string(w.MyRole),
		CreatedAt:    w.CreatedAt,
		UpdatedAt:    w.UpdatedAt,
	}
	if withCount {
		resp.MemberCount = &w.MemberCount
	}
	return resp
}

type memberResponse struct {
	User     userProfileResponse `json:"user"`
	Role     string              `json:"role"`
	JoinedAt time.Time           `json:"joined_at"`
}

func newMemberResponse(m chat.Member) memberResponse {
	return memberResponse{User: newUserProfileResponse(m.User), Role: string(m.Role), JoinedAt: m.JoinedAt}
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
	resp := struct {
		Workspaces []workspaceResponse `json:"workspaces"`
	}{Workspaces: make([]workspaceResponse, len(list))}
	for i, ws := range list {
		resp.Workspaces[i] = newWorkspaceResponse(ws, false)
	}
	writeJSON(w, http.StatusOK, resp)
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
	resp := struct {
		Members    []memberResponse `json:"members"`
		NextCursor *string          `json:"next_cursor"`
	}{Members: make([]memberResponse, len(p.Items)), NextCursor: nextCursor(p.NextCursor)}
	for i, m := range p.Items {
		resp.Members[i] = newMemberResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
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
	Status      string              `json:"status"`
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
		Status:      string(inv.Status),
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
	resp := struct {
		Invites    []inviteResponse `json:"invites"`
		NextCursor *string          `json:"next_cursor"`
	}{Invites: make([]inviteResponse, len(p.Items)), NextCursor: nextCursor(p.NextCursor)}
	for i, inv := range p.Items {
		resp.Invites[i] = newInviteResponse(inv)
	}
	writeJSON(w, http.StatusOK, resp)
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
	Workspace struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		MemberCount     int64  `json:"member_count"`
		PublicRoomCount int64  `json:"public_room_count"`
	} `json:"workspace"`
	Inviter       userProfileResponse `json:"inviter"`
	AlreadyMember bool                `json:"already_member"`
	ExpiresAt     time.Time           `json:"expires_at"`
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
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Kind        string `json:"kind"`
	// Name は dm では null。
	Name      *string `json:"name"`
	IsDefault bool    `json:"is_default"`
	IsMember  bool    `json:"is_member"`
	// MemberCount は 1 件の取得でだけ返す。
	MemberCount    *int64          `json:"member_count,omitempty"`
	DMPeer         *dmPeerResponse `json:"dm_peer,omitempty"`
	LastMessageSeq int64           `json:"last_message_seq"`
	LastMessageAt  *time.Time      `json:"last_message_at"`
	// LastReadSeq はルームのメンバーでなければ null。
	LastReadSeq *int64 `json:"last_read_seq"`
	UnreadCount int64  `json:"unread_count"`
	// LastMessage はメッセージが 1 件もなければ null。
	LastMessage *lastMessageResponse `json:"last_message"`
	CreatedAt   time.Time            `json:"created_at"`
}

// dmPeerResponse は DM の相手。online は presence の初期値（ADR 0015）。
type dmPeerResponse struct {
	userProfileResponse
	Online bool `json:"online"`
}

// lastMessageResponse はサイドバーの最終メッセージ。相対時刻の表示はクライアントが created_at から作る。
type lastMessageResponse struct {
	ID        string              `json:"id"`
	Sender    userProfileResponse `json:"sender"`
	Body      string              `json:"body"`
	CreatedAt time.Time           `json:"created_at"`
	Deleted   bool                `json:"deleted"`
}

func newRoomResponse(r chat.Room, withCount bool) roomResponse {
	resp := roomResponse{
		ID:             r.ID.String(),
		WorkspaceID:    r.WorkspaceID.String(),
		Kind:           string(r.Kind),
		IsDefault:      r.IsDefault,
		IsMember:       r.IsMember,
		LastMessageSeq: r.LastMessageSeq,
		LastMessageAt:  r.LastMessageAt,
		LastReadSeq:    r.LastReadSeq,
		UnreadCount:    r.UnreadCount,
		CreatedAt:      r.CreatedAt,
	}
	if m := r.LastMessage; m != nil {
		resp.LastMessage = &lastMessageResponse{ID: m.ID.String(), Sender: newUserProfileResponse(m.Sender), Body: m.Body, CreatedAt: m.CreatedAt, Deleted: m.Deleted}
	}
	if r.Kind != authz.RoomDM {
		resp.Name = &r.Name
	}
	if withCount {
		resp.MemberCount = &r.MemberCount
	}
	if r.DMPeer != nil {
		resp.DMPeer = &dmPeerResponse{userProfileResponse: newUserProfileResponse(*r.DMPeer), Online: r.DMPeerOnline}
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

type createRoomRequest struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	UserID string `json:"user_id"`
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
	resp := struct {
		Rooms []roomResponse `json:"rooms"`
	}{Rooms: make([]roomResponse, len(rooms))}
	for i, room := range rooms {
		resp.Rooms[i] = newRoomResponse(room, false)
	}
	writeJSON(w, http.StatusOK, resp)
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
	// ワークスペースのメンバー一覧と同じ形に、presence の初期値（online）を加える（ADR 0015）。
	type roomMemberResponse struct {
		memberResponse
		Online bool `json:"online"`
	}
	resp := struct {
		Members    []roomMemberResponse `json:"members"`
		NextCursor *string              `json:"next_cursor"`
	}{Members: make([]roomMemberResponse, len(p.Items)), NextCursor: nextCursor(p.NextCursor)}
	for i, m := range p.Items {
		resp.Members[i] = roomMemberResponse{
			memberResponse: memberResponse{User: newUserProfileResponse(m.User), Role: string(m.Role), JoinedAt: m.JoinedAt},
			Online:         m.Online,
		}
	}
	writeJSON(w, http.StatusOK, resp)
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
