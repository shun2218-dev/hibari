package httpx

import (
	"net/http"
	"strings"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 手動の離席とカスタムステータス（ADR 0049）。自動で変わる presence は WebSocket から来る。

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
