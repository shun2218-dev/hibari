package chat

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// ピン留め（ADR 0054）。
//
// ピン留めはルームの状態なので、リアクション（ADR 0044）と同じく**メッセージの change_seq を 1 つ進めて
// message.updated に乗せる**。専用のイベントも、専用の同期の経路も作らない。
// チャンネルにログ（システムメッセージ）は残さない。誰がピン留めしたかはメッセージの印で分かる
// （Slack の実物に合わせた。ADR 0054 決定 3 の改め）。

// MaxRoomPins はルームごとのピン留めの上限（ADR 0054 決定 4）。一覧をページングしない根拠にもなる。
const MaxRoomPins = 100

// PinMessage はメッセージをピン留めする。すでにピン留め済みなら何もせず、現在のメッセージを返す（冪等）。
func (s *Service) PinMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) (Message, error) {
	return s.changePin(ctx, actor, roomID, messageID, true)
}

// UnpinMessage はピンを外す。ピン留めされていなければ何もせず、現在のメッセージを返す（冪等）。
func (s *Service) UnpinMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) (Message, error) {
	return s.changePin(ctx, actor, roomID, messageID, false)
}

// changePin は付ける / 外すの共通の流れ。
// 「認可 → メッセージをロック → ルームの採番（rooms の行ロック）→ 上限を数える → 列を書く」の順にする。
// ロックの順序（メッセージ → rooms）は編集・削除・リアクションと同じ（ADR 0014）。
func (s *Service) changePin(ctx context.Context, actor, roomID, messageID ulid.ULID, pin bool) (Message, error) {
	var (
		msg     Message
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		// 投稿と同じく、ルームのメンバーであることを根拠に書き込むので room_members の行をロックする。
		a, err := loadRoomAccess(ctx, q, memberRowLock, roomID, actor)
		if err != nil {
			return err
		}
		if !authz.CanReadRoom(a.kind(), a.actor(actor)) {
			return ErrNotFound
		}
		if !authz.CanPinMessage(a.kind(), a.actor(actor)) {
			return ErrForbidden
		}
		m, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "lock message")
		}
		// 削除済みは「跡も残さず消えた」ものとして扱う（ADR 0038）。削除でピンも外れているので、外す側も同じ 404 にする。
		if m.DeletedAt != nil {
			return ErrNotFound
		}
		if MessageKind(m.Kind) == MessageKindSystem {
			// ログは人の発言ではない（ADR 0033）。リアクションと同じ扱い。
			var fields fieldErrors
			fields.add("message_id", ReasonInvalidValue)
			return fields.err()
		}
		// 状態が変わらないなら番号を使わない。二重クリックや再送で change_seq を無駄に進めない（決定 2）。
		if (m.PinnedAt != nil) == pin {
			msg, err = getMessage(ctx, q, roomID, actor, messageID)
			return err
		}

		// rooms の行ロックを取ってから数える。同じルームのピン留めはここで直列になるので、
		// 2 人が同時に 100 件目を付けても 101 件にはならない。超えたらロールバックで番号も戻る（決定 4）。
		changeSeq, err := q.AllocateChangeSeq(ctx, store.AllocateChangeSeqParams{RoomID: roomID, N: 1})
		if err != nil {
			return fmt.Errorf("allocate change_seq: %w", err)
		}
		var n int64
		if pin {
			count, err := q.CountRoomPins(ctx, roomID)
			if err != nil {
				return fmt.Errorf("count pins: %w", err)
			}
			if count >= MaxRoomPins {
				var fields fieldErrors
				fields.add("pinned", ReasonTooMany)
				return fields.err()
			}
			n, err = q.PinMessage(ctx, store.PinMessageParams{Now: s.clock.Now(), PinnedBy: &actor, ChangeSeq: changeSeq, ID: messageID})
			if err != nil {
				return fmt.Errorf("pin message: %w", err)
			}
		} else {
			n, err = q.UnpinMessage(ctx, store.UnpinMessageParams{ChangeSeq: changeSeq, ID: messageID})
			if err != nil {
				return fmt.Errorf("unpin message: %w", err)
			}
		}
		// メッセージの行をロックしてから状態を見ているので、ここで 0 行になることはない。
		if n != 1 {
			return fmt.Errorf("change pin: %d rows updated", n)
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
	}
	return msg, nil
}

// ListPins はルームのピン留めを、ピン留めした時刻の新しい順に返す（ADR 0054 決定 5）。
// 上限が 100 件なのでページングしない。読める人なら誰でも見られる（参加していない public も）。
func (s *Service) ListPins(ctx context.Context, actor, roomID ulid.ULID) ([]Message, error) {
	q := store.New(s.db)
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return nil, err
	}
	if !authz.CanReadRoom(a.kind(), a.actor(actor)) {
		return nil, ErrNotFound
	}
	rows, err := q.ListRoomPins(ctx, store.ListRoomPinsParams{RoomID: roomID, MaxRows: MaxRoomPins})
	if err != nil {
		return nil, fmt.Errorf("list pins: %w", err)
	}
	views := make([]messageView, len(rows))
	for i, r := range rows {
		views[i] = messageView(r)
	}
	page, err := s.finishMessagePage(ctx, q, roomID, actor, views, MessagePage{})
	if err != nil {
		return nil, err
	}
	return page.Messages, nil
}
