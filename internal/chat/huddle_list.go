package chat

import (
	"context"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// ハドルの一覧と提案のカード（ADR 0067 決定 6・7）。
//
// 一覧の上の「進行中のハドル」は、ここでは返さない。クライアントはサイドバーのルームをすべてストアに持ち、
// huddle.updated で生きた状態を受け取っているので、そこから描く（状態の出どころを 2 つにしない。決定 6）。

// HuddleListScope は「最近のハドルミーティング」の範囲（決定 6。Slack の 1 つ目のプルダウン）。
type HuddleListScope string

const (
	// HuddleListAll は、自分がメンバーのルームで参加した後に始まったハドルと、自分が入ったハドル。
	HuddleListAll HuddleListScope = "all"
	// HuddleListMissed は、自分がメンバーのルームで参加した後に始まったハドルのうち、自分が入らなかったもの。
	HuddleListMissed HuddleListScope = "missed"
)

const (
	// DefaultHuddleListLimit と MaxHuddleListLimit は一覧の 1 回の件数（アクティビティと同じ幅）。
	DefaultHuddleListLimit = 50
	MaxHuddleListLimit     = 100
	// HuddleSuggestionWindow は提案のカードが数える期間（決定 7。Slack の「過去 1 週間」）。
	HuddleSuggestionWindow = 7 * 24 * time.Hour
	// MaxHuddleSuggestions は提案のカードの数。
	MaxHuddleSuggestions = 3
)

// HuddlePlace はハドルのある場所。dm では Name が空で、DMPeer に相手が入る。
type HuddlePlace struct {
	ID     ulid.ULID
	Kind   RoomKind
	Name   string
	DMPeer *UserProfile
}

// PastHuddle は「最近のハドルミーティング」の 1 行（終わったハドル）。
type PastHuddle struct {
	ID ulid.ULID
	// MessageID は会話のハドルのメッセージ（行を押したときの行き先。ハドルのチャットのスレッドの親）。
	MessageID ulid.ULID
	StartedBy ulid.ULID
	Room      HuddlePlace
	StartedAt time.Time
	EndedAt   time.Time
	// ParticipantIDs は一度でも入った人（最初に入った順）。
	ParticipantIDs []ulid.ULID
	// ReplyCount はハドルのチャット（ハドルのメッセージのスレッド）の返信の数。
	ReplyCount int64
	// Saved は、自分がハドルのメッセージを「後で」に保存しているか（行の「…」の文言。ADR 0067 決定 6）。
	Saved bool
}

// HuddleListQuery は一覧の絞り込みとページ。
type HuddleListQuery struct {
	// Scope が空なら all。
	Scope HuddleListScope
	// ParticipantID は「相手」（その人も入ったハドル）、RoomID は「場所」。nil なら絞らない。
	ParticipantID *ulid.ULID
	RoomID        *ulid.ULID
	// Before は前のページの最後のハドルの ID。ゼロ値なら最初のページ。
	Before ulid.ULID
	Limit  int
}

// HuddleSuggestion は提案のカード（決定 7）。
type HuddleSuggestion struct {
	Room HuddlePlace
	// Count は期間の中で、そこで自分が参加したハドルの数。
	Count int64
	// ParticipantIDs は、そこの同じ期間のハドルに参加した人（自分を除く）。
	ParticipantIDs []ulid.ULID
}

// ListHuddles は「最近のハドルミーティング」の 1 ページを新しい順に返す（決定 6）。ワークスペースのメンバーでなければ ErrNotFound。
func (s *Service) ListHuddles(ctx context.Context, actor, workspaceID ulid.ULID, hq HuddleListQuery) (Page[PastHuddle], error) {
	var fields fieldErrors
	if hq.Scope == "" {
		hq.Scope = HuddleListAll
	}
	switch hq.Scope {
	case HuddleListAll, HuddleListMissed:
	default:
		fields.add("filter", ReasonInvalidValue)
	}
	if err := fields.err(); err != nil {
		return Page[PastHuddle]{}, err
	}
	limit := hq.Limit
	switch {
	case limit <= 0:
		limit = DefaultHuddleListLimit
	case limit > MaxHuddleListLimit:
		limit = MaxHuddleListLimit
	}
	// 最初のページは、どの ULID よりも大きい値から始める（「NULL なら条件なし」と書かないのは ListMessagesBefore と同じ理由）
	before := hq.Before
	if before == (ulid.ULID{}) {
		before = maxULID
	}

	q := store.New(s.db)
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return Page[PastHuddle]{}, notFoundIfNoRows(err, "get role")
	}
	rows, err := q.ListHuddles(ctx, store.ListHuddlesParams{
		UserID: actor, WorkspaceID: workspaceID, Missed: hq.Scope == HuddleListMissed,
		RoomID: hq.RoomID, ParticipantID: hq.ParticipantID, BeforeID: before, MaxRows: int32(limit + 1),
	})
	if err != nil {
		return Page[PastHuddle]{}, fmt.Errorf("list huddles: %w", err)
	}
	places := make([]placeRow, len(rows))
	for i, r := range rows {
		places[i] = placeRow{roomID: r.RoomID, kind: r.RoomKind, name: r.RoomName, dmKey: r.RoomDmKey}
	}
	resolved, err := resolvePlaces(ctx, q, actor, places)
	if err != nil {
		return Page[PastHuddle]{}, err
	}
	items := make([]PastHuddle, len(rows))
	for i, r := range rows {
		items[i] = PastHuddle{
			ID: r.ID, MessageID: r.MessageID, StartedBy: r.StartedBy, Room: resolved[i],
			StartedAt: r.StartedAt, ParticipantIDs: r.ParticipantIds, ReplyCount: int64(r.ThreadReplyCount), Saved: r.Saved,
		}
		// 終わったハドルだけを返す（SQL の条件）。nil になることはない
		if r.EndedAt != nil {
			items[i].EndedAt = *r.EndedAt
		}
	}
	return newPage(items, limit, func(h PastHuddle) ulid.ULID { return h.ID }), nil
}

// HuddleSuggestions は提案のカードを返す（決定 7）。ワークスペースのメンバーでなければ ErrNotFound。
func (s *Service) HuddleSuggestions(ctx context.Context, actor, workspaceID ulid.ULID) ([]HuddleSuggestion, error) {
	q := store.New(s.db)
	role, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return nil, notFoundIfNoRows(err, "get role")
	}
	rows, err := q.ListHuddleSuggestions(ctx, store.ListHuddleSuggestionsParams{
		UserID: actor, WorkspaceID: workspaceID, Since: s.clock.Now().Add(-HuddleSuggestionWindow),
		// SQL が絞った候補を authz でもう一度確かめるので、少し多めに読んでから数をそろえる
		MaxRows: int32(MaxHuddleSuggestions * 2),
	})
	if err != nil {
		return nil, fmt.Errorf("list huddle suggestions: %w", err)
	}
	// 入れる場所だけを出す。判断は authz だけがする（ルール 9。SQL の条件は候補を絞るための写し）
	actorInRoom := authz.RoomActor{Role: Role(role), IsRoomMember: true}
	var kept []store.ListHuddleSuggestionsRow
	for _, r := range rows {
		room := authz.Room{Kind: RoomKind(r.RoomKind), IsDefault: r.RoomIsDefault}
		if authz.CanJoinHuddle(room, actorInRoom) && len(kept) < MaxHuddleSuggestions {
			kept = append(kept, r)
		}
	}
	places := make([]placeRow, len(kept))
	for i, r := range kept {
		places[i] = placeRow{roomID: r.RoomID, kind: r.RoomKind, name: r.RoomName, dmKey: r.RoomDmKey}
	}
	resolved, err := resolvePlaces(ctx, q, actor, places)
	if err != nil {
		return nil, err
	}
	out := make([]HuddleSuggestion, len(kept))
	for i, r := range kept {
		out[i] = HuddleSuggestion{Room: resolved[i], Count: r.HuddleCount, ParticipantIDs: r.ParticipantIds}
	}
	return out, nil
}

// placeRow は場所の生の値（sqlc の行から取り出す）。
type placeRow struct {
	roomID ulid.ULID
	kind   string
	name   *string
	dmKey  *string
}

// resolvePlaces は行の場所を HuddlePlace にする。dm の相手のプロフィールはまとめて引く（N+1 にしない。スレッドの一覧と同じ）。
func resolvePlaces(ctx context.Context, q *store.Queries, actor ulid.ULID, rows []placeRow) ([]HuddlePlace, error) {
	peers := map[ulid.ULID]ulid.ULID{}
	var peerIDs []ulid.ULID
	for _, r := range rows {
		if r.dmKey == nil {
			continue
		}
		peer, err := dmPeerID(*r.dmKey, actor)
		if err != nil {
			return nil, err
		}
		if _, seen := peers[r.roomID]; !seen {
			peerIDs = append(peerIDs, peer)
		}
		peers[r.roomID] = peer
	}
	profiles := map[ulid.ULID]UserProfile{}
	if len(peerIDs) > 0 {
		ps, err := q.ListUserProfiles(ctx, peerIDs)
		if err != nil {
			return nil, fmt.Errorf("list dm peers: %w", err)
		}
		for _, p := range ps {
			profiles[p.ID] = UserProfile{ID: p.ID, Handle: p.Handle, DisplayName: p.DisplayName}
		}
	}
	out := make([]HuddlePlace, len(rows))
	for i, r := range rows {
		place := HuddlePlace{ID: r.roomID, Kind: RoomKind(r.kind)}
		if r.name != nil {
			place.Name = *r.name
		}
		if peer, ok := peers[r.roomID]; ok {
			p := profiles[peer]
			place.DMPeer = &p
		}
		out[i] = place
	}
	return out, nil
}
