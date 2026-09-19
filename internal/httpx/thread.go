package httpx

import (
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
)

// スレッドの API（ADR 0036）。返信の送信・編集・削除は、メッセージの API（thread_root_id）をそのまま使う。

type threadMessageListResponse struct {
	Root     messageResponse   `json:"root"`
	Messages []messageResponse `json:"messages"`
	HasMore  bool              `json:"has_more"`
	// LastChangeSeq は返信を読む前のルームの last_change_seq（messageListResponse と同じ）。
	LastChangeSeq int64 `json:"last_change_seq"`
	// LastReadThreadSeq は自分の既読位置。スレッドに参加していなければ null。
	LastReadThreadSeq *int64 `json:"last_read_thread_seq"`
}

// listThreadMessages は ?before_seq= / ?after_seq= / ?limit= でスレッドの親と返信を返す。messages は seq の昇順。
func (h *chatHandlers) listThreadMessages(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	rootID, err := pathID(r, "rootID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var tq chat.ThreadQuery
	if tq.BeforeSeq, err = querySeq(r, "before_seq"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if tq.AfterSeq, err = querySeq(r, "after_seq"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if tq.Limit, err = queryMessageLimit(r); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := h.svc.ListThreadMessages(r.Context(), actorOf(r), roomID, rootID, tq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := threadMessageListResponse{
		Root:              newMessageResponse(page.Root),
		Messages:          make([]messageResponse, len(page.Replies)),
		HasMore:           page.HasMore,
		LastChangeSeq:     page.LastChangeSeq,
		LastReadThreadSeq: page.LastReadThreadSeq,
	}
	for i, m := range page.Replies {
		resp.Messages[i] = newMessageResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
}

type threadReadStateResponse struct {
	// Following が false なら、スレッドに参加していないので既読位置を持たない（ほかの値は 0）。
	Following         bool  `json:"following"`
	LastReadThreadSeq int64 `json:"last_read_thread_seq"`
	UnreadCount       int64 `json:"unread_count"`
}

// markThreadRead はスレッドの既読位置を、受け取った seq 以下で最後の返信まで進める。
func (h *chatHandlers) markThreadRead(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	rootID, err := pathID(r, "rootID")
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
		writeError(h.logger, w, r, &chat.ValidationError{Fields: []chat.FieldError{{Field: "seq", Reason: chat.ReasonRequired}}})
		return
	}
	st, err := h.svc.MarkThreadRead(r.Context(), actorOf(r), roomID, rootID, *req.Seq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, threadReadStateResponse{Following: st.Following, LastReadThreadSeq: st.LastReadThreadSeq, UnreadCount: st.UnreadCount})
}

// threadRoomResponse はスレッドがあるルーム。dm では name が null で、dm_peer に相手が入る。
type threadRoomResponse struct {
	ID     string               `json:"id"`
	Kind   authz.RoomKind       `json:"kind"`
	Name   *string              `json:"name"`
	DMPeer *userProfileResponse `json:"dm_peer,omitzero"`
}

type followedThreadResponse struct {
	Room threadRoomResponse `json:"room"`
	// Root は親のメッセージ。削除済みなら body は空で deleted が true。
	Root        lastMessageResponse `json:"root"`
	RootSeq     int64               `json:"root_seq"`
	ReplyCount  int64               `json:"reply_count"`
	LastReplyAt time.Time           `json:"last_reply_at"`
	// LastThreadSeq - LastReadThreadSeq = UnreadCount。クライアントは message.updated（親）と thread.read で求め直す。
	LastThreadSeq     int64 `json:"last_thread_seq"`
	LastReadThreadSeq int64 `json:"last_read_thread_seq"`
	UnreadCount       int64 `json:"unread_count"`
}

type threadListResponse struct {
	Threads    []followedThreadResponse `json:"threads"`
	NextCursor *string                  `json:"next_cursor"`
}

// listThreads は参加しているスレッドを、最後の返信が新しい順に返す（?after= / ?limit=）。
func (h *chatHandlers) listThreads(w http.ResponseWriter, r *http.Request) {
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
	p, err := h.svc.ListThreads(r.Context(), actorOf(r), wsID, page)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := threadListResponse{Threads: make([]followedThreadResponse, len(p.Items)), NextCursor: nextCursor(p.NextCursor)}
	for i, t := range p.Items {
		room := threadRoomResponse{ID: t.Room.ID.String(), Kind: t.Room.Kind}
		if t.Room.Name != "" {
			name := t.Room.Name
			room.Name = &name
		}
		if t.Room.DMPeer != nil {
			peer := newUserProfileResponse(*t.Room.DMPeer)
			room.DMPeer = &peer
		}
		resp.Threads[i] = followedThreadResponse{
			Room:              room,
			Root:              newLastMessageResponse(t.Root),
			RootSeq:           t.RootSeq,
			ReplyCount:        t.ReplyCount,
			LastReplyAt:       t.LastReplyAt,
			LastThreadSeq:     t.LastThreadSeq,
			LastReadThreadSeq: t.LastReadThreadSeq,
			UnreadCount:       t.UnreadCount,
		}
	}
	writeJSON(w, http.StatusOK, resp)
}
