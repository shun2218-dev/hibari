package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
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
	target, err := ulid.ParseStrict(req.UserID)
	if err != nil {
		writeError(h.logger, w, r, &chat.ValidationError{Fields: []chat.FieldError{{Field: "user_id", Reason: chat.ReasonInvalidFormat}}})
		return
	}
	if err := h.svc.TransferOwnership(r.Context(), actorOf(r), wsID, target); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
