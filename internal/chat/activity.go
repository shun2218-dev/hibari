package chat

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// アクティビティ（ADR 0058）。
//
// 行を持たない。通知の規則（ADR 0055 / 0056 / 0057）と、ルーム・スレッドの既読位置から、読むたびに組み立てる
// （db/queries/chat/activity.sql）。@channel や「すべての新しい投稿」で人数分の行を書かないためで、
// その代わりに 1 件ずつの既読やクリアは持たない（決定 5）。
//
// 読めるかどうかは room_members で絞る（決定 4）。外されたら行が消えるので、アプリのコードで判断しない。
// 念のため、中身を付けるときにも authz を通す（保存の一覧と同じ。CLAUDE.md ルール 9）。

// ActivityFilter はタブ（決定 3）。all 以外は Reasons で絞る。
type ActivityFilter string

const (
	ActivityFilterAll      ActivityFilter = "all"
	ActivityFilterDM       ActivityFilter = "dm"
	ActivityFilterMention  ActivityFilter = "mention"
	ActivityFilterThread   ActivityFilter = "thread"
	ActivityFilterReaction ActivityFilter = "reaction"
)

// ActivityReason はアクティビティに並べる理由（決定 2）。1 件が複数に当たることがある。
type ActivityReason string

const (
	ReasonDM       ActivityReason = "dm"
	ReasonMention  ActivityReason = "mention"
	ReasonThread   ActivityReason = "thread"
	ReasonChannel  ActivityReason = "channel"
	ReasonReaction ActivityReason = "reaction"
)

// ActivityItemType は 1 件の種類。メッセージ 1 つか、自分のメッセージに付いたリアクション 1 つ。
type ActivityItemType string

const (
	ActivityItemMessage  ActivityItemType = "message"
	ActivityItemReaction ActivityItemType = "reaction"
)

const (
	// DefaultActivityLimit と MaxActivityLimit は一覧の 1 回の件数（決定 6）。
	DefaultActivityLimit = 50
	MaxActivityLimit     = 100
	// MaxUnreadActivityCount は未読の件数を数える上限。これ以上は数えない（メニューのバッジは「99+」。決定 5）。
	MaxUnreadActivityCount = 100
)

// ActivityItem はアクティビティの 1 件。
type ActivityItem struct {
	// Key は一覧の中で 1 件を決める値（メッセージは "m:<id>"、リアクションは "r:<message>:<user>:<emoji>"）。
	Key        string
	Type       ActivityItemType
	Reasons    []ActivityReason
	Unread     bool
	OccurredAt time.Time
	Room       LinkedRoom
	// Message はメッセージの 1 件。リアクションのときは、リアクションの付いた自分のメッセージ。
	Message Message
	// Reaction はリアクションのときだけ入る。
	Reaction *ActivityReaction
}

// ActivityReaction は、自分のメッセージに誰がどの絵文字を付けたか。
type ActivityReaction struct {
	Emoji string
	User  UserProfile
}

// ActivityReactionAdded は activity.reaction_added のデータ。Item は一覧の 1 件と同じ形（送信者から見た値）。
type ActivityReactionAdded struct {
	WorkspaceID ulid.ULID
	Item        ActivityItem
}

// ActivityReactionRemoved は activity.reaction_removed のデータ。Key の 1 件を一覧から外す。
type ActivityReactionRemoved struct {
	WorkspaceID ulid.ULID
	Key         string
}

// ActivityQuery は一覧の指定。Before は前のページの NextCursor（不透明な文字列）。
type ActivityQuery struct {
	Filter     ActivityFilter
	UnreadOnly bool
	Before     string
	Limit      int
}

// ActivityPage は一覧の 1 ページ。
type ActivityPage struct {
	Items []ActivityItem
	// NextCursor は次のページの Before。HasMore のときだけ入る。
	NextCursor string
	HasMore    bool
}

// ListActivity はアクティビティの 1 ページを返す（決定 6）。ワークスペースのメンバーでなければ ErrNotFound。
func (s *Service) ListActivity(ctx context.Context, actor, workspaceID ulid.ULID, aq ActivityQuery) (ActivityPage, error) {
	var fields fieldErrors
	if aq.Filter == "" {
		aq.Filter = ActivityFilterAll
	}
	switch aq.Filter {
	case ActivityFilterAll, ActivityFilterDM, ActivityFilterMention, ActivityFilterThread, ActivityFilterReaction:
	default:
		fields.add("filter", ReasonInvalidValue)
	}
	// 最初のページは、どの項目よりも後ろの位置から始める（「NULL なら条件なし」と書かないのは ListMessagesBefore と同じ理由）。
	before := activityCursor{at: maxActivityTime, key: "~"}
	if aq.Before != "" {
		c, err := parseActivityCursor(aq.Before)
		if err != nil {
			fields.add("before", ReasonInvalidValue)
		}
		before = c
	}
	if err := fields.err(); err != nil {
		return ActivityPage{}, err
	}
	limit := aq.Limit
	switch {
	case limit <= 0:
		limit = DefaultActivityLimit
	case limit > MaxActivityLimit:
		limit = MaxActivityLimit
	}

	q := store.New(s.db)
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return ActivityPage{}, notFoundIfNoRows(err, "get role")
	}
	rows, err := q.ListActivity(ctx, store.ListActivityParams{
		UserID: actor, WorkspaceID: workspaceID, Now: s.clock.Now(),
		Filter: string(aq.Filter), UnreadOnly: aq.UnreadOnly,
		BeforeAt: before.at, BeforeKey: before.key, MaxRows: int32(limit + 1),
	})
	if err != nil {
		return ActivityPage{}, fmt.Errorf("list activity: %w", err)
	}
	var page ActivityPage
	if len(rows) > limit {
		rows, page.HasMore = rows[:limit], true
		last := rows[len(rows)-1]
		page.NextCursor = activityCursor{at: last.OccurredAt, key: last.SortKey}.String()
	}
	if page.Items, err = s.hydrateActivity(ctx, q, actor, rows); err != nil {
		return ActivityPage{}, err
	}
	return page, nil
}

// CountUnreadActivity は未読のアクティビティの件数（メニューのバッジ）。MaxUnreadActivityCount で打ち切る。
func (s *Service) CountUnreadActivity(ctx context.Context, actor, workspaceID ulid.ULID) (int64, error) {
	q := store.New(s.db)
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return 0, notFoundIfNoRows(err, "get role")
	}
	n, err := q.CountUnreadActivity(ctx, store.CountUnreadActivityParams{
		UserID: actor, WorkspaceID: workspaceID, Now: s.clock.Now(), MaxRows: MaxUnreadActivityCount,
	})
	if err != nil {
		return 0, fmt.Errorf("count unread activity: %w", err)
	}
	return n, nil
}

// hydrateActivity は一覧の行にメッセージとルーム（リアクションなら付けた人）を付ける。
//
// ルームの単位でまとめて認可し、メッセージも 1 回で読む（N+1 にしない。保存の hydrateSaved と同じ形）。
// 読んでいる間に削除・退出があって中身が取れなかった行は、一覧から落とす。
func (s *Service) hydrateActivity(ctx context.Context, q *store.Queries, actor ulid.ULID, rows []store.ListActivityRow) ([]ActivityItem, error) {
	byRoom := map[ulid.ULID][]ulid.ULID{}
	var reactorIDs []ulid.ULID
	for _, r := range rows {
		if !slices.Contains(byRoom[r.RoomID], r.MessageID) {
			byRoom[r.RoomID] = append(byRoom[r.RoomID], r.MessageID)
		}
		if r.ReactorID != nil && !slices.Contains(reactorIDs, *r.ReactorID) {
			reactorIDs = append(reactorIDs, *r.ReactorID)
		}
	}

	messages := map[ulid.ULID]*Message{}
	var (
		rooms     []Room
		dmKeys    []*string
		roomIndex = map[ulid.ULID]int{}
	)
	for _, roomID := range slices.SortedFunc(maps.Keys(byRoom), ulid.ULID.Compare) {
		a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !authz.CanReadRoom(a.authzRoom(), a.actor(actor)) {
			continue
		}
		views, err := q.ListMessageViewsByIDs(ctx, store.ListMessageViewsByIDsParams{RoomID: roomID, Ids: byRoom[roomID]})
		if err != nil {
			return nil, fmt.Errorf("list activity messages: %w", err)
		}
		mv := make([]messageView, 0, len(views))
		for _, v := range views {
			if v.DeletedAt == nil {
				mv = append(mv, messageView(v))
			}
		}
		page, err := s.finishMessagePage(ctx, q, roomID, actor, mv, MessagePage{})
		if err != nil {
			return nil, err
		}
		for k := range page.Messages {
			messages[page.Messages[k].ID] = &page.Messages[k]
		}
		roomIndex[roomID] = len(rooms)
		name := ""
		if a.room.Name != nil {
			name = *a.room.Name
		}
		rooms = append(rooms, Room{ID: roomID, WorkspaceID: a.room.WorkspaceID, Kind: a.kind(), Name: name})
		dmKeys = append(dmKeys, a.room.DmKey)
	}
	if err := attachDMPeers(ctx, q, actor, rooms, dmKeys); err != nil {
		return nil, err
	}
	reactors := map[ulid.ULID]UserProfile{}
	if len(reactorIDs) > 0 {
		profiles, err := q.ListUserProfiles(ctx, reactorIDs)
		if err != nil {
			return nil, fmt.Errorf("list reactor profiles: %w", err)
		}
		for _, p := range profiles {
			reactors[p.ID] = UserProfile{ID: p.ID, Handle: p.Handle, DisplayName: p.DisplayName}
		}
	}

	items := make([]ActivityItem, 0, len(rows))
	for _, r := range rows {
		m, ok := messages[r.MessageID]
		if !ok {
			continue
		}
		room := rooms[roomIndex[r.RoomID]]
		item := ActivityItem{
			Key: r.SortKey, Type: ActivityItemType(r.ItemType), Unread: r.Unread, OccurredAt: r.OccurredAt,
			Room:    LinkedRoom{ID: room.ID, Kind: room.Kind, Name: room.Name, DMPeer: room.DMPeer},
			Message: *m,
		}
		for _, reason := range r.Reasons {
			item.Reasons = append(item.Reasons, ActivityReason(reason))
		}
		if r.ReactorID != nil && r.Emoji != nil {
			user, ok := reactors[*r.ReactorID]
			if !ok {
				continue
			}
			item.Reaction = &ActivityReaction{Emoji: *r.Emoji, User: user}
		}
		items = append(items, item)
	}
	return items, nil
}

// reactionActivityKey はリアクションの 1 件の Key（activity.sql の sort_key と同じ形）。
func reactionActivityKey(messageID, userID ulid.ULID, emoji string) string {
	return "r:" + uuidString(messageID) + ":" + uuidString(userID) + ":" + emoji
}

// uuidString は DB の uuid::text と同じ表記（小文字の 8-4-4-4-12）。sort_key はこの表記で作られている。
func uuidString(id ulid.ULID) string {
	const hex = "0123456789abcdef"
	var b strings.Builder
	for i, c := range id {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			b.WriteByte('-')
		}
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&0x0f])
	}
	return b.String()
}

// activityCursor は一覧の位置。並びの (occurred_at, sort_key) をそのまま持つ。
type activityCursor struct {
	at  time.Time
	key string
}

// maxActivityTime はどの項目よりも後ろの時刻（最初のページの位置）。
var maxActivityTime = time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)

// String は不透明なカーソルの文字列にする。クライアントは中身を読まずにそのまま返す。
func (c activityCursor) String() string {
	return base64.RawURLEncoding.EncodeToString([]byte(c.at.UTC().Format(time.RFC3339Nano) + "\n" + c.key))
}

func parseActivityCursor(s string) (activityCursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return activityCursor{}, fmt.Errorf("decode activity cursor: %w", err)
	}
	at, key, ok := strings.Cut(string(raw), "\n")
	if !ok || key == "" {
		return activityCursor{}, errors.New("malformed activity cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return activityCursor{}, fmt.Errorf("parse activity cursor: %w", err)
	}
	return activityCursor{at: t, key: key}, nil
}

// reactionActivityEvent は、リアクションの付け外しを送信者のアクティビティに知らせるイベントを作る（決定 9）。
// 自分で自分のメッセージに付けたとき、送信者のアクティビティに載らないルーム（ミュート中・「なし」）のときは作らない。
// 付けたときの中身は送信者から見た値にする（DM の相手・リアクションの me は送信者のもの）。送り先は送信者だけなので混ざらない。
func (s *Service) reactionActivityEvent(ctx context.Context, q *store.Queries, workspaceID, roomID, messageID, sender, actor ulid.ULID, e string, add bool) (*Event, error) {
	if sender == actor {
		return nil, nil
	}
	target, err := q.ReactionActivityTarget(ctx, store.ReactionActivityTargetParams{RoomID: roomID, UserID: sender, Now: s.clock.Now()})
	if err != nil {
		return nil, fmt.Errorf("check reaction activity: %w", err)
	}
	if !target {
		return nil, nil
	}
	key := reactionActivityKey(messageID, actor, e)
	to := Audience{Users: []ulid.ULID{sender}}
	if !add {
		return &Event{Type: EventActivityReactionRemoved, To: to, Data: ActivityReactionRemoved{WorkspaceID: workspaceID, Key: key}}, nil
	}
	at, err := q.GetReaction(ctx, store.GetReactionParams{MessageID: messageID, UserID: actor, Emoji: e})
	if err != nil {
		return nil, fmt.Errorf("get reaction: %w", err)
	}
	items, err := s.hydrateActivity(ctx, q, sender, []store.ListActivityRow{{
		ItemType: string(ActivityItemReaction), MessageID: messageID, RoomID: roomID, ReactorID: &actor, Emoji: &e,
		OccurredAt: at, SortKey: key, Reasons: []string{string(ReasonReaction)},
	}})
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	return &Event{Type: EventActivityReactionAdded, To: to, Data: ActivityReactionAdded{WorkspaceID: workspaceID, Item: items[0]}}, nil
}
