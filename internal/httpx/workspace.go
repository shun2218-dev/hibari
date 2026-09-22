package httpx

import (
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
)

// ワークスペース（ADR 0006）。作成・一覧・1 件・設定の更新。

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
