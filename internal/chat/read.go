package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// 既読の位置（ADR 0012）。人の発言だけを数えた seq（user_seq）で未読を出す（ADR 0033）。

// ReadState は既読位置の更新の結果。
type ReadState struct {
	LastReadSeq int64
	// LastReadUserSeq は既読位置に対応する user_seq。未読数の計算に使う（ADR 0033）。
	LastReadUserSeq int64
	UnreadCount     int64
	// MentionCount は未読の範囲にある自分宛てのメンションの数（ADR 0041）。既読が進めば減る。
	MentionCount int64
}

// MarkRoomRead は actor の既読位置を seq まで進める。後退はさせず、ルームの最新の seq を超える値は最新の seq に切り詰める。
// 切り詰めるのは、クライアントが WebSocket で受け取った seq を送る間に、別の経路と前後しても失敗させないため。
func (s *Service) MarkRoomRead(ctx context.Context, actor, roomID ulid.ULID, seq int64) (ReadState, error) {
	if seq < 0 {
		return ReadState{}, &ValidationError{Fields: []FieldError{{Field: "seq", Reason: ReasonOutOfRange}}}
	}
	q := store.New(s.db)
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return ReadState{}, err
	}
	if !authz.CanMarkRoomRead(a.authzRoom(), a.actor(actor)) {
		return ReadState{}, ErrForbidden
	}
	// 1 文の UPDATE で完結するので、判定との間にルームから外されたら行が見つからない。そのときは判定の時点に合わせて拒否する。
	row, err := q.AdvanceLastReadSeq(ctx, store.AdvanceLastReadSeqParams{RoomID: roomID, UserID: actor, Seq: seq})
	if errors.Is(err, pgx.ErrNoRows) {
		return ReadState{}, ErrForbidden
	}
	if err != nil {
		return ReadState{}, fmt.Errorf("advance last_read_seq: %w", err)
	}
	// 未読はシステムメッセージを数えない（ADR 0033）。
	st := ReadState{LastReadSeq: row.LastReadSeq, LastReadUserSeq: row.LastReadUserSeq, UnreadCount: row.LastUserSeq - row.LastReadUserSeq}
	// メンションの件数は、既読位置を動かした後で数え直す（カウンタを別に持たない。ADR 0041）。
	// 数えられなくてもバッジが古くなるだけなので、既読の更新そのものは失敗させない。
	if n, err := q.CountRoomMentions(ctx, store.CountRoomMentionsParams{UserID: actor, RoomID: roomID}); err != nil {
		s.logger.WarnContext(ctx, "count room mentions failed",
			slog.String("room_id", roomID.String()), slog.Any("error", err))
	} else {
		st.MentionCount = n
	}
	// 既読位置が進まなかったときも送る。別の端末が古い未読数を表示していれば、それを揃えられる。
	s.deliver(ctx, Event{
		Type: EventRoomRead,
		To:   Audience{Users: []ulid.ULID{actor}},
		Data: RoomRead{
			WorkspaceID: a.room.WorkspaceID, RoomID: roomID,
			LastReadSeq: st.LastReadSeq, LastReadUserSeq: st.LastReadUserSeq, UnreadCount: st.UnreadCount,
			MentionCount: st.MentionCount,
		},
	})
	return st, nil
}
