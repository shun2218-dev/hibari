package chat

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// ErrMessageDeleted は削除済みのメッセージを編集しようとしたことを表す。
var ErrMessageDeleted = errors.New("chat: message is deleted")

const (
	// messageBodyMax は本文の長さの上限（rune 単位。ADR 0012）。
	messageBodyMax = 4000
	// DefaultMessageLimit と MaxMessageLimit は履歴の 1 回の件数（ロードマップ Phase 3b）。
	DefaultMessageLimit = 50
	MaxMessageLimit     = 100
)

// MessageKind はメッセージの種類。system は参加や名前の変更のログ（ADR 0033）。
type MessageKind string

const (
	MessageKindUser   MessageKind = "user"
	MessageKindSystem MessageKind = "system"
)

// MessagePin はメッセージのピン留め（ADR 0054 決定 2）。見る人によらない値なので、WebSocket でもそのまま配れる。
type MessagePin struct {
	// By はピン留めした人。ID だけにしないのは sender と同じ理由（ワークスペースを抜けた人の名前も出せるように）。
	By UserProfile
	At time.Time
}

// Message はルームのメッセージ。
type Message struct {
	ID     ulid.ULID
	RoomID ulid.ULID
	// Seq は表示の順序の根拠。作成のときだけ採番する（ADR 0002）。
	Seq int64
	// ChangeSeq は最後に作成・編集・削除されたときのルームの変更番号。同期のカーソルに使う（ADR 0014）。
	ChangeSeq int64
	// UserSeq は人の発言だけを数えた番号。未読数の計算に使う（システムメッセージでは直前の値のまま。ADR 0033）。
	UserSeq     int64
	Sender      UserProfile
	ClientMsgID ulid.ULID
	// Kind は user（人の発言）か system（ログ）。
	Kind MessageKind
	// System は Kind が system のときだけ入る（ADR 0033）。
	System *SystemEvent
	// Body は削除済みなら空。システムメッセージでは常に空（文言はクライアントが作る）。
	Body string
	// ThreadRootID はスレッドの親。チャンネルの投稿なら nil（ADR 0036）。
	ThreadRootID *ulid.ULID
	// ThreadSeq はスレッドの中で何番目の返信か。返信だけが持つ。スレッドの未読に使い、順序には使わない。
	ThreadSeq *int64
	// AlsoInChannel は「チャンネルにも投稿する」を付けた返信だけ true（ADR 0039）。チャンネルの投稿では false（常にチャンネルに出るので情報がない）。
	AlsoInChannel bool
	// Thread は、返信が 1 件以上ついた親だけが持つ。
	Thread *ThreadSummary
	// Attachments は添付。削除済みのメッセージでは空（ADR 0013）。
	Attachments []MessageAttachment
	// Mentions は本文にあるメンション（ADR 0041）。本文から作るので、ルームを抜けた人も入る。件数の対象とは別（internal/chat/mention.go）。
	Mentions []Mention
	// Reactions は付いた絵文字のリアクション（ADR 0044）。最初に付いた順。削除済みのメッセージでは空。
	Reactions []MessageReaction
	// LinkPreviews は外部のリンクのプレビュー（ADR 0065）。見せるもの（取れていて、本人が消していない）だけ。削除済みでは空。
	LinkPreviews []MessageLinkPreview
	// Huddle はハドルのメッセージ（system の huddle）だけで入る（ADR 0066 決定 12）。始めた時刻・終わった時刻・一度でも入った人。
	Huddle *MessageHuddle
	// Pinned はピン留めされているときだけ入る（ADR 0054）。削除するとピンも外れるので、削除済みでは常に nil。
	Pinned *MessagePin
	// Saved は閲覧者が「後で」に保存しているか（ADR 0054 決定 10）。**受け取る人ごとの値**なので REST でしか意味を持たない。
	// WebSocket の配信では httpx が落とす（リアクションの Me と同じ）。
	Saved     bool
	CreatedAt time.Time
	EditedAt  *time.Time
	DeletedAt *time.Time
}

// ThreadSummary は親のメッセージに付く「N 件の返信」（ADR 0036）。
type ThreadSummary struct {
	// ReplyCount は削除されていない返信の数（表示用）。
	ReplyCount int64
	// LastThreadSeq は thread_seq の採番カウンタ（減らない）。未読数 = これ - 自分の既読位置。
	LastThreadSeq int64
	LastReplyAt   time.Time
}

// messageView は GetMessageView / ListMessagesBefore / ListMessagesAfter / ListMessagesChangedAfter /
// ListThreadMessagesBefore / ListThreadMessagesAfter の行。6 つのクエリの列は同じ。
type messageView = store.GetMessageViewRow

func toMessage(r messageView) Message {
	m := Message{
		ID:          r.ID,
		RoomID:      r.RoomID,
		Seq:         r.Seq,
		ChangeSeq:   r.ChangeSeq,
		UserSeq:     r.UserSeq,
		Sender:      UserProfile{ID: r.SenderID, Handle: r.SenderHandle, DisplayName: r.SenderDisplayName},
		ClientMsgID: r.ClientMsgID,
		Kind:        MessageKind(r.Kind),
		Body:        r.Body,
		CreatedAt:   r.CreatedAt,
		EditedAt:    r.EditedAt,
		DeletedAt:   r.DeletedAt,
	}
	if m.Kind == MessageKindSystem && r.SystemType != nil {
		m.System = &SystemEvent{Type: SystemEventType(*r.SystemType)}
		// system_data は種類ごとに入る値が違う。読めない値は無視して、行ごと落とさない。
		if len(r.SystemData) > 0 {
			if err := json.Unmarshal(r.SystemData, m.System); err != nil {
				m.System = &SystemEvent{Type: SystemEventType(*r.SystemType)}
			}
		}
	}
	if r.PinnedAt != nil && r.PinnedBy != nil && r.PinnedByHandle != nil && r.PinnedByDisplayName != nil {
		m.Pinned = &MessagePin{
			By: UserProfile{ID: *r.PinnedBy, Handle: *r.PinnedByHandle, DisplayName: *r.PinnedByDisplayName},
			At: *r.PinnedAt,
		}
	}
	m.ThreadRootID = r.ThreadRootID
	m.ThreadSeq = r.ThreadSeq
	m.AlsoInChannel = r.ThreadRootID != nil && r.InChannel
	// 一度でも返信がついた親だけが持つ。全部削除されて ReplyCount が 0 でも、スレッドは開けるので残す。
	if r.LastThreadSeq > 0 && r.ThreadLastReplyAt != nil {
		m.Thread = &ThreadSummary{ReplyCount: int64(r.ThreadReplyCount), LastThreadSeq: r.LastThreadSeq, LastReplyAt: *r.ThreadLastReplyAt}
	}
	return m
}

// validateBody は本文を検証する。前後の空白は削らない（コードの字下げなどを保つ）が、空白だけの本文は受け付けない。
// 添付があるメッセージ（hasAttachments）だけは、本文が空でもよい（ADR 0013）。
func validateBody(fields *fieldErrors, body string, hasAttachments bool) {
	switch {
	case strings.TrimSpace(body) == "" && !hasAttachments:
		fields.add("body", ReasonRequired)
	case utf8.RuneCountInString(body) > messageBodyMax:
		fields.add("body", ReasonTooLong)
	case strings.ContainsFunc(body, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' && r != '\r' }):
		// 改行とタブ以外の制御文字は表示を壊す。NUL は Postgres の text に保存できない。
		fields.add("body", ReasonInvalidFormat)
	}
}

// SendMessageInput はメッセージの送信の入力。
type SendMessageInput struct {
	// ClientMsgID はクライアントが生成する ULID。同じ値の再送は冪等になる（ADR 0004）。
	ClientMsgID ulid.ULID
	Body        string
	// ThreadRootID は返信するスレッドの親（同じルームの、システムメッセージでも返信でもないメッセージ。例外はハドルのメッセージ）。チャンネルへの投稿なら nil。
	ThreadRootID *ulid.ULID
	// AlsoInChannel は、返信をチャンネルのタイムラインにも出す（ADR 0039）。ThreadRootID があるときだけ指定できる。送信後は変えられない。
	AlsoInChannel bool
	// AttachmentIDs は、送信者が同じルームにアップロードして complete 済みの添付（ADR 0013）。
	AttachmentIDs []ulid.ULID
	// SuppressedLinkPreviewURLs は入力欄でプレビューを消した URL（ADR 0065 決定 13）。最初から消した状態で付く。
	SuppressedLinkPreviewURLs []string
}

// SendMessage はメッセージを送信する。同じ送信者が同じ client_msg_id で送信済みなら、created を false にして既存のメッセージを返す。
//
// 1 つのトランザクションで次の順に行う（ADR 0012）。
//  1. 送信者の room_members の行をロックしてから、投稿できるかを判定する
//  2. client_msg_id で既存のメッセージを探す。あれば何も書かずに返す
//  3. seq と change_seq を採番し（rooms の行ロック。ADR 0002 / 0014）、INSERT する
//  4. 送信者の last_read_seq を進める
//
// 1 のロックで、同じ送信者の同じルームへの送信は直列になる。同じ client_msg_id の 2 本目は 1 本目のコミットを待ってから 2 で既存を見つけるので、
// seq を採番しない（欠番を作らない）。キック・退出が先にコミットしていれば行が消えているので、1 の判定で拒否される。
//
// スレッドの返信（ThreadRootID）は sendThreadReply で、3 と 4 の代わりに親の行をロックしてから採番する（ADR 0036）。
func (s *Service) SendMessage(ctx context.Context, actor, roomID ulid.ULID, in SendMessageInput) (msg Message, created bool, err error) {
	var fields fieldErrors
	if in.ClientMsgID == (ulid.ULID{}) {
		fields.add("client_msg_id", ReasonRequired)
	}
	validateBody(&fields, in.Body, len(in.AttachmentIDs) > 0)
	validateAttachmentIDs(&fields, in.AttachmentIDs)
	validateSuppressedLinkPreviewURLs(&fields, in.SuppressedLinkPreviewURLs)
	if in.AlsoInChannel && in.ThreadRootID == nil {
		// チャンネルの投稿はもともとチャンネルに出る。黙って受け付けると、クライアントの取り違え（返信先の付け忘れ）に気づけない。
		fields.add("also_in_channel", ReasonInvalidValue)
	}
	if err := fields.err(); err != nil {
		return Message{}, false, err
	}

	// @here の対象は、トランザクションに入る前に presence から決める（ADR 0041）。
	// スレッドだけの返信でも解決する（対象の人をスレッドに参加させる。ADR 0056 決定 4）。
	all := s.resolveHere(ctx, s.logger, roomID, in.Body)

	// threadEvents は、スレッドの返信で message.created の後に届けるイベント（親の返信数、参加。ADR 0036）。
	var threadEvents []Event
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, memberRowLock, roomID, actor)
		if err != nil {
			return err
		}
		if err := a.authorize(func(r authz.Room) bool { return authz.CanWriteRoom(r, a.actor(actor)) }); err != nil {
			return err
		}

		existing, err := q.GetMessageIDByClientMsgID(ctx, store.GetMessageIDByClientMsgIDParams{RoomID: roomID, SenderID: actor, ClientMsgID: in.ClientMsgID})
		switch {
		case err == nil:
			// 再送。本文や返信先、also_in_channel が違っても比べずに既存を返す（冪等キーの一般的な扱い。ADR 0012 / 0039）。
			msg, err = getMessage(ctx, q, roomID, actor, existing)
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return fmt.Errorf("find by client_msg_id: %w", err)
		}

		if in.ThreadRootID != nil {
			msg, threadEvents, err = s.sendThreadReply(ctx, q, actor, a.room.WorkspaceID, roomID, *in.ThreadRootID, a.kind(), in, all)
			created = err == nil
			return err
		}

		now := s.clock.Now()
		allocated, err := q.AllocateMessageSeq(ctx, store.AllocateMessageSeqParams{RoomID: roomID, Now: now})
		if err != nil {
			return archivedIfNoRows(err, "allocate seq")
		}
		seq := allocated.LastMessageSeq
		id := s.ids.New()
		err = q.CreateMessage(ctx, store.CreateMessageParams{
			ID: id, RoomID: roomID, Seq: seq, ChangeSeq: allocated.LastChangeSeq,
			// user_seq は人の発言だけを数えた番号。未読数に使う（ADR 0033）。
			UserSeq: allocated.LastUserSeq, SenderID: actor, ClientMsgID: in.ClientMsgID,
			Body: in.Body, InChannel: true, Now: now,
		})
		if err != nil {
			return fmt.Errorf("create message: %w", err)
		}
		if err := attachToMessage(ctx, q, actor, roomID, id, in.AttachmentIDs); err != nil {
			return err
		}
		if err := createMessageMentions(ctx, q, now, roomID, id, in.Body, all); err != nil {
			return err
		}
		if err := s.createMessageLinkPreviews(ctx, q, roomID, id, in.Body, in.SuppressedLinkPreviewURLs); err != nil {
			return err
		}
		if _, err := q.AdvanceLastReadSeq(ctx, store.AdvanceLastReadSeqParams{RoomID: roomID, UserID: actor, Seq: seq}); err != nil {
			return fmt.Errorf("advance sender's last_read_seq: %w", err)
		}
		created = true
		msg, err = getMessage(ctx, q, roomID, actor, id)
		return err
	})
	if err != nil {
		return Message{}, false, err
	}
	// 再送（created が false）では配信しない。最初の送信で配信済みで、取りこぼしていれば差分取得で届く。
	if created {
		// 返信（change_seq が 1 つ目）を先に、親の更新（2 つ目）を後に届ける。クライアントは change_seq の順に反映できる。
		s.deliver(ctx, append([]Event{messageEvent(EventMessageCreated, msg)}, threadEvents...)...)
		s.wakeLinkPreviews(in.Body)
	}
	return msg, created, nil
}

// getMessage は 1 件を読み直す。viewer はリアクションの Me を決めるためだけに使う（ADR 0044）。
func getMessage(ctx context.Context, q *store.Queries, roomID, viewer, id ulid.ULID) (Message, error) {
	row, err := q.GetMessageView(ctx, store.GetMessageViewParams{RoomID: roomID, ID: id})
	if err != nil {
		return Message{}, notFoundIfNoRows(err, "get message")
	}
	msgs := []Message{toMessage(row)}
	if err := loadMessageAttachments(ctx, q, roomID, msgs); err != nil {
		return Message{}, err
	}
	if err := loadMessageMentions(ctx, q, msgs); err != nil {
		return Message{}, err
	}
	if err := loadMessageReactions(ctx, q, roomID, viewer, msgs); err != nil {
		return Message{}, err
	}
	if err := loadMessageHuddles(ctx, q, msgs); err != nil {
		return Message{}, err
	}
	if err := loadMessageLinkPreviews(ctx, q, roomID, msgs); err != nil {
		return Message{}, err
	}
	if err := loadMessageSaved(ctx, q, viewer, msgs); err != nil {
		return Message{}, err
	}
	return msgs[0], nil
}

// EditMessage は本文を編集する。送信者本人だけができる（ADR 0012）。本文が変わらなければ edited_at を更新しない。
func (s *Service) EditMessage(ctx context.Context, actor, roomID, messageID ulid.ULID, body string) (Message, error) {
	var fields fieldErrors
	// 編集では添付を変えられない。添付があっても、本文を空にする編集は受け付けない（ADR 0013 は送信時だけ空を許す）。
	validateBody(&fields, body, false)
	if err := fields.err(); err != nil {
		return Message{}, err
	}

	// 編集でも、本文に @here があれば対象を決め直す（presence はトランザクションの外で読む。ADR 0041）。
	// この時点ではチャンネルに出る本文かどうか分からないので、決めるだけ決めて、使うかはトランザクションの中で判断する。
	all := s.resolveHere(ctx, s.logger, roomID, body)

	var (
		msg     Message
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		// 送信と同じく、ルームのメンバーであることを根拠に書き込むので、room_members の行をロックする。
		a, err := loadRoomAccess(ctx, q, memberRowLock, roomID, actor)
		if err != nil {
			return err
		}
		m, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "lock message")
		}
		if MessageKind(m.Kind) == MessageKindSystem {
			// システムメッセージは参加や名前の変更の記録で、編集・削除の対象にしない（ADR 0033）。
			return ErrForbidden
		}
		if err := a.authorize(func(r authz.Room) bool { return authz.CanEditMessage(r, a.actor(actor), m.SenderID == actor) }); err != nil {
			return err
		}
		if m.DeletedAt != nil {
			return ErrMessageDeleted
		}
		if m.Body == body {
			// 変わらなければ change_seq も採番せず、配信もしない。
			msg, err = getMessage(ctx, q, roomID, actor, messageID)
			return err
		}
		// メッセージの行ロックの後に rooms の行ロックを取る（ADR 0014「ロックの順序」）。
		changeSeq, err := q.AllocateChangeSeq(ctx, store.AllocateChangeSeqParams{RoomID: roomID, N: 1})
		if err != nil {
			return archivedIfNoRows(err, "allocate change_seq")
		}
		now := s.clock.Now()
		if err := q.UpdateMessageBody(ctx, store.UpdateMessageBodyParams{ID: messageID, Body: body, Now: now, ChangeSeq: changeSeq}); err != nil {
			return fmt.Errorf("update message: %w", err)
		}
		// 行は常に本文と一致させる（ADR 0041）。消えたメンションは件数から消え、足したメンションは、
		// そのメッセージがまだ未読の人にだけ数えられる（既読位置より前には未読を作れない）。
		if err := q.DeleteMessageMentions(ctx, store.DeleteMessageMentionsParams{RoomID: roomID, MessageID: messageID}); err != nil {
			return fmt.Errorf("delete message mentions: %w", err)
		}
		// 編集でメンションを足しても、スレッドの参加者は増やさない（送信のときだけ。個人へのメンションもこれまでどおり）。
		// スレッドの @channel の行は、すでに参加している人にだけ数えられる。
		if err := createMessageMentions(ctx, q, now, roomID, messageID, body, all); err != nil {
			return err
		}
		// 増えた URL は取りに行き、無くなった URL のカードは消す。本人が消したカードは戻さない（ADR 0065 決定 4）
		if err := s.syncMessageLinkPreviews(ctx, q, roomID, messageID, body); err != nil {
			return err
		}
		changed = true
		msg, err = getMessage(ctx, q, roomID, actor, messageID)
		return err
	})
	if err != nil {
		return Message{}, err
	}
	if changed {
		s.deliver(ctx, messageEvent(EventMessageUpdated, msg))
		s.wakeLinkPreviews(body)
	}
	return msg, nil
}

// DeleteMessage はメッセージを論理削除する。削除済みでも成功を返す（冪等）。
// 送信者本人か、送信者を管理できる admin 以上ができる（authz.CanDeleteMessage）。
func (s *Service) DeleteMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) error {
	var deleted, root *Message
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		// 判定に送信者のロールが要るので、先に送信者を読む。見つからなくても、ルームを読めない場合と同じ 404 なので存在は漏れない。
		senderID, err := q.GetMessageSenderID(ctx, store.GetMessageSenderIDParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "get message sender")
		}
		// ロールに基づいて判定するので、actor と送信者の workspace_members を共有ロックする（ADR 0011）。
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor, senderID)
		if err != nil {
			return err
		}
		m, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "lock message")
		}
		if MessageKind(m.Kind) == MessageKindSystem {
			return ErrForbidden
		}
		if err := a.authorize(func(r authz.Room) bool {
			return authz.CanDeleteMessage(r, a.actor(actor), m.SenderID == actor, a.roles[m.SenderID])
		}); err != nil {
			return err
		}
		if m.DeletedAt != nil {
			// 削除済みへの削除は冪等な成功。change_seq を採番せず、配信もしない。
			return nil
		}
		if root, err = s.softDeleteMessage(ctx, q, roomID, actor, m); err != nil {
			return err
		}
		// 添付は掃除ジョブに消させる。ストレージの呼び出しをこのトランザクションに入れない（ADR 0013）。
		if err := q.MarkMessageAttachmentsDeleted(ctx, store.MarkMessageAttachmentsDeletedParams{RoomID: roomID, MessageID: &messageID}); err != nil {
			return fmt.Errorf("mark attachments deleted: %w", err)
		}
		// tombstone にカードは要らない。指していた取得の結果は、参照がなくなったので掃除のジョブが消す（ADR 0065 決定 10）
		if err := q.DeleteMessageLinkPreviews(ctx, messageID); err != nil {
			return fmt.Errorf("delete message link previews: %w", err)
		}
		// tombstone（本文と添付が空）を配信する。
		tombstone, err := getMessage(ctx, q, roomID, actor, messageID)
		if err != nil {
			return err
		}
		deleted = &tombstone
		return nil
	})
	if err != nil {
		return err
	}
	if deleted != nil {
		s.deliver(ctx, messageEvent(EventMessageDeleted, *deleted))
	}
	// 返信の削除では、親の返信数の変化も届ける（削除した返信の後の change_seq。ADR 0036）。
	if root != nil {
		s.deliver(ctx, messageEvent(EventMessageUpdated, *root))
	}
	return nil
}
