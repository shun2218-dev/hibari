package httpx

import (
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 通知の設定（ADR 0055）。ワークスペース全体の既定と、ルームごとの上書き。

// notificationLevelBody は全体の通知の設定。リクエストとレスポンスで同じ形。
type notificationLevelBody struct {
	Level chat.NotifyLevel `json:"level"`
}

func (h *chatHandlers) getNotificationLevel(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	level, err := h.svc.NotificationLevel(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, notificationLevelBody{Level: level})
}

func (h *chatHandlers) setNotificationLevel(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req notificationLevelBody
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	level, err := h.svc.SetNotificationLevel(r.Context(), actorOf(r), wsID, req.Level)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, notificationLevelBody{Level: level})
}

// roomNotificationsBody はルームごとの本人の設定（ADR 0055 決定 4）。リクエストとレスポンスで同じ形。
//
// PUT は全部の値の置き換えなので、省いた値は既定（上書きなし・ミュートなし）として扱う。
// muted_until を絶対の時刻にするのはクライアント（「明日まで」は端末のタイムゾーンで翌々日の 0:00）。
type roomNotificationsBody struct {
	// Level は null なら全体の設定に従う。DM では null だけ。
	Level      *chat.NotifyLevel `json:"level"`
	Muted      bool              `json:"muted"`
	MutedUntil *time.Time        `json:"muted_until"`
}

func newRoomNotificationsBody(n chat.RoomNotifications) roomNotificationsBody {
	return roomNotificationsBody{Level: n.Level, Muted: n.Muted, MutedUntil: n.MutedUntil}
}

func (h *chatHandlers) setRoomNotifications(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req roomNotificationsBody
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	saved, err := h.svc.SetRoomNotifications(r.Context(), actorOf(r), roomID, chat.RoomNotifications{
		Level: req.Level, Muted: req.Muted, MutedUntil: req.MutedUntil,
	})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomNotificationsBody(saved))
}
