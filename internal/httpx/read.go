package httpx

import (
	"net/http"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 既読の位置（ADR 0012）。seq までを読んだことにし、未読の件数を返す。

type markRoomReadRequest struct {
	Seq *int64 `json:"seq"`
}

type readStateResponse struct {
	LastReadSeq int64 `json:"last_read_seq"`
	// LastReadUserSeq は既読位置に対応する user_seq。クライアントが未読数を求め直すのに使う（ADR 0033）。
	LastReadUserSeq int64 `json:"last_read_user_seq"`
	UnreadCount     int64 `json:"unread_count"`
	// MentionCount は既読を進めた後の、自分宛ての未読のメンションの数（ADR 0041）。
	MentionCount int64 `json:"mention_count"`
}

// markRoomRead は既読位置を進め、切り詰めた後の既読位置と未読数を返す。
func (h *chatHandlers) markRoomRead(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req markRoomReadRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if req.Seq == nil {
		// 省略を 0 として扱うと、書き忘れが「何も起きない成功」になって気付けないので、必須にする。
		writeError(h.logger, w, r, &chat.ValidationError{Fields: []chat.FieldError{{Field: "seq", Reason: chat.ReasonRequired}}})
		return
	}
	st, err := h.svc.MarkRoomRead(r.Context(), actorOf(r), roomID, *req.Seq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, readStateResponse{
		LastReadSeq: st.LastReadSeq, LastReadUserSeq: st.LastReadUserSeq, UnreadCount: st.UnreadCount,
		MentionCount: st.MentionCount,
	})
}
