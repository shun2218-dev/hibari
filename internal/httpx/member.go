package httpx

import (
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
)

// ワークスペースのメンバー（ADR 0011）。一覧・プロフィール（ADR 0050）・ロールの変更・キック・オーナーの譲渡。

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

func newMemberResponse(m chat.Member) memberResponse {
	return memberResponse{
		User: newUserProfileResponse(m.User), Role: m.Role, JoinedAt: m.JoinedAt,
		Presence: m.Presence, Away: m.Away, Status: newUserStatusResponse(m.Status),
	}
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
