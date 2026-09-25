package httpx

import (
	"net/http"
	"strconv"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/mention"
)

// threadSummaryResponse は親のメッセージに付く「N 件の返信」（ADR 0036）。
type threadSummaryResponse struct {
	// ReplyCount は削除されていない返信の数（表示用）。
	ReplyCount int64 `json:"reply_count"`
	// LastThreadSeq は thread_seq の採番カウンタ（減らない）。スレッドの未読数 = これ - 自分の last_read_thread_seq。
	LastThreadSeq int64     `json:"last_thread_seq"`
	LastReplyAt   time.Time `json:"last_reply_at"`
}

type messageResponse struct {
	ID     string `json:"id"`
	RoomID string `json:"room_id"`
	Seq    int64  `json:"seq"`
	// ChangeSeq は同期のカーソル（ADR 0014）。表示の並びには seq を使う。
	ChangeSeq int64 `json:"change_seq"`
	// UserSeq は人の発言だけを数えた番号。未読数の計算に使う（ADR 0033）。
	UserSeq int64               `json:"user_seq"`
	Sender  userProfileResponse `json:"sender"`
	// ClientMsgID は、クライアントが楽観的に表示したメッセージと、REST / WebSocket で届いたメッセージを突き合わせるために返す（ADR 0004）。
	ClientMsgID string `json:"client_msg_id"`
	// Kind は user（人の発言）か system（参加や名前の変更のログ。ADR 0033）。
	Kind chat.MessageKind `json:"kind"`
	// System は kind が system のときだけ入る。文言はクライアントが作る。
	System *systemEventResponse `json:"system,omitzero"`
	Body   string               `json:"body"`
	// ThreadRootID はスレッドの親の ID。チャンネルの投稿なら null（ADR 0036）。
	ThreadRootID *string `json:"thread_root_id"`
	// ThreadSeq はスレッドの中で何番目の返信か。返信だけが持つ。順序には seq を使う。
	ThreadSeq *int64 `json:"thread_seq"`
	// AlsoInChannel は「チャンネルにも投稿する」を付けた返信だけ true（ADR 0039）。
	// クライアントは thread_root_id がないか、これが true の行をチャンネルのタイムラインに並べる。
	AlsoInChannel bool `json:"also_in_channel"`
	// Thread は、返信が 1 件以上ついたことのある親だけが持つ。
	Thread *threadSummaryResponse `json:"thread"`
	// Attachments は削除済みのメッセージでは空配列。GET URL は含めない（ADR 0013）。
	Attachments []messageAttachmentResponse `json:"attachments"`
	// Mentions は本文にあるメンション（ADR 0041）。本文の出現順で、重複はない。
	// クライアントはこれを見て、本文の `<@ID>` を名前に置き換える。「自分宛てか」はクライアントが判断する
	// （配信は 1 つのペイロードを購読者に配るので、受け取る人ごとの値は載せられない。ADR 0015 / 0016）。
	Mentions []mentionResponse `json:"mentions"`
	// Reactions は付いた絵文字のリアクション（ADR 0044）。最初に付いた順で、削除済みのメッセージでは空配列。
	Reactions []messageReactionResponse `json:"reactions"`
	// LinkPreviews は外部のリンクのプレビュー（ADR 0065）。取れていて本人が消していないものだけ、本文に出てきた順。
	// 投稿の後に取れたら message.updated で届く。削除済みのメッセージでは空配列。
	LinkPreviews []linkPreviewResponse `json:"link_previews"`
	// Pinned はピン留めされているときだけ入る。されていなければ null（ADR 0054 決定 2）。
	// 見る人によらない値なので、WebSocket の配信でもそのまま載せる。
	Pinned *messagePinResponse `json:"pinned"`
	// Saved は閲覧者が「後で」に保存しているか（ADR 0054 決定 10）。**REST のレスポンスにだけ入る。**
	// リアクションの me と同じく受け取る人ごとの値なので、WebSocket の配信では落とす。
	// クライアントは saved の無い更新では手元の値を保ち、saved.updated と保存の差分で直す。
	Saved     *bool      `json:"saved,omitzero"`
	CreatedAt time.Time  `json:"created_at"`
	EditedAt  *time.Time `json:"edited_at"`
	DeletedAt *time.Time `json:"deleted_at"`
}

// messagePinResponse はメッセージのピン留め（ADR 0054 決定 2）。
type messagePinResponse struct {
	// By はピン留めした人。ID だけにしないのは sender と同じ理由（抜けた人の名前も出せるように）。
	By userProfileResponse `json:"by"`
	At time.Time           `json:"at"`
}

// mentionResponse は本文にあるメンション 1 件（ADR 0041）。
// user が入るのは kind が user のときだけで、channel / here は kind だけを持つ。
type mentionResponse struct {
	Kind mention.Kind `json:"kind"`
	// User はルームを抜けた人でも入る（名前を出せないと本文が読めないため）。存在しないユーザーの ID は、そもそも含まれない。
	User *userProfileResponse `json:"user,omitzero"`
}

func newMentionsResponse(ms []chat.Mention) []mentionResponse {
	out := make([]mentionResponse, len(ms))
	for i, m := range ms {
		out[i] = mentionResponse{Kind: m.Kind}
		if m.User != nil {
			u := newUserProfileResponse(*m.User)
			out[i].User = &u
		}
	}
	return out
}

// systemEventResponse はシステムメッセージの中身（ADR 0033）。主語は sender。
type systemEventResponse struct {
	Type chat.SystemEventType `json:"type"`
	// OldName と NewName は room_renamed だけで入る。
	OldName string `json:"old_name,omitzero"`
	NewName string `json:"new_name,omitzero"`
	// MessageID は message_pinned だけで入る。ピン留めした対象（ADR 0054 決定 3）。
	// 対象が読めるか・削除されていないかは、クライアントが手元のメッセージで判断する（ここでは判定しない）。
	MessageID string `json:"message_id,omitzero"`
}

func newSystemEventResponse(e *chat.SystemEvent) *systemEventResponse {
	if e == nil {
		return nil
	}
	resp := &systemEventResponse{Type: e.Type, OldName: e.OldName, NewName: e.NewName}
	if e.MessageID != nil {
		resp.MessageID = e.MessageID.String()
	}
	return resp
}

func newMessageResponse(m chat.Message) messageResponse {
	resp := messageResponse{
		ID:           m.ID.String(),
		RoomID:       m.RoomID.String(),
		Seq:          m.Seq,
		ChangeSeq:    m.ChangeSeq,
		UserSeq:      m.UserSeq,
		Sender:       newUserProfileResponse(m.Sender),
		ClientMsgID:  m.ClientMsgID.String(),
		Kind:         m.Kind,
		System:       newSystemEventResponse(m.System),
		Body:         m.Body,
		Attachments:  newMessageAttachmentsResponse(m.Attachments),
		Mentions:     newMentionsResponse(m.Mentions),
		Reactions:    newReactionsResponse(m.Reactions),
		LinkPreviews: newLinkPreviewsResponse(m.LinkPreviews),
		CreatedAt:    m.CreatedAt,
		EditedAt:     m.EditedAt,
		DeletedAt:    m.DeletedAt,
	}
	if m.ThreadRootID != nil {
		id := m.ThreadRootID.String()
		resp.ThreadRootID = &id
		resp.ThreadSeq = m.ThreadSeq
		resp.AlsoInChannel = m.AlsoInChannel
	}
	if t := m.Thread; t != nil {
		resp.Thread = &threadSummaryResponse{ReplyCount: t.ReplyCount, LastThreadSeq: t.LastThreadSeq, LastReplyAt: t.LastReplyAt}
	}
	if p := m.Pinned; p != nil {
		resp.Pinned = &messagePinResponse{By: newUserProfileResponse(p.By), At: p.At}
	}
	saved := m.Saved
	resp.Saved = &saved
	return resp
}

// newBroadcastMessageResponse は WebSocket で配るメッセージ（docs/events.md）。
//
// REST との違いは、リアクションの me と「後で」の saved を落とすことだけ。1 つのペイロードを購読者全員に配るので、
// 受け取る人ごとの値は入れられない（ADR 0044）。
func newBroadcastMessageResponse(m chat.Message) messageResponse {
	resp := newMessageResponse(m)
	for i := range resp.Reactions {
		resp.Reactions[i].Me = nil
	}
	resp.Saved = nil
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
	ClientMsgID  string `json:"client_msg_id"`
	Body         string `json:"body"`
	ThreadRootID string `json:"thread_root_id,omitempty"`
	// AlsoInChannel は返信をチャンネルにも出す（ADR 0039）。thread_root_id がないときに true なら 422。
	AlsoInChannel bool     `json:"also_in_channel,omitzero"`
	AttachmentIDs []string `json:"attachment_ids,omitempty"`
	// SuppressedLinkPreviewURLs は入力欄でプレビューを消した URL（ADR 0065 決定 13）。最初から消した状態で付く。5 件まで。
	SuppressedLinkPreviewURLs []string `json:"suppressed_link_preview_urls,omitempty"`
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
	in := chat.SendMessageInput{Body: req.Body, AlsoInChannel: req.AlsoInChannel, SuppressedLinkPreviewURLs: req.SuppressedLinkPreviewURLs}
	// client_msg_id が空なら、ゼロ値のまま渡して chat の検証（required）に任せる。
	if in.ClientMsgID, _, err = bodyID("client_msg_id", req.ClientMsgID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	rootID, ok, err := bodyID("thread_root_id", req.ThreadRootID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if ok {
		in.ThreadRootID = &rootID
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

// queryAroundMessageID は ?around_message_id= を読む（ADR 0042）。
// ULID として読めない文字列も、そのルームにない ID と同じ扱いにしたいので、エラーにせずゼロ値を渡す
// （400 と 200 を区別できると、メッセージの実在を外から当てられる）。
func queryAroundMessageID(r *http.Request) *ulid.ULID {
	s := r.URL.Query().Get("around_message_id")
	if s == "" {
		return nil
	}
	id, err := ulid.ParseStrict(s)
	if err != nil {
		return new(ulid.ULID)
	}
	return &id
}

// listMessages は ?before_seq= / ?after_seq= / ?after_change_seq= / ?around_message_id= / ?limit= で履歴を返す。
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
	mq.AroundMessageID = queryAroundMessageID(r)
	if mq.Limit, err = queryMessageLimit(r); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := h.svc.ListMessages(r.Context(), actorOf(r), roomID, mq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := messageListResponse{
		Messages:      make([]messageResponse, len(page.Messages)),
		HasMore:       page.HasMore,
		HasMoreAfter:  page.HasMoreAfter,
		Around:        newMessageAroundResponse(page.Around),
		LastChangeSeq: page.LastChangeSeq,
	}
	for i, m := range page.Messages {
		resp.Messages[i] = newMessageResponse(m)
	}
	writeJSON(w, http.StatusOK, resp)
}

// messageAroundResponse は around_message_id の対象がどこにあったか（ADR 0042）。
type messageAroundResponse struct {
	Seq int64 `json:"seq"`
	// ThreadRootID が入っていればスレッドの返信。クライアントはスレッドのパネルを開く。
	ThreadRootID *string `json:"thread_root_id"`
}

func newMessageAroundResponse(a *chat.MessageAround) *messageAroundResponse {
	if a == nil {
		return nil
	}
	resp := messageAroundResponse{Seq: a.Seq}
	if a.ThreadRootID != nil {
		id := a.ThreadRootID.String()
		resp.ThreadRootID = &id
	}
	return &resp
}

// queryMessageLimit は ?limit= を読む。省略なら 0（chat が既定値にする）。上限を超えた値は chat が切り詰める。
func queryMessageLimit(r *http.Request) (int, error) {
	s := r.URL.Query().Get("limit")
	if s == "" {
		return 0, nil
	}
	limit, err := strconv.Atoi(s)
	if err != nil || limit < 1 {
		return 0, &errBadRequest{status: http.StatusBadRequest, detail: "limit must be a positive integer"}
	}
	return limit, nil
}

type messageListResponse struct {
	Messages []messageResponse `json:"messages"`
	// HasMore は同じ向き（around_message_id・before_seq・指定なしなら古い方、after_seq / after_change_seq なら新しい方）にまだあるか。
	HasMore bool `json:"has_more"`
	// HasMoreAfter は新しい方にまだあるか。向きが 2 つあるのは around_message_id だけなので、それ以外では常に false（ADR 0042）。
	HasMoreAfter bool `json:"has_more_after"`
	// Around は around_message_id の対象が見つかったときだけ入る。見つからなければ null で、最新のページを返している。
	Around *messageAroundResponse `json:"around"`
	// LastChangeSeq はメッセージを読む前のルームの last_change_seq。クライアントは change_seq のカーソルをこの値まで進めてよい。
	LastChangeSeq int64 `json:"last_change_seq"`
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
