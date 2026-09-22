package httpx

import (
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// ログイン中のデバイス（セッション）の一覧と失効（ADR 0031）。

// sessionResponse は設定画面の「ログイン中のデバイス」の 1 行。
// user_agent は保存したまま返し、「Chrome · macOS」のような表示はクライアントが作る（ADR 0019）。IP は返さない。
type sessionResponse struct {
	ID         string    `json:"id"`
	UserAgent  string    `json:"user_agent"`
	Current    bool      `json:"current"`
	StartedAt  time.Time `json:"started_at"`
	LastUsedAt time.Time `json:"last_used_at"`
}

func (h *authHandlers) listSessions(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	sessions, err := h.svc.Sessions(r.Context(), id.UserID, id.SessionID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	out := make([]sessionResponse, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, sessionResponse{
			ID:         s.ID.String(),
			UserAgent:  s.UserAgent,
			Current:    s.Current,
			StartedAt:  s.StartedAt,
			LastUsedAt: s.LastUsedAt,
		})
	}
	writeJSON(w, http.StatusOK, sessionListResponse{Sessions: out})
}

type sessionListResponse struct {
	Sessions []sessionResponse `json:"sessions"`
}

func (h *authHandlers) revokeSession(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	// 読めない ID は、存在しないセッションと同じく 404 にする（他人のセッションの存在を明かさない）。
	sessionID, err := ulid.ParseStrict(r.PathValue("sessionID"))
	if err != nil {
		writeError(h.logger, w, r, auth.ErrSessionNotFound)
		return
	}
	if err := h.svc.RevokeSession(r.Context(), id.UserID, sessionID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// revokeOtherSessions は、いま使っているセッション以外をすべて失効させる（「他のすべてのデバイスからログアウト」）。
func (h *authHandlers) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	revoked, err := h.svc.RevokeOtherSessions(r.Context(), id.UserID, id.SessionID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, revokeSessionsResponse{RevokedCount: revoked})
}

type revokeSessionsResponse struct {
	RevokedCount int `json:"revoked_count"`
}
