package chat

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/emoji"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// 絵文字のリアクション（ADR 0044）。
//
// 行を積むだけで、件数のカウンタは持たない（ADR 0041 のメンションと同じ理由）。
// 付け外しは**メッセージの change_seq を 1 つ進めて message.updated に乗せる**。
// リアクション専用のイベントも、専用の同期の経路も作らない。クライアントは
// 「メッセージが 1 回編集された」のと同じ扱いで追従できる。

// maxReactionKinds は 1 つのメッセージに付けられる絵文字の種類の上限（ADR 0044 決定 5）。
// 1 人が付けられる数は制限しない（種類の上限が実質の上限になる）。
const maxReactionKinds = 20

// MessageReaction は 1 つの絵文字ぶんの集計（ADR 0044 決定 3）。
type MessageReaction struct {
	Emoji string
	// Count は付けた人の数。行を数えた結果で、持ち越さない。
	Count int64
	// Me は閲覧者が付けているか。**受け取る人ごとの値**なので REST でしか意味を持たない。
	// WebSocket の配信は 1 つのペイロードを購読者に配るので、httpx が落とす（ADR 0015 / 0044）。
	Me bool
	// Users は付けた人の先頭 8 人（最初に付いた順）。ホバーの「A、B 他 N 人」に使う。
	// Count より少ないことがある。全員を載せるとレスポンスが人数ぶん膨らむため。
	Users []ulid.ULID
}

// AddReaction は絵文字のリアクションを付ける。すでに付いていれば何もせず、現在のメッセージを返す（冪等）。
//
// 投稿できる人だけが付けられる（ADR 0044 決定 6）。参加していない public ルームは読めるだけなので付けられない。
func (s *Service) AddReaction(ctx context.Context, actor, roomID, messageID ulid.ULID, e string) (Message, error) {
	return s.changeReaction(ctx, actor, roomID, messageID, e, true)
}

// RemoveReaction は絵文字のリアクションを外す。付いていなければ何もせず、現在のメッセージを返す（冪等）。
func (s *Service) RemoveReaction(ctx context.Context, actor, roomID, messageID ulid.ULID, e string) (Message, error) {
	return s.changeReaction(ctx, actor, roomID, messageID, e, false)
}

// changeReaction は付ける / 外すの共通の流れ。どちらも
// 「認可 → メッセージをロック → 行を足す / 消す → 変わったときだけ change_seq を進めて配信」になる。
func (s *Service) changeReaction(ctx context.Context, actor, roomID, messageID ulid.ULID, e string, add bool) (Message, error) {
	if !emoji.Valid(e) {
		var fields fieldErrors
		fields.add("emoji", ReasonInvalidValue)
		return Message{}, fields.err()
	}

	var (
		msg      Message
		changed  bool
		activity *Event
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		// 投稿と同じく、ルームのメンバーであることを根拠に書き込むので room_members の行をロックする。
		a, err := loadRoomAccess(ctx, q, memberRowLock, roomID, actor)
		if err != nil {
			return err
		}
		if !authz.CanReadRoom(a.authzRoom(), a.actor(actor)) {
			return ErrNotFound
		}
		if err := a.authorize(func(r authz.Room) bool { return authz.CanWriteRoom(r, a.actor(actor)) }); err != nil {
			return err
		}
		// メッセージの行を押さえてから種類を数える。同時に 21 種類目が入らないようにするのと、
		// rooms の行ロック（change_seq の採番）より先に取ってロックの順序をそろえるため（ADR 0014）。
		m, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "lock message")
		}
		// 削除済みは「跡も残さず消えた」ものとして扱う（ADR 0038）。存在しないのと区別しない。
		if m.DeletedAt != nil {
			return ErrNotFound
		}
		if MessageKind(m.Kind) == MessageKindSystem {
			// 参加や名前の変更のログは人の発言ではない（ADR 0033）。
			var fields fieldErrors
			fields.add("message_id", ReasonInvalidValue)
			return fields.err()
		}

		if add {
			if err := s.checkReactionKinds(ctx, q, messageID, e); err != nil {
				return err
			}
			n, err := q.AddMessageReaction(ctx, store.AddMessageReactionParams{
				RoomID: roomID, MessageID: messageID, UserID: actor, Emoji: e, Now: s.clock.Now(),
			})
			if err != nil {
				return fmt.Errorf("add reaction: %w", err)
			}
			changed = n > 0
		} else {
			n, err := q.RemoveMessageReaction(ctx, store.RemoveMessageReactionParams{MessageID: messageID, UserID: actor, Emoji: e})
			if err != nil {
				return fmt.Errorf("remove reaction: %w", err)
			}
			changed = n > 0
		}

		// 行が増減したときだけ番号を使う。二重クリックや再送で change_seq を無駄に進めない（ADR 0044 決定 2）。
		if changed {
			changeSeq, err := q.AllocateChangeSeq(ctx, store.AllocateChangeSeqParams{RoomID: roomID, N: 1})
			if err != nil {
				return archivedIfNoRows(err, "allocate change_seq")
			}
			// seq / user_seq / last_message_at は進めない。リアクションはチャンネルの発言ではないので、
			// 未読数（ADR 0033）にもサイドバーの並びにも影響しない。
			if err := q.UpdateMessageChangeSeq(ctx, store.UpdateMessageChangeSeqParams{ID: messageID, ChangeSeq: changeSeq}); err != nil {
				return fmt.Errorf("update change_seq: %w", err)
			}
			// 送信者のアクティビティにも知らせる（ADR 0058 決定 9）。message.updated には誰がいつ付けたかが載らないため
			if activity, err = s.reactionActivityEvent(ctx, q, a.room.WorkspaceID, roomID, messageID, m.SenderID, actor, e, add); err != nil {
				return err
			}
		}
		msg, err = getMessage(ctx, q, roomID, actor, messageID)
		return err
	})
	if err != nil {
		return Message{}, err
	}
	if changed {
		s.deliver(ctx, messageEvent(EventMessageUpdated, msg))
	}
	if activity != nil {
		s.deliver(ctx, *activity)
	}
	return msg, nil
}

// checkReactionKinds は、この絵文字を足すと種類の上限を超えるかを見る（ADR 0044 決定 5）。
// すでに付いている絵文字を足すぶんには種類が増えないので、上限に達していても通す。
func (s *Service) checkReactionKinds(ctx context.Context, q *store.Queries, messageID ulid.ULID, e string) error {
	kinds, err := q.CountMessageReactionKinds(ctx, messageID)
	if err != nil {
		return fmt.Errorf("count reaction kinds: %w", err)
	}
	if kinds < maxReactionKinds {
		return nil
	}
	exists, err := q.MessageReactionKindExists(ctx, store.MessageReactionKindExistsParams{MessageID: messageID, Emoji: e})
	if err != nil {
		return fmt.Errorf("check reaction kind: %w", err)
	}
	if exists {
		return nil
	}
	var fields fieldErrors
	fields.add("emoji", ReasonTooMany)
	return fields.err()
}

// loadMessageReactions は msgs に Reactions を載せる。ページの全メッセージを 1 回のクエリで集計する（N+1 にしない）。
//
// viewer は Me を決めるためだけに使う。配信のためにメッセージを作り直すときも同じ値を渡すが、
// そのときの Me は httpx が落とすので、誰を渡しても配信される JSON は変わらない。
func loadMessageReactions(ctx context.Context, q *store.Queries, roomID, viewer ulid.ULID, msgs []Message) error {
	if len(msgs) == 0 {
		return nil
	}
	ids := make([]ulid.ULID, len(msgs))
	index := make(map[ulid.ULID]int, len(msgs))
	for i := range msgs {
		msgs[i].Reactions = []MessageReaction{}
		ids[i] = msgs[i].ID
		index[msgs[i].ID] = i
	}
	rows, err := q.ListMessageReactions(ctx, store.ListMessageReactionsParams{RoomID: roomID, Viewer: viewer, MessageIds: ids})
	if err != nil {
		return fmt.Errorf("list message reactions: %w", err)
	}
	for _, r := range rows {
		i, ok := index[r.MessageID]
		if !ok {
			continue
		}
		// 削除済みのメッセージには跡を残さない（ADR 0038）。行が残っていても出さない。
		if msgs[i].DeletedAt != nil {
			continue
		}
		msgs[i].Reactions = append(msgs[i].Reactions, MessageReaction{
			Emoji: r.Emoji, Count: r.ReactionCount, Me: r.ReactedByViewer, Users: r.UserIds,
		})
	}
	return nil
}
