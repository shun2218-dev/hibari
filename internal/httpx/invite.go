package httpx

import (
	"math"
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 招待リンク（ADR 0030）。作成・一覧・取り消しと、受け取る側のプレビューと受け入れ。

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
