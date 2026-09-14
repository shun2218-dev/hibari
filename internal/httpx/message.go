package httpx

import (
	"net/http"
	"strconv"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// メッセージの API（ロードマップ Phase 3b / ADR 0012）。ルートの登録は registerChatRoutes にまとめている。

type replyPreviewResponse struct {
	ID      string              `json:"id"`
	Seq     int64               `json:"seq"`
	Sender  userProfileResponse `json:"sender"`
	Body    string              `json:"body"`
	Deleted bool                `json:"deleted"`
}

type messageResponse struct {
	ID     string `json:"id"`
	RoomID string `json:"room_id"`
	Seq    int64  `json:"seq"`
	// ChangeSeq は同期のカーソル（ADR 0014）。表示の並びには seq を使う。
	ChangeSeq int64               `json:"change_seq"`
	Sender    userProfileResponse `json:"sender"`
	// ClientMsgID は、クライアントが楽観的に表示したメッセージと、REST / WebSocket で届いたメッセージを突き合わせるために返す（ADR 0004）。
	ClientMsgID string                `json:"client_msg_id"`
	Body        string                `json:"body"`
	ReplyTo     *replyPreviewResponse `json:"reply_to"`
	// Attachments は削除済みのメッセージでは空配列。GET URL は含めない（ADR 0013）。
	Attachments []messageAttachmentResponse `json:"attachments"`
	CreatedAt   time.Time                   `json:"created_at"`
	EditedAt    *time.Time                  `json:"edited_at"`
	DeletedAt   *time.Time                  `json:"deleted_at"`
}

func newMessageResponse(m chat.Message) messageResponse {
	resp := messageResponse{
		ID:          m.ID.String(),
		RoomID:      m.RoomID.String(),
		Seq:         m.Seq,
		ChangeSeq:   m.ChangeSeq,
		Sender:      newUserProfileResponse(m.Sender),
		ClientMsgID: m.ClientMsgID.String(),
		Body:        m.Body,
		Attachments: newMessageAttachmentsResponse(m.Attachments),
		CreatedAt:   m.CreatedAt,
		EditedAt:    m.EditedAt,
		DeletedAt:   m.DeletedAt,
	}
	if p := m.ReplyTo; p != nil {
		resp.ReplyTo = &replyPreviewResponse{ID: p.ID.String(), Seq: p.Seq, Sender: newUserProfileResponse(p.Sender), Body: p.Body, Deleted: p.Deleted}
	}
	return resp
}

// bodyID はリクエストボディの ID を読む。空なら ok が false（省略可能な項目で使う）。
func bodyID(field, s string) (id ulid.ULID, ok bool, err error) {
	if s == "" {
		return ulid.ULID{}, false, nil
	}
	id, err = ulid.ParseStrict(s)
	if err != nil {
		return ulid.ULID{}, false, &chat.ValidationError{Fields: []chat.FieldError{{Field: field, Reason: chat.ReasonInvalidFormat}}}
	}
	return id, true, nil
}

type sendMessageRequest struct {
	ClientMsgID   string   `json:"client_msg_id"`
	Body          string   `json:"body"`
	ReplyToID     string   `json:"reply_to_id"`
	AttachmentIDs []string `json:"attachment_ids"`
}

// sendMessage は新しく作ったら 201、同じ client_msg_id の再送なら既存のメッセージを 200 で返す（ADR 0004）。
func (h *chatHandlers) sendMessage(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req sendMessageRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	in := chat.SendMessageInput{Body: req.Body}
	// client_msg_id が空なら、ゼロ値のまま渡して chat の検証（required）に任せる。
	if in.ClientMsgID, _, err = bodyID("client_msg_id", req.ClientMsgID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	replyTo, ok, err := bodyID("reply_to_id", req.ReplyToID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if ok {
		in.ReplyToID = &replyTo
	}
	for _, s := range req.AttachmentIDs {
		id, err := ulid.ParseStrict(s)
		if err != nil {
			writeError(h.logger, w, r, &chat.ValidationError{Fields: []chat.FieldError{{Field: "attachment_ids", Reason: chat.ReasonInvalidFormat}}})
			return
		}
		in.AttachmentIDs = append(in.AttachmentIDs, id)
	}
	msg, created, err := h.svc.SendMessage(r.Context(), actorOf(r), roomID, in)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, newMessageResponse(msg))
}

// querySeq はクエリ文字列の seq を読む。数値として読めなければ 400（範囲の検証は chat が行う）。
func querySeq(r *http.Request, name string) (*int64, error) {
	s := r.URL.Query().Get(name)
	if s == "" {
		return nil, nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil, &errBadRequest{status: http.StatusBadRequest, detail: name + " must be an integer"}
	}
	return &v, nil
}

// listMessages は ?before_seq= / ?after_seq= / ?after_change_seq= / ?limit= で履歴を返す。
// messages は seq の昇順。after_change_seq のときだけ change_seq の昇順（再接続の差分取得。ADR 0014）。
func (h *chatHandlers) listMessages(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var mq chat.MessageQuery
	if mq.BeforeSeq, err = querySeq(r, "before_seq"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if mq.AfterSeq, err = querySeq(r, "after_seq"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if mq.AfterChangeSeq, err = querySeq(r, "after_change_seq"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if s := r.URL.Query().Get("limit"); s != "" {
		limit, err := strconv.Atoi(s)
		if err != nil || limit < 1 {
			writeError(h.logger, w, r, &errBadRequest{status: http.StatusBadRequest, detail: "limit must be a positive integer"})
			return
		}
		// 上限を超えた値は chat.ListMessages が切り詰める。
		mq.Limit = limit
	}
	page, err := h.svc.ListMessages(r.Context(), actorOf(r), roomID, mq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := struct {
		Messages []messageResponse `json:"messages"`
		HasMore  bool              `json:"has_more"`
		// LastChangeSeq はメッセージを読む前のルームの last_change_seq。クライアントは change_seq のカーソルをこの値まで進めてよい。
		LastChangeSeq int64 `json:"last_change_seq"`
	}{Messages: make([]messageResponse, len(page.Messages)), HasMore: page.HasMore, LastChangeSeq: page.LastChangeSeq}
	for i, m := range page.Messages {
		resp.Messages[i] = newMessageResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
}

type editMessageRequest struct {
	Body string `json:"body"`
}

func (h *chatHandlers) editMessage(w http.ResponseWriter, r *http.Request) {
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
	var req editMessageRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	msg, err := h.svc.EditMessage(r.Context(), actorOf(r), roomID, messageID, req.Body)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newMessageResponse(msg))
}

// deleteMessage は論理削除する。削除済みでも 204 を返す。
func (h *chatHandlers) deleteMessage(w http.ResponseWriter, r *http.Request) {
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
	if err := h.svc.DeleteMessage(r.Context(), actorOf(r), roomID, messageID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type markRoomReadRequest struct {
	Seq *int64 `json:"seq"`
}

type readStateResponse struct {
	LastReadSeq int64 `json:"last_read_seq"`
	UnreadCount int64 `json:"unread_count"`
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
	writeJSON(w, http.StatusOK, readStateResponse{LastReadSeq: st.LastReadSeq, UnreadCount: st.UnreadCount})
}
