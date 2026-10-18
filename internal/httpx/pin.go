package httpx

import (
	"net/http"
)

// ピン留め（ADR 0054）。ルームの全員に見えるもので、「後で」（saved.go）とは別。

// pinMessage はメッセージをピン留めする。すでにピン留め済みでも 200（ADR 0054 決定 5）。
func (h *chatHandlers) pinMessage(w http.ResponseWriter, r *http.Request) {
	h.changePin(w, r, true)
}

// unpinMessage はピンを外す。ピン留めされていなくても 200（ADR 0054 決定 5）。
func (h *chatHandlers) unpinMessage(w http.ResponseWriter, r *http.Request) {
	h.changePin(w, r, false)
}

// changePin は PUT / DELETE の共通部分。リアクションと同じく、URL の形が「ピンがあること / ないこと」を表す（どちらも冪等）。
func (h *chatHandlers) changePin(w http.ResponseWriter, r *http.Request, pin bool) {
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
	act := h.svc.PinMessage
	if !pin {
		act = h.svc.UnpinMessage
	}
	msg, err := act(r.Context(), actorOf(r), roomID, messageID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newMessageResponse(msg))
}

// pinListResponse はルームのピン留めの一覧（ADR 0054 決定 5）。上限が 100 件なのでカーソルを持たない。
type pinListResponse struct {
	// Messages はピン留めした時刻の新しい順。
	Messages []messageResponse `json:"messages"`
}

// listPins はルームのピン留めを返す。読める人なら誰でも（参加していない public も）。
func (h *chatHandlers) listPins(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	msgs, err := h.svc.ListPins(r.Context(), actorOf(r), roomID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := pinListResponse{Messages: make([]messageResponse, len(msgs))}
	for i, m := range msgs {
		resp.Messages[i] = newMessageResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
}
