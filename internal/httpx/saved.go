package httpx

import (
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 「後で」（自分用の保存）の API（ADR 0054 決定 9）。ルートの登録は registerChatRoutes にまとめている。

// savedItemResponse は保存の 1 件。status が ok のときだけ room と message が入る。
// 読めないのか削除されたのかは区別しない（決定 8）。
type savedItemResponse struct {
	// ID は保存し直すたびに振り直す ULID。一覧の ?before= のカーソルに使う。
	ID string `json:"id"`
	// WorkspaceID は保存の行のワークスペース。saved.updated を受け取ったクライアントが、どの「後で」を直すかを決める。
	WorkspaceID string          `json:"workspace_id"`
	MessageID   string          `json:"message_id"`
	RoomID      string          `json:"room_id"`
	State       chat.SavedState `json:"state"`
	// ChangeSeq は本人ごとの変更番号。再接続の差分（?after_change_seq=）のカーソルに使う（決定 7）。
	ChangeSeq int64                `json:"change_seq"`
	SavedAt   time.Time            `json:"saved_at"`
	Status    chat.SavedItemStatus `json:"status"`
	Room      *linkedRoomResponse  `json:"room"`
	// Message は REST と同じメッセージの形。本人にしか届かないので、受け取る人ごとの値（me / saved）も入る。
	Message *messageResponse `json:"message"`
}

func newSavedItemResponse(it chat.SavedItem) savedItemResponse {
	resp := savedItemResponse{
		ID: it.ID.String(), WorkspaceID: it.WorkspaceID.String(), MessageID: it.MessageID.String(), RoomID: it.RoomID.String(),
		State: it.State, ChangeSeq: it.ChangeSeq, SavedAt: it.SavedAt, Status: it.Status,
	}
	if room := it.Room; room != nil {
		rr := &linkedRoomResponse{ID: room.ID.String(), Kind: room.Kind, Name: room.Name}
		if room.DMPeer != nil {
			p := newUserProfileResponse(*room.DMPeer)
			rr.DMPeer = &p
		}
		resp.Room = rr
	}
	if it.Message != nil {
		m := newMessageResponse(*it.Message)
		resp.Message = &m
	}
	return resp
}

// savedListResponse は保存の一覧か差分の 1 ページ。
type savedListResponse struct {
	Items []savedItemResponse `json:"items"`
	// InProgressCount は「進行中」のタブの件数。読めない行も数える。
	InProgressCount int64 `json:"in_progress_count"`
	// LastChangeSeq は一覧を読む直前の本人の最新の変更番号。差分のカーソルをここから始める。
	LastChangeSeq int64 `json:"last_change_seq"`
	HasMore       bool  `json:"has_more"`
}

// moveSavedRequest はタブの移動。state は in_progress / archived / completed（外すのは DELETE）。
type moveSavedRequest struct {
	State chat.SavedState `json:"state"`
}

// saveMessage はメッセージを「後で」に保存する。保存済みなら状態を変えずに 200（冪等）。
func (h *chatHandlers) saveMessage(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	messageID, err := pathID(r, "messageID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	item, err := h.svc.SaveMessage(r.Context(), actorOf(r), roomID, messageID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newSavedItemResponse(item))
}

// moveSaved は保存をタブの間で動かす。読めなくなったメッセージの保存でも動かせる。
func (h *chatHandlers) moveSaved(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	messageID, err := pathID(r, "messageID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req moveSavedRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	item, err := h.svc.MoveSaved(r.Context(), actorOf(r), wsID, messageID, req.State)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newSavedItemResponse(item))
}

// removeSaved は「後で」から外す。保存していなくても 204（冪等）。
func (h *chatHandlers) removeSaved(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	messageID, err := pathID(r, "messageID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.RemoveSaved(r.Context(), actorOf(r), wsID, messageID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// listSaved は ?state= / ?before= / ?limit= でタブの一覧、?after_change_seq= / ?limit= で再接続の差分を返す。
func (h *chatHandlers) listSaved(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var sq chat.SavedQuery
	query := r.URL.Query()
	sq.State = chat.SavedState(query.Get("state"))
	if s := query.Get("before"); s != "" {
		id, err := ulid.ParseStrict(s)
		if err != nil {
			writeError(h.logger, w, r, &errBadRequest{status: http.StatusBadRequest, detail: "before must be an ID"})
			return
		}
		sq.Before = &id
	}
	if sq.AfterChangeSeq, err = querySeq(r, "after_change_seq"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if sq.Limit, err = queryMessageLimit(r); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := h.svc.ListSaved(r.Context(), actorOf(r), wsID, sq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := savedListResponse{
		Items:           make([]savedItemResponse, len(page.Items)),
		InProgressCount: page.InProgressCount,
		LastChangeSeq:   page.LastChangeSeq,
		HasMore:         page.HasMore,
	}
	for i, it := range page.Items {
		resp.Items[i] = newSavedItemResponse(it)
	}
	writeJSON(w, http.StatusOK, resp)
}
