package httpx

import (
	"net/http"
)

// ルームのメンバー（ADR 0011）。一覧・追加・削除。

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
