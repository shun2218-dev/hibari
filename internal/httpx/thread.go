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
	// HasMore は同じ向き（around_message_id・before_seq・指定なしなら古い方、after_seq なら新しい方）にまだあるか。
	HasMore bool `json:"has_more"`
	// HasMoreAfter は新しい方にまだあるか。向きが 2 つあるのは around_message_id だけなので、それ以外では常に false（ADR 0042）。
	HasMoreAfter bool `json:"has_more_after"`
	// Around は around_message_id の対象が見つかったときだけ入る。見つからなければ null で、最新のページを返している。
	Around *messageAroundResponse `json:"around"`
	// LastChangeSeq は返信を読む前のルームの last_change_seq（messageListResponse と同じ）。
	LastChangeSeq int64 `json:"last_change_seq"`
	// LastReadThreadSeq は自分の既読位置。スレッドに参加していなければ null。
	LastReadThreadSeq *int64 `json:"last_read_thread_seq"`
	// NotifyReplies は自分の返信の通知（ADR 0056）。スレッドに参加していなければ null。
	NotifyReplies *bool `json:"notify_replies"`
}

// listThreadMessages は ?before_seq= / ?after_seq= / ?around_message_id= / ?limit= でスレッドの親と返信を返す。messages は seq の昇順。
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
	tq.AroundMessageID = queryAroundMessageID(r)
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
		HasMoreAfter:      page.HasMoreAfter,
		Around:            newMessageAroundResponse(page.Around),
		LastChangeSeq:     page.LastChangeSeq,
		LastReadThreadSeq: page.LastReadThreadSeq,
		NotifyReplies:     page.NotifyReplies,
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
	// NotifyReplies は返信の通知。オフでも一覧に残り、未読も数える（ADR 0056 決定 1・2）。
	NotifyReplies bool `json:"notify_replies"`
	// MentionCount は未読の範囲にある自分宛てのメンションの数。オフの行でも `@N` を出すため。
	MentionCount int64 `json:"mention_count"`
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
			NotifyReplies:     t.NotifyReplies,
			MentionCount:      t.MentionCount,
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// threadNotificationsRequest はスレッドの返信の通知（ADR 0056 決定 7）。true は「新しい返信の通知を受け取る」（フォローを兼ねる）。
type threadNotificationsRequest struct {
	NotifyReplies *bool `json:"notify_replies"`
}

type threadNotificationsResponse struct {
	NotifyReplies bool `json:"notify_replies"`
	// LastReadThreadSeq は参加していれば既読位置。参加していないスレッドを「オフ」にしたときは null。
	LastReadThreadSeq *int64 `json:"last_read_thread_seq"`
}

func (h *chatHandlers) setThreadNotifications(w http.ResponseWriter, r *http.Request) {
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
	var req threadNotificationsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	// 省くと「オフ」と区別がつかないので必須にする（ルームの設定の PUT と違い、値は 1 つだけ）
	if req.NotifyReplies == nil {
		writeError(h.logger, w, r, &chat.ValidationError{Fields: []chat.FieldError{{Field: "notify_replies", Reason: chat.ReasonRequired}}})
		return
	}
	got, err := h.svc.SetThreadNotifications(r.Context(), actorOf(r), roomID, rootID, *req.NotifyReplies)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, threadNotificationsResponse{NotifyReplies: got.NotifyReplies, LastReadThreadSeq: got.LastReadThreadSeq})
}
