package chat

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// スレッド（ADR 0036）。返信はルームの seq / change_seq をそのまま使い、チャンネルのタイムラインには出さない。
// チャンネルの未読（user_seq）には数えず、スレッドの未読は thread_seq で数える。

// errInvalidThreadRoot は、返信先に指定できないメッセージ（存在しない・別のルーム・システムメッセージ・返信）を指定したことを表す。
func errInvalidThreadRoot() error {
	return &ValidationError{Fields: []FieldError{{Field: "thread_root_id", Reason: ReasonInvalidValue}}}
}

// isThreadRoot は、そのメッセージがスレッドの親になれるかを返す。入れ子（返信への返信）とシステムメッセージの親は作らない。
func isThreadRoot(kind string, threadRootID *ulid.ULID) bool {
	return MessageKind(kind) == MessageKindUser && threadRootID == nil
}

// sendThreadReply は SendMessage の中で、スレッドに返信する（手順 1・2 の判定と冪等性の確認は済んでいる）。
// 返信のほかに、コミットの後に届けるイベント（親の返信数の message.updated と、新しく参加した人への thread.followed）を返す。
//
// ロックの順序は room_members（済み）→ 親のメッセージ → rooms → thread_members。
// 編集・削除の「room_members → メッセージ → rooms」と同じ向きにそろえる。rooms を持ったまま親を待つと、親の編集とデッドロックする。
func (s *Service) sendThreadReply(ctx context.Context, q *store.Queries, actor, workspaceID, roomID, rootID ulid.ULID, in SendMessageInput) (Message, []Event, error) {
	root, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: rootID})
	if errors.Is(err, pgx.ErrNoRows) {
		// 別のルームのメッセージも、存在しない ID と同じく見つからない。
		return Message{}, nil, errInvalidThreadRoot()
	}
	if err != nil {
		return Message{}, nil, fmt.Errorf("lock thread root: %w", err)
	}
	if !isThreadRoot(root.Kind, root.ThreadRootID) {
		return Message{}, nil, errInvalidThreadRoot()
	}
	// 削除済みの親にも返信できる。削除と返信は並行して起きうるので、拒んでも結局生まれる（ADR 0012 の返信と同じ）。

	now := s.clock.Now()
	allocated, err := q.AllocateThreadReplySeq(ctx, roomID)
	if err != nil {
		return Message{}, nil, fmt.Errorf("allocate thread reply seq: %w", err)
	}
	// change_seq は 2 つ採番した。返信が 1 つ目、親（返信数の変化）が 2 つ目。
	replyChangeSeq, rootChangeSeq := allocated.LastChangeSeq-1, allocated.LastChangeSeq
	threadSeq, err := q.AddThreadReply(ctx, store.AddThreadReplyParams{ID: rootID, Now: now, ChangeSeq: rootChangeSeq})
	if err != nil {
		return Message{}, nil, fmt.Errorf("add thread reply: %w", err)
	}
	id := s.ids.New()
	err = q.CreateMessage(ctx, store.CreateMessageParams{
		ID: id, RoomID: roomID, Seq: allocated.LastMessageSeq, ChangeSeq: replyChangeSeq,
		// チャンネルの未読には数えないので、user_seq は進めずに直前の値を入れる。
		UserSeq: allocated.LastUserSeq, SenderID: actor, ClientMsgID: in.ClientMsgID,
		Body: in.Body, ThreadRootID: &rootID, ThreadSeq: &threadSeq, Now: now,
	})
	if err != nil {
		return Message{}, nil, fmt.Errorf("create thread reply: %w", err)
	}
	if err := attachToMessage(ctx, q, actor, roomID, id, in.AttachmentIDs); err != nil {
		return Message{}, nil, err
	}

	// 返信した人はスレッドに参加し、自分の返信まで既読にする。チャンネルの既読位置は動かさない（返信はチャンネルに出ていない）。
	var events []Event
	followed, err := q.FollowThread(ctx, store.FollowThreadParams{ThreadRootID: rootID, LastReadThreadSeq: threadSeq, Now: now, RoomID: roomID, UserID: actor})
	if err != nil {
		return Message{}, nil, fmt.Errorf("follow thread: %w", err)
	}
	if followed == 1 {
		events = append(events, threadFollowedEvent(workspaceID, roomID, rootID, actor, threadSeq))
	} else {
		if err := q.AdvanceThreadReadToThreadSeq(ctx, store.AdvanceThreadReadToThreadSeqParams{ThreadSeq: threadSeq, ThreadRootID: rootID, UserID: actor}); err != nil {
			return Message{}, nil, fmt.Errorf("advance thread read: %w", err)
		}
	}
	// 親の投稿者は、最初の返信で参加する（既読位置 0 なので、その返信が未読になる）。
	// ルームを抜けていれば FollowThread は何もしない。2 件目以降で入れないのは、抜けて戻った人の過去の返信を全部未読にしないため。
	if threadSeq == 1 && root.SenderID != actor {
		n, err := q.FollowThread(ctx, store.FollowThreadParams{ThreadRootID: rootID, LastReadThreadSeq: 0, Now: now, RoomID: roomID, UserID: root.SenderID})
		if err != nil {
			return Message{}, nil, fmt.Errorf("follow thread by root sender: %w", err)
		}
		if n == 1 {
			events = append(events, threadFollowedEvent(workspaceID, roomID, rootID, root.SenderID, 0))
		}
	}
	reply, err := getMessage(ctx, q, roomID, id)
	if err != nil {
		return Message{}, nil, err
	}
	updatedRoot, err := getMessage(ctx, q, roomID, rootID)
	if err != nil {
		return Message{}, nil, err
	}
	// 親の返信数の変化は、参加より先に届ける（ルームの購読者全員に関係する）。
	return reply, append([]Event{messageEvent(EventMessageUpdated, updatedRoot)}, events...), nil
}

// softDeleteMessage は DeleteMessage の中で、ロック済みのメッセージ m を論理削除する。
// スレッドの返信なら、親の行もロックして返信数を減らし、親の change_seq も進める（返信数の変化を同期に載せる。ADR 0036）。
// そのときは、配信する更新後の親を返す（返信でなければ nil）。
// ロックの順序は 返信 → 親 → rooms。返信の送信（親 → rooms）とは、親より先に取るロックが重ならないのでデッドロックしない。
func (s *Service) softDeleteMessage(ctx context.Context, q *store.Queries, roomID ulid.ULID, m store.Message) (*Message, error) {
	if m.ThreadRootID != nil {
		if _, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: *m.ThreadRootID}); err != nil {
			return nil, fmt.Errorf("lock thread root: %w", err)
		}
	}
	n := int64(1)
	if m.ThreadRootID != nil {
		n = 2
	}
	last, err := q.AllocateChangeSeq(ctx, store.AllocateChangeSeqParams{RoomID: roomID, N: n})
	if err != nil {
		return nil, fmt.Errorf("allocate change_seq: %w", err)
	}
	// 返信の削除では、削除した返信が 1 つ目、親が 2 つ目の番号を使う（送信と同じ並び）。
	if err := q.SoftDeleteMessage(ctx, store.SoftDeleteMessageParams{ID: m.ID, Now: s.clock.Now(), ChangeSeq: last - n + 1}); err != nil {
		return nil, fmt.Errorf("delete message: %w", err)
	}
	if m.ThreadRootID == nil {
		return nil, nil
	}
	if err := q.RemoveThreadReply(ctx, store.RemoveThreadReplyParams{ID: *m.ThreadRootID, ChangeSeq: last}); err != nil {
		return nil, fmt.Errorf("remove thread reply: %w", err)
	}
	root, err := getMessage(ctx, q, roomID, *m.ThreadRootID)
	if err != nil {
		return nil, err
	}
	return &root, nil
}

// ThreadQuery はスレッドの返信の取得の指定。BeforeSeq と AfterSeq は 1 つまでしか指定できない。
type ThreadQuery struct {
	BeforeSeq *int64
	AfterSeq  *int64
	// Limit が 0 以下なら DefaultMessageLimit、MaxMessageLimit を超えたら MaxMessageLimit にする。
	Limit int
}

// ThreadPage はスレッドの 1 回分。
type ThreadPage struct {
	// Root は親のメッセージ。削除済みなら tombstone。
	Root Message
	// Replies は seq の昇順。
	Replies []Message
	// HasMore は、同じ向き（after_seq なら新しい方、それ以外は古い方）にまだ返信があるか。
	HasMore bool
	// LastChangeSeq は、返信を読む前に読んだルームの last_change_seq（MessagePage.LastChangeSeq と同じ）。
	LastChangeSeq int64
	// LastReadThreadSeq は actor の既読位置。スレッドに参加していなければ nil。
	LastReadThreadSeq *int64
}

// ListThreadMessages はスレッドの親と返信を返す。ルームを読める人なら取得できる（スレッドのための権限は持たない。ADR 0036）。
// rootID がこのルームのスレッドの親になれないメッセージ（返信・システムメッセージ）なら ErrNotFound。
func (s *Service) ListThreadMessages(ctx context.Context, actor, roomID, rootID ulid.ULID, tq ThreadQuery) (ThreadPage, error) {
	var fields fieldErrors
	if tq.BeforeSeq != nil && tq.AfterSeq != nil {
		fields.add("before_seq", ReasonInvalidValue)
	}
	if tq.BeforeSeq != nil && *tq.BeforeSeq < 0 {
		fields.add("before_seq", ReasonOutOfRange)
	}
	if tq.AfterSeq != nil && *tq.AfterSeq < 0 {
		fields.add("after_seq", ReasonOutOfRange)
	}
	if err := fields.err(); err != nil {
		return ThreadPage{}, err
	}
	limit := messageLimit(tq.Limit)

	q := store.New(s.db)
	// ルームの行（last_change_seq）は返信より先に読む（ADR 0014）。
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return ThreadPage{}, err
	}
	root, err := getMessage(ctx, q, roomID, rootID)
	if err != nil {
		return ThreadPage{}, err
	}
	if !isThreadRoot(string(root.Kind), root.ThreadRootID) {
		return ThreadPage{}, ErrNotFound
	}

	maxRows := int32(limit + 1)
	var rows []messageView
	if tq.AfterSeq != nil {
		after, err := q.ListThreadMessagesAfter(ctx, store.ListThreadMessagesAfterParams{ThreadRootID: &rootID, AfterSeq: *tq.AfterSeq, MaxRows: maxRows})
		if err != nil {
			return ThreadPage{}, fmt.Errorf("list thread messages after: %w", err)
		}
		for _, r := range after {
			rows = append(rows, messageView(r))
		}
	} else {
		before := int64(math.MaxInt64)
		if tq.BeforeSeq != nil {
			before = *tq.BeforeSeq
		}
		desc, err := q.ListThreadMessagesBefore(ctx, store.ListThreadMessagesBeforeParams{ThreadRootID: &rootID, BeforeSeq: before, MaxRows: maxRows})
		if err != nil {
			return ThreadPage{}, fmt.Errorf("list thread messages before: %w", err)
		}
		for i := len(desc) - 1; i >= 0; i-- {
			rows = append(rows, messageView(desc[i]))
		}
	}

	page := ThreadPage{Root: root, HasMore: len(rows) > limit, LastChangeSeq: a.room.LastChangeSeq}
	if page.HasMore {
		if tq.AfterSeq != nil {
			rows = rows[:limit]
		} else {
			rows = rows[1:]
		}
	}
	page.Replies = make([]Message, len(rows))
	for i, r := range rows {
		page.Replies[i] = toMessage(r)
	}
	if err := loadMessageAttachments(ctx, q, roomID, page.Replies); err != nil {
		return ThreadPage{}, err
	}
	lastRead, err := q.GetThreadMembership(ctx, store.GetThreadMembershipParams{ThreadRootID: rootID, UserID: actor})
	switch {
	case err == nil:
		page.LastReadThreadSeq = &lastRead
	case !errors.Is(err, pgx.ErrNoRows):
		return ThreadPage{}, fmt.Errorf("get thread membership: %w", err)
	}
	return page, nil
}

// ThreadReadState はスレッドの既読位置の更新の結果。
type ThreadReadState struct {
	// Following は actor がスレッドに参加しているか。参加していなければ既読位置を持たない（ほかの値は 0）。
	Following         bool
	LastReadThreadSeq int64
	UnreadCount       int64
}

// MarkThreadRead は actor のスレッドの既読位置を、seq 以下で最後の返信まで進める（後退させない）。
// スレッドに参加していなければ何もせず、Following を false にして返す（参加していないスレッドを開くのは普通のことなので、エラーにしない）。
func (s *Service) MarkThreadRead(ctx context.Context, actor, roomID, rootID ulid.ULID, seq int64) (ThreadReadState, error) {
	if seq < 0 {
		return ThreadReadState{}, &ValidationError{Fields: []FieldError{{Field: "seq", Reason: ReasonOutOfRange}}}
	}
	q := store.New(s.db)
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return ThreadReadState{}, err
	}
	if !authz.CanMarkRoomRead(a.kind(), a.actor(actor)) {
		return ThreadReadState{}, ErrForbidden
	}
	root, err := q.GetMessageView(ctx, store.GetMessageViewParams{RoomID: roomID, ID: rootID})
	if err != nil {
		return ThreadReadState{}, notFoundIfNoRows(err, "get thread root")
	}
	if !isThreadRoot(root.Kind, root.ThreadRootID) {
		return ThreadReadState{}, ErrNotFound
	}
	row, err := q.AdvanceThreadRead(ctx, store.AdvanceThreadReadParams{Seq: seq, ThreadRootID: rootID, UserID: actor})
	if errors.Is(err, pgx.ErrNoRows) {
		return ThreadReadState{}, nil
	}
	if err != nil {
		return ThreadReadState{}, fmt.Errorf("advance thread read: %w", err)
	}
	st := ThreadReadState{Following: true, LastReadThreadSeq: row.LastReadThreadSeq, UnreadCount: row.LastThreadSeq - row.LastReadThreadSeq}
	// 既読位置が進まなかったときも送る。別の端末が古い未読数を表示していれば、それを揃えられる（room.read と同じ）。
	s.deliver(ctx, Event{
		Type: EventThreadRead,
		To:   Audience{Users: []ulid.ULID{actor}},
		Data: ThreadRead{
			WorkspaceID: a.room.WorkspaceID, RoomID: roomID, ThreadRootID: rootID,
			LastReadThreadSeq: st.LastReadThreadSeq, UnreadCount: st.UnreadCount,
		},
	})
	return st, nil
}

// FollowedThread は参加しているスレッドの一覧の 1 件。
type FollowedThread struct {
	Room FollowedThreadRoom
	// Root は親のメッセージ。削除済みなら Body は空で Deleted が true。
	Root        MessagePreview
	RootSeq     int64
	ReplyCount  int64
	LastReplyAt time.Time
	// UnreadCount は親の last_thread_seq - 自分の既読位置。削除された返信も数える近似（ADR 0036）。
	UnreadCount int64
}

// FollowedThreadRoom はスレッドがあるルーム。
type FollowedThreadRoom struct {
	ID   ulid.ULID
	Kind RoomKind
	// Name は public / private の名前。dm では空で、DMPeer に相手が入る。
	Name   string
	DMPeer *UserProfile
}

// ListThreads は actor が参加しているワークスペースのスレッドを、最後の返信が新しい順に返す（ADR 0036）。
// page.After は前のページの最後の親の ID。
func (s *Service) ListThreads(ctx context.Context, actor, workspaceID ulid.ULID, page PageRequest) (Page[FollowedThread], error) {
	q := store.New(s.db)
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return Page[FollowedThread]{}, notFoundIfNoRows(err, "get role")
	}
	limit := page.limit()
	var after *ulid.ULID
	if page.After != (ulid.ULID{}) {
		after = &page.After
	}
	rows, err := q.ListFollowedThreads(ctx, store.ListFollowedThreadsParams{UserID: actor, WorkspaceID: workspaceID, After: after, MaxRows: int32(limit + 1)})
	if err != nil {
		return Page[FollowedThread]{}, fmt.Errorf("list followed threads: %w", err)
	}

	// dm の相手のプロフィールはまとめて引く（N+1 にしない）。
	peers := map[ulid.ULID]ulid.ULID{}
	var peerIDs []ulid.ULID
	for _, r := range rows {
		if r.RoomDmKey == nil {
			continue
		}
		peer, err := dmPeerID(*r.RoomDmKey, actor)
		if err != nil {
			return Page[FollowedThread]{}, err
		}
		peers[r.RoomID] = peer
		peerIDs = append(peerIDs, peer)
	}
	profiles := map[ulid.ULID]UserProfile{}
	if len(peerIDs) > 0 {
		ps, err := q.ListUserProfiles(ctx, peerIDs)
		if err != nil {
			return Page[FollowedThread]{}, fmt.Errorf("list dm peers: %w", err)
		}
		for _, p := range ps {
			profiles[p.ID] = UserProfile{ID: p.ID, Handle: p.Handle, DisplayName: p.DisplayName}
		}
	}

	items := make([]FollowedThread, len(rows))
	for i, r := range rows {
		room := FollowedThreadRoom{ID: r.RoomID, Kind: RoomKind(r.RoomKind)}
		if r.RoomName != nil {
			room.Name = *r.RoomName
		}
		if peer, ok := peers[r.RoomID]; ok {
			p := profiles[peer]
			room.DMPeer = &p
		}
		t := FollowedThread{
			Room: room,
			Root: MessagePreview{
				ID:        r.ID,
				Sender:    UserProfile{ID: r.SenderID, Handle: r.SenderHandle, DisplayName: r.SenderDisplayName},
				Kind:      MessageKindUser,
				Body:      r.Body,
				CreatedAt: r.CreatedAt,
				Deleted:   r.DeletedAt != nil,
			},
			RootSeq:     r.Seq,
			ReplyCount:  int64(r.ThreadReplyCount),
			UnreadCount: r.LastThreadSeq - r.LastReadThreadSeq,
		}
		// 参加の行は返信があったときにしかできないので、最後の返信の時刻は必ずある。
		if r.ThreadLastReplyAt != nil {
			t.LastReplyAt = *r.ThreadLastReplyAt
		}
		items[i] = t
	}
	return newPage(items, limit, func(t FollowedThread) ulid.ULID { return t.Root.ID }), nil
}

// UnreadThreadCount は、actor が参加しているワークスペースのスレッドのうち、未読の返信があるものの数（サイドバーの「スレッド」。ADR 0036）。
func (s *Service) UnreadThreadCount(ctx context.Context, actor, workspaceID ulid.ULID) (int64, error) {
	q := store.New(s.db)
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return 0, notFoundIfNoRows(err, "get role")
	}
	n, err := q.CountUnreadThreads(ctx, store.CountUnreadThreadsParams{UserID: actor, WorkspaceID: workspaceID})
	if err != nil {
		return 0, fmt.Errorf("count unread threads: %w", err)
	}
	return n, nil
}
