package chat

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// メッセージの読み出しの窓（ADR 0012 / 0042）。前・後・指定したメッセージの周辺を、seq のカーソルで取る。

// messageLimit は履歴の件数の指定を丸める。0 以下なら DefaultMessageLimit、MaxMessageLimit を超えたら MaxMessageLimit。
func messageLimit(limit int) int {
	switch {
	case limit <= 0:
		return DefaultMessageLimit
	case limit > MaxMessageLimit:
		return MaxMessageLimit
	}
	return limit
}

// MessageQuery は履歴の取得の指定。BeforeSeq・AfterSeq・AfterChangeSeq・AroundMessageID は 1 つまでしか指定できない。
type MessageQuery struct {
	// BeforeSeq はこの seq より古いメッセージを返す。
	BeforeSeq *int64
	// AfterSeq はこの seq より新しいメッセージを返す（ADR 0004）。
	AfterSeq *int64
	// AfterChangeSeq は、change_seq がこれより大きいメッセージ（作成・編集・削除）を change_seq の順に返す。再接続の差分取得（ADR 0014）。
	AfterChangeSeq *int64
	// AroundMessageID は、このメッセージを真ん中に置いて前後を返す（ADR 0042）。
	// 見つからなければ（ないもの・削除済み）最新のページを返し、MessagePage.Around を nil にする。
	AroundMessageID *ulid.ULID
	// Limit が 0 以下なら DefaultMessageLimit、MaxMessageLimit を超えたら MaxMessageLimit にする。
	Limit int
}

// MessagePage は履歴の 1 回分。
type MessagePage struct {
	// Messages は seq の昇順。AfterChangeSeq を指定したときだけ change_seq の昇順。
	Messages []Message
	// HasMore は、同じ向き（before_seq・around_message_id・指定なしなら古い方、after_seq / after_change_seq なら新しい方）にまだメッセージがあるか。
	HasMore bool
	// HasMoreAfter は新しい方にまだあるか。向きが 2 つあるのは AroundMessageID だけなので、それ以外では常に false（ADR 0042）。
	HasMoreAfter bool
	// Around は AroundMessageID の対象が見つかったときだけ入る。
	Around *MessageAround
	// LastChangeSeq は、メッセージを読む前に読んだルームの last_change_seq。
	// 後から読むと、一覧に含まれていない変更の番号までカーソルを進めさせてしまうので、先に読む（ADR 0014）。
	LastChangeSeq int64
}

// MessageAround は AroundMessageID の対象がどこにあったか。ThreadRootID が入っていればスレッドの返信（ADR 0042）。
type MessageAround struct {
	Seq          int64
	ThreadRootID *ulid.ULID
}

// ListMessages はルームの履歴を返す。どちらのカーソルも指定しなければ最新のメッセージを返す。ルームを読める人なら取得できる。
func (s *Service) ListMessages(ctx context.Context, actor, roomID ulid.ULID, mq MessageQuery) (MessagePage, error) {
	var fields fieldErrors
	cursors := 0
	for _, c := range []*int64{mq.BeforeSeq, mq.AfterSeq, mq.AfterChangeSeq} {
		if c != nil {
			cursors++
		}
	}
	if mq.AroundMessageID != nil {
		cursors++
	}
	if cursors > 1 {
		fields.add("before_seq", ReasonInvalidValue)
	}
	if mq.BeforeSeq != nil && *mq.BeforeSeq < 0 {
		fields.add("before_seq", ReasonOutOfRange)
	}
	if mq.AfterSeq != nil && *mq.AfterSeq < 0 {
		fields.add("after_seq", ReasonOutOfRange)
	}
	if mq.AfterChangeSeq != nil && *mq.AfterChangeSeq < 0 {
		fields.add("after_change_seq", ReasonOutOfRange)
	}
	if err := fields.err(); err != nil {
		return MessagePage{}, err
	}
	limit := messageLimit(mq.Limit)

	q := store.New(s.db)
	// ルームの行（last_change_seq を含む）は、メッセージより先に読む（MessagePage.LastChangeSeq）。
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return MessagePage{}, err
	}
	// 1 件多く読んで、続きがあるかを判定する。
	maxRows := int32(limit + 1)
	forward := mq.AfterSeq != nil || mq.AfterChangeSeq != nil
	var (
		rows []messageView
		page = MessagePage{LastChangeSeq: a.room.LastChangeSeq}
	)
	// around は前後の 2 方向を自分で組み立て、下の has_more の切り詰めを通さない。
	if mq.AroundMessageID != nil {
		var err error
		if rows, page, err = s.messagesAround(ctx, q, roomID, *mq.AroundMessageID, limit, page); err != nil {
			return MessagePage{}, err
		}
		return s.finishMessagePage(ctx, q, roomID, actor, rows, page)
	}
	switch {
	case mq.AfterChangeSeq != nil:
		changed, err := q.ListMessagesChangedAfter(ctx, store.ListMessagesChangedAfterParams{RoomID: roomID, AfterChangeSeq: *mq.AfterChangeSeq, MaxRows: maxRows})
		if err != nil {
			return MessagePage{}, fmt.Errorf("list messages changed after: %w", err)
		}
		for _, r := range changed {
			rows = append(rows, messageView(r))
		}
	case mq.AfterSeq != nil:
		after, err := q.ListMessagesAfter(ctx, store.ListMessagesAfterParams{RoomID: roomID, AfterSeq: *mq.AfterSeq, MaxRows: maxRows})
		if err != nil {
			return MessagePage{}, fmt.Errorf("list messages after: %w", err)
		}
		for _, r := range after {
			rows = append(rows, messageView(r))
		}
	default:
		before := int64(math.MaxInt64)
		if mq.BeforeSeq != nil {
			before = *mq.BeforeSeq
		}
		desc, err := q.ListMessagesBefore(ctx, store.ListMessagesBeforeParams{RoomID: roomID, BeforeSeq: before, MaxRows: maxRows})
		if err != nil {
			return MessagePage{}, fmt.Errorf("list messages before: %w", err)
		}
		// 新しい順に読んだので、昇順に並べ直す。
		for i := len(desc) - 1; i >= 0; i-- {
			rows = append(rows, messageView(desc[i]))
		}
	}

	page.HasMore = len(rows) > limit
	if page.HasMore {
		if forward {
			rows = rows[:limit] // 昇順の末尾（最も新しい 1 件）を捨てる
		} else {
			rows = rows[1:] // 昇順の先頭（最も古い 1 件）を捨てる
		}
	}
	return s.finishMessagePage(ctx, q, roomID, actor, rows, page)
}

// finishMessagePage は、読んだ行を Message にして添付とメンションを載せる。カーソルの種類によらず共通。
func (s *Service) finishMessagePage(ctx context.Context, q *store.Queries, roomID, viewer ulid.ULID, rows []messageView, page MessagePage) (MessagePage, error) {
	page.Messages = make([]Message, len(rows))
	for i, r := range rows {
		page.Messages[i] = toMessage(r)
	}
	if err := loadMessageAttachments(ctx, q, roomID, page.Messages); err != nil {
		return MessagePage{}, err
	}
	if err := loadMessageMentions(ctx, q, page.Messages); err != nil {
		return MessagePage{}, err
	}
	if err := loadMessageReactions(ctx, q, roomID, viewer, page.Messages); err != nil {
		return MessagePage{}, err
	}
	if err := loadMessageSaved(ctx, q, viewer, page.Messages); err != nil {
		return MessagePage{}, err
	}
	return page, nil
}

// messagesAround は、指定したメッセージを真ん中に置いて前後を読む（ADR 0042）。
//
// 対象が見つからない（そのルームにない・削除済み）ときは、最新のページを Around なしで返す。
// 404 にしないのは、リンクを貼るだけでメッセージの実在を当てられないようにするため（ADR 0040 と同じ方針）。
func (s *Service) messagesAround(
	ctx context.Context, q *store.Queries, roomID, messageID ulid.ULID, limit int, page MessagePage,
) ([]messageView, MessagePage, error) {
	target, err := q.GetMessageView(ctx, store.GetMessageViewParams{RoomID: roomID, ID: messageID})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, MessagePage{}, fmt.Errorf("get message view: %w", err)
	}
	if errors.Is(err, pgx.ErrNoRows) || target.DeletedAt != nil {
		rows, hasMore, err := s.messagesBefore(ctx, q, roomID, math.MaxInt64, limit)
		if err != nil {
			return nil, MessagePage{}, err
		}
		page.HasMore = hasMore
		return rows, page, nil
	}

	// 対象自身で 1 件使うので、残りを古い側と新しい側で分ける（古い側が limit / 2 の切り捨て。ADR 0042）。
	olderLimit := min(limit/2, limit-1)
	older, hasMoreBefore, err := s.messagesBefore(ctx, q, roomID, target.Seq, olderLimit)
	if err != nil {
		return nil, MessagePage{}, err
	}
	newerLimit := limit - 1 - len(older)
	newer, hasMoreAfter, err := s.messagesAfter(ctx, q, roomID, target.Seq, newerLimit)
	if err != nil {
		return nil, MessagePage{}, err
	}

	// 対象がチャンネルのタイムラインに出ない返信（ADR 0036）でも、対象自身は必ず入れる。
	rows := make([]messageView, 0, len(older)+1+len(newer))
	rows = append(rows, older...)
	rows = append(rows, messageView(target))
	rows = append(rows, newer...)

	page.HasMore = hasMoreBefore
	page.HasMoreAfter = hasMoreAfter
	page.Around = &MessageAround{Seq: target.Seq, ThreadRootID: target.ThreadRootID}
	return rows, page, nil
}

// messagesBefore は seq が beforeSeq より小さいものを昇順で最大 limit 件と、さらに古いものがあるかを返す。
func (s *Service) messagesBefore(ctx context.Context, q *store.Queries, roomID ulid.ULID, beforeSeq int64, limit int) ([]messageView, bool, error) {
	if limit <= 0 {
		// 1 件だけ読んで、続きがあるかだけを見る。
		rest, err := q.ListMessagesBefore(ctx, store.ListMessagesBeforeParams{RoomID: roomID, BeforeSeq: beforeSeq, MaxRows: 1})
		if err != nil {
			return nil, false, fmt.Errorf("list messages before: %w", err)
		}
		return nil, len(rest) > 0, nil
	}
	desc, err := q.ListMessagesBefore(ctx, store.ListMessagesBeforeParams{RoomID: roomID, BeforeSeq: beforeSeq, MaxRows: int32(limit + 1)})
	if err != nil {
		return nil, false, fmt.Errorf("list messages before: %w", err)
	}
	hasMore := len(desc) > limit
	if hasMore {
		desc = desc[:limit]
	}
	rows := make([]messageView, len(desc))
	for i, r := range desc { // 新しい順に読んだので、昇順に並べ直す
		rows[len(desc)-1-i] = messageView(r)
	}
	return rows, hasMore, nil
}

// messagesAfter は seq が afterSeq より大きいものを昇順で最大 limit 件と、さらに新しいものがあるかを返す。
func (s *Service) messagesAfter(ctx context.Context, q *store.Queries, roomID ulid.ULID, afterSeq int64, limit int) ([]messageView, bool, error) {
	if limit <= 0 {
		// 1 件だけ読んで、続きがあるかだけを見る。
		rest, err := q.ListMessagesAfter(ctx, store.ListMessagesAfterParams{RoomID: roomID, AfterSeq: afterSeq, MaxRows: 1})
		if err != nil {
			return nil, false, fmt.Errorf("list messages after: %w", err)
		}
		return nil, len(rest) > 0, nil
	}
	asc, err := q.ListMessagesAfter(ctx, store.ListMessagesAfterParams{RoomID: roomID, AfterSeq: afterSeq, MaxRows: int32(limit + 1)})
	if err != nil {
		return nil, false, fmt.Errorf("list messages after: %w", err)
	}
	hasMore := len(asc) > limit
	if hasMore {
		asc = asc[:limit]
	}
	rows := make([]messageView, len(asc))
	for i, r := range asc {
		rows[i] = messageView(r)
	}
	return rows, hasMore, nil
}
