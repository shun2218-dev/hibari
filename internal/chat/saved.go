package chat

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// 「後で」（自分用の保存。ADR 0054 決定 6〜10）。
//
// 保存は本人だけの状態なので、ルームの change_seq にも message.updated にも乗せない。
// 本人ごと（ワークスペース × ユーザー）の change_seq を持ち、本人宛ての saved.updated と、
// その番号の差分（after_change_seq）で別のタブ・別の端末をそろえる。
//
// 読めるかどうかは、保存したときではなく**読むたびに**閲覧者で authz を通して決める（CLAUDE.md ルール 8・9）。
// 読めなくなった行は消さずに unavailable で返す（決定 8）。

// SavedState は保存の状態。removed は「外した」で、一覧には出さないが差分では返す（決定 6）。
type SavedState string

const (
	SavedInProgress SavedState = "in_progress"
	SavedArchived   SavedState = "archived"
	SavedCompleted  SavedState = "completed"
	SavedRemoved    SavedState = "removed"
)

// SavedItemStatus は保存したメッセージを、いまの閲覧者が読めるか。
// 値が 2 つしかないのは意図したもの。読めないのか削除されたのかを区別しない（決定 8。ADR 0040 と同じ理由）。
type SavedItemStatus string

const (
	SavedItemOK          SavedItemStatus = "ok"
	SavedItemUnavailable SavedItemStatus = "unavailable"
)

const (
	// DefaultSavedLimit と MaxSavedLimit は保存の一覧の 1 回の件数（決定 9）。
	DefaultSavedLimit = 50
	MaxSavedLimit     = 100
)

// SavedItem は保存の 1 件。Status が ok のときだけ Room と Message が入る。
type SavedItem struct {
	// ID は保存し直すたびに振り直す ULID。一覧の並びとカーソルに使う。
	ID        ulid.ULID
	MessageID ulid.ULID
	RoomID    ulid.ULID
	State     SavedState
	// ChangeSeq は本人ごとの変更番号。再接続の差分のカーソルに使う（決定 7）。
	ChangeSeq int64
	SavedAt   time.Time
	Status    SavedItemStatus
	Room      *LinkedRoom
	Message   *Message
}

// SavedPage は保存の一覧か差分の 1 ページ。
type SavedPage struct {
	Items []SavedItem
	// InProgressCount は「進行中」のタブの件数（決定 9）。読めない行も数える（一覧に残るので、件数と行の数をそろえる）。
	InProgressCount int64
	// LastChangeSeq は一覧を読む直前の本人の最新の変更番号。クライアントは差分のカーソルをここから始める。
	// 一覧より先に読むので、読んでいる間に起きた変更は、これより大きい番号で必ず差分に出る。
	LastChangeSeq int64
	HasMore       bool
}

// SavedQuery は一覧の指定。AfterChangeSeq を指定したら差分（状態を問わず change_seq の順）、
// そうでなければ State のタブ（保存した新しい順。Before は前のページの最後の ID）。
type SavedQuery struct {
	State          SavedState
	Before         *ulid.ULID
	AfterChangeSeq *int64
	Limit          int
}

func savedLimit(limit int) int {
	switch {
	case limit <= 0:
		return DefaultSavedLimit
	case limit > MaxSavedLimit:
		return MaxSavedLimit
	}
	return limit
}

// SaveMessage はメッセージを「後で」に保存する（進行中にする）。
//
// 読める人なら誰でも保存できる（参加していない public ルームも。決定 9）。
// すでに保存済みなら状態を変えずに返す（冪等）。別のタブで「完了」にしたものを、保存し直しで進行中に戻さないため。
// 外した行なら、同じ行を進行中に戻して一覧の先頭に出す。
func (s *Service) SaveMessage(ctx context.Context, actor, roomID, messageID ulid.ULID) (SavedItem, error) {
	var (
		item    SavedItem
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
		if err != nil {
			return err
		}
		if !authz.CanReadRoom(a.kind(), a.actor(actor)) {
			return ErrNotFound
		}
		m, err := q.GetMessageView(ctx, store.GetMessageViewParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "get message")
		}
		// 削除済みは存在しないのと区別しない（ADR 0038）。
		if m.DeletedAt != nil {
			return ErrNotFound
		}
		if MessageKind(m.Kind) == MessageKindSystem {
			var fields fieldErrors
			fields.add("message_id", ReasonInvalidValue)
			return fields.err()
		}
		workspaceID := a.room.WorkspaceID
		if _, err := q.LockSavedCounter(ctx, store.LockSavedCounterParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
			return notFoundIfNoRows(err, "lock saved counter")
		}

		row, err := q.GetSavedMessage(ctx, store.GetSavedMessageParams{UserID: actor, MessageID: messageID})
		switch {
		case err == nil && SavedState(row.State) != SavedRemoved:
			// 保存済み。何も変えない。
		case err == nil || errors.Is(err, pgx.ErrNoRows):
			changeSeq, err2 := q.AllocateSavedChangeSeq(ctx, store.AllocateSavedChangeSeqParams{WorkspaceID: workspaceID, UserID: actor})
			if err2 != nil {
				return fmt.Errorf("allocate saved change_seq: %w", err2)
			}
			now := s.clock.Now()
			if err == nil {
				err2 = q.ResaveSavedMessage(ctx, store.ResaveSavedMessageParams{
					ID: s.ids.New(), ChangeSeq: changeSeq, Now: now, UserID: actor, MessageID: messageID,
				})
			} else {
				err2 = q.InsertSavedMessage(ctx, store.InsertSavedMessageParams{
					WorkspaceID: workspaceID, UserID: actor, MessageID: messageID, RoomID: roomID,
					ID: s.ids.New(), ChangeSeq: changeSeq, Now: now,
				})
			}
			if err2 != nil {
				return fmt.Errorf("save message: %w", err2)
			}
			changed = true
		default:
			return fmt.Errorf("get saved message: %w", err)
		}

		item, err = s.loadSavedItem(ctx, q, actor, messageID)
		return err
	})
	if err != nil {
		return SavedItem{}, err
	}
	if changed {
		s.deliver(ctx, savedUpdatedEvent(actor, item))
	}
	return item, nil
}

// MoveSaved は保存をタブの間で動かす（進行中・アーカイブ済み・完了済み）。同じ状態なら何もしない（冪等）。
//
// 読めなくなったメッセージの保存でも動かせる。本人の行を片付ける操作で、メッセージの中身には触れないため（決定 9）。
func (s *Service) MoveSaved(ctx context.Context, actor, workspaceID, messageID ulid.ULID, to SavedState) (SavedItem, error) {
	if to != SavedInProgress && to != SavedArchived && to != SavedCompleted {
		var fields fieldErrors
		fields.add("state", ReasonInvalidValue)
		return SavedItem{}, fields.err()
	}
	var (
		item    SavedItem
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		row, err := s.lockSaved(ctx, q, actor, workspaceID, messageID)
		if err != nil {
			return err
		}
		if SavedState(row.State) == SavedRemoved {
			return ErrNotFound
		}
		if SavedState(row.State) != to {
			if err := s.changeSavedState(ctx, q, actor, workspaceID, messageID, to); err != nil {
				return err
			}
			changed = true
		}
		item, err = s.loadSavedItem(ctx, q, actor, messageID)
		return err
	})
	if err != nil {
		return SavedItem{}, err
	}
	if changed {
		s.deliver(ctx, savedUpdatedEvent(actor, item))
	}
	return item, nil
}

// RemoveSaved は「後で」から外す。行は消さずに removed にする（決定 6）。外した後や、保存していなければ何もしない（冪等）。
func (s *Service) RemoveSaved(ctx context.Context, actor, workspaceID, messageID ulid.ULID) error {
	var (
		item    SavedItem
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		row, err := s.lockSaved(ctx, q, actor, workspaceID, messageID)
		if errors.Is(err, errNotSaved) {
			return nil
		}
		if err != nil {
			return err
		}
		if SavedState(row.State) == SavedRemoved {
			return nil
		}
		if err := s.changeSavedState(ctx, q, actor, workspaceID, messageID, SavedRemoved); err != nil {
			return err
		}
		changed = true
		item, err = s.loadSavedItem(ctx, q, actor, messageID)
		return err
	})
	if err != nil {
		return err
	}
	if changed {
		s.deliver(ctx, savedUpdatedEvent(actor, item))
	}
	return nil
}

// errNotSaved は、ワークスペースのメンバーだが、そのメッセージを保存したことがない。
// タブの移動では 404、外すでは冪等な成功にする。
var errNotSaved = fmt.Errorf("%w: not saved", ErrNotFound)

// lockSaved は本人の保存の変更を直列にしてから、その行を読む。
// ワークスペースのメンバーでなければ ErrNotFound、保存したことがなければ errNotSaved。
func (s *Service) lockSaved(ctx context.Context, q *store.Queries, actor, workspaceID, messageID ulid.ULID) (store.SavedMessage, error) {
	if _, err := q.LockSavedCounter(ctx, store.LockSavedCounterParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return store.SavedMessage{}, notFoundIfNoRows(err, "lock saved counter")
	}
	row, err := q.GetSavedMessage(ctx, store.GetSavedMessageParams{UserID: actor, MessageID: messageID})
	if errors.Is(err, pgx.ErrNoRows) {
		return store.SavedMessage{}, errNotSaved
	}
	if err != nil {
		return store.SavedMessage{}, fmt.Errorf("get saved message: %w", err)
	}
	// パスのワークスペースと保存の行のワークスペースが違うなら、そのワークスペースには無いものとして扱う。
	if row.WorkspaceID != workspaceID {
		return store.SavedMessage{}, errNotSaved
	}
	return row, nil
}

func (s *Service) changeSavedState(ctx context.Context, q *store.Queries, actor, workspaceID, messageID ulid.ULID, to SavedState) error {
	changeSeq, err := q.AllocateSavedChangeSeq(ctx, store.AllocateSavedChangeSeqParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return fmt.Errorf("allocate saved change_seq: %w", err)
	}
	if err := q.UpdateSavedMessageState(ctx, store.UpdateSavedMessageStateParams{
		State: string(to), ChangeSeq: changeSeq, Now: s.clock.Now(), UserID: actor, MessageID: messageID,
	}); err != nil {
		return fmt.Errorf("update saved state: %w", err)
	}
	return nil
}

// ListSaved は保存のタブの一覧か、再接続の差分を返す（決定 7・9）。
func (s *Service) ListSaved(ctx context.Context, actor, workspaceID ulid.ULID, sq SavedQuery) (SavedPage, error) {
	var fields fieldErrors
	if sq.AfterChangeSeq != nil && (sq.Before != nil || sq.State != "") {
		fields.add("after_change_seq", ReasonInvalidValue)
	}
	if sq.AfterChangeSeq != nil && *sq.AfterChangeSeq < 0 {
		fields.add("after_change_seq", ReasonInvalidValue)
	}
	if sq.State == "" {
		sq.State = SavedInProgress
	}
	if sq.State != SavedInProgress && sq.State != SavedArchived && sq.State != SavedCompleted {
		fields.add("state", ReasonInvalidValue)
	}
	if err := fields.err(); err != nil {
		return SavedPage{}, err
	}
	limit := savedLimit(sq.Limit)

	q := store.New(s.db)
	// カーソルの始まりは一覧より先に読む（SavedPage.LastChangeSeq）。0 行ならワークスペースのメンバーではない。
	last, err := q.GetLastSavedChangeSeq(ctx, store.GetLastSavedChangeSeqParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return SavedPage{}, notFoundIfNoRows(err, "get last saved change_seq")
	}
	var rows []store.SavedMessage
	if sq.AfterChangeSeq != nil {
		rows, err = q.ListSavedMessagesChangedAfter(ctx, store.ListSavedMessagesChangedAfterParams{
			WorkspaceID: workspaceID, UserID: actor, AfterChangeSeq: *sq.AfterChangeSeq, MaxRows: int32(limit + 1),
		})
	} else {
		before := maxULID
		if sq.Before != nil {
			before = *sq.Before
		}
		rows, err = q.ListSavedMessages(ctx, store.ListSavedMessagesParams{
			WorkspaceID: workspaceID, UserID: actor, State: string(sq.State), BeforeID: before, MaxRows: int32(limit + 1),
		})
	}
	if err != nil {
		return SavedPage{}, fmt.Errorf("list saved: %w", err)
	}
	page := SavedPage{LastChangeSeq: last}
	if len(rows) > limit {
		rows, page.HasMore = rows[:limit], true
	}
	if page.Items, err = s.hydrateSaved(ctx, q, actor, rows); err != nil {
		return SavedPage{}, err
	}
	if page.InProgressCount, err = q.CountSavedInProgress(ctx, store.CountSavedInProgressParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return SavedPage{}, fmt.Errorf("count saved: %w", err)
	}
	return page, nil
}

// maxULID はどの ULID よりも大きい値。最初のページのカーソルに使う（「NULL なら条件なし」と書かないのは ListMessagesBefore と同じ理由）。
var maxULID = ulid.ULID{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}

// loadSavedItem は 1 件を読み直して中身を付ける。
func (s *Service) loadSavedItem(ctx context.Context, q *store.Queries, actor, messageID ulid.ULID) (SavedItem, error) {
	row, err := q.GetSavedMessage(ctx, store.GetSavedMessageParams{UserID: actor, MessageID: messageID})
	if err != nil {
		return SavedItem{}, fmt.Errorf("get saved message: %w", err)
	}
	items, err := s.hydrateSaved(ctx, q, actor, []store.SavedMessage{row})
	if err != nil {
		return SavedItem{}, err
	}
	return items[0], nil
}

// hydrateSaved は保存の行に、閲覧者が読めるならメッセージとルームを付ける（決定 8）。
//
// 認可はルームの単位なので、同じルームの行はまとめて 1 回だけ判定し、メッセージも 1 回のクエリで読む（N+1 にしない。
// ADR 0040 のカードのまとめ取りと同じ）。removed の行は中身を付けない（差分で「外された」を伝えるだけ）。
func (s *Service) hydrateSaved(ctx context.Context, q *store.Queries, actor ulid.ULID, rows []store.SavedMessage) ([]SavedItem, error) {
	items := make([]SavedItem, len(rows))
	byRoom := map[ulid.ULID][]int{}
	for i, r := range rows {
		items[i] = SavedItem{
			ID: r.ID, MessageID: r.MessageID, RoomID: r.RoomID, State: SavedState(r.State),
			ChangeSeq: r.ChangeSeq, SavedAt: r.SavedAt, Status: SavedItemUnavailable,
		}
		if items[i].State != SavedRemoved {
			byRoom[r.RoomID] = append(byRoom[r.RoomID], i)
		}
	}

	var (
		rooms     []Room
		dmKeys    []*string
		roomIndex = map[ulid.ULID]int{}
	)
	for _, roomID := range slices.SortedFunc(maps.Keys(byRoom), ulid.ULID.Compare) {
		// いまの閲覧者で判定する。保存したときの権限をキャッシュしない（ルール 8）。
		a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
		if errors.Is(err, ErrNotFound) {
			continue // unavailable のまま
		}
		if err != nil {
			return nil, err
		}
		if !authz.CanReadRoom(a.kind(), a.actor(actor)) {
			continue
		}
		idx := byRoom[roomID]
		ids := make([]ulid.ULID, len(idx))
		for j, i := range idx {
			ids[j] = items[i].MessageID
		}
		views, err := q.ListMessageViewsByIDs(ctx, store.ListMessageViewsByIDsParams{RoomID: roomID, Ids: ids})
		if err != nil {
			return nil, fmt.Errorf("list saved messages: %w", err)
		}
		mv := make([]messageView, 0, len(views))
		for _, v := range views {
			// 削除済みとログは、読めないのと区別しない（決定 8）。
			if v.DeletedAt != nil || MessageKind(v.Kind) == MessageKindSystem {
				continue
			}
			mv = append(mv, messageView(v))
		}
		page, err := s.finishMessagePage(ctx, q, roomID, actor, mv, MessagePage{})
		if err != nil {
			return nil, err
		}
		byID := make(map[ulid.ULID]*Message, len(page.Messages))
		for k := range page.Messages {
			byID[page.Messages[k].ID] = &page.Messages[k]
		}
		found := false
		for _, i := range idx {
			if m, ok := byID[items[i].MessageID]; ok {
				items[i].Status, items[i].Message = SavedItemOK, m
				found = true
			}
		}
		if !found {
			continue
		}
		roomIndex[roomID] = len(rooms)
		name := ""
		if a.room.Name != nil {
			name = *a.room.Name
		}
		rooms = append(rooms, Room{ID: roomID, WorkspaceID: a.room.WorkspaceID, Kind: a.kind(), Name: name})
		dmKeys = append(dmKeys, a.room.DmKey)
	}
	if len(rooms) == 0 {
		return items, nil
	}
	// dm にはルーム名がないので、相手のプロフィールをまとめて引く。
	if err := attachDMPeers(ctx, q, actor, rooms, dmKeys); err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].Status != SavedItemOK {
			continue
		}
		r := rooms[roomIndex[items[i].RoomID]]
		items[i].Room = &LinkedRoom{ID: r.ID, Kind: r.Kind, Name: r.Name, DMPeer: r.DMPeer}
	}
	return items, nil
}

// loadMessageSaved は msgs に「viewer が保存しているか」を載せる（決定 10）。ページの全メッセージを 1 回で引く。
// viewer ごとの値なので、WebSocket の配信では httpx が落とす（リアクションの me と同じ）。
func loadMessageSaved(ctx context.Context, q *store.Queries, viewer ulid.ULID, msgs []Message) error {
	if len(msgs) == 0 || viewer == (ulid.ULID{}) {
		return nil
	}
	ids := make([]ulid.ULID, len(msgs))
	for i := range msgs {
		ids[i] = msgs[i].ID
	}
	saved, err := q.ListSavedMessageIDs(ctx, store.ListSavedMessageIDsParams{UserID: viewer, MessageIds: ids})
	if err != nil {
		return fmt.Errorf("list saved message ids: %w", err)
	}
	for i := range msgs {
		// 削除済みは保存の対象にならない（行が残っていても印は出さない）。
		msgs[i].Saved = msgs[i].DeletedAt == nil && slices.Contains(saved, msgs[i].ID)
	}
	return nil
}

// savedUpdatedEvent は本人のすべての接続に届ける（別のタブ・別の端末をそろえる。決定 7）。
func savedUpdatedEvent(actor ulid.ULID, item SavedItem) Event {
	return Event{Type: EventSavedUpdated, To: Audience{Users: []ulid.ULID{actor}}, Data: item}
}
