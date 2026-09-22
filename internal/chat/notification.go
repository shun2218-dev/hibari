package chat

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// NotifyLevel は「通知する内容」（ADR 0055 決定 1）。
//
// 変えるのは通知を出すか（6.14b）と見せ方だけで、未読数とメンションの件数はどの値でも同じに数える。
// 数え方を設定で変えると、設定を変えるたびに過去の分まで数え直すことになるため。
type NotifyLevel string

const (
	// NotifyAll は参加しているルームの新しい投稿をすべて通知する。
	NotifyAll NotifyLevel = "all"
	// NotifyMentions は自分宛てのメンション・DM・参加しているスレッドの返信だけを通知する。全体の設定の既定。
	NotifyMentions NotifyLevel = "mentions"
	// NotifyNone は通知しない。全体の設定だけが取れる（ルームで止めたいならミュートする）。
	NotifyNone NotifyLevel = "none"
)

// DefaultNotifyLevel は全体の設定を選んでいないときの値（Slack の既定と同じ）。
const DefaultNotifyLevel = NotifyMentions

// RoomNotifications はルームごとの本人の設定（ADR 0055 決定 3）。
type RoomNotifications struct {
	// Level は上書き。nil なら全体の設定に従う。all か mentions だけ。DM では常に nil。
	Level *NotifyLevel
	Muted bool
	// MutedUntil は期限つきのミュートの期限。nil なら期限なし。Muted が false なら常に nil。
	MutedUntil *time.Time
}

// roomNotificationsOf は room_members の 3 列から設定を作る。**期限の来たミュートはしていないものとして返す**。
//
// 期限を落とすのはこの 1 箇所だけにする（カスタムステータスの statusOf と同じ。ADR 0049 決定 6）。
// 行は次に設定したときに上書きされるので、掃除のジョブは作らない。
func roomNotificationsOf(level *string, muted bool, mutedUntil *time.Time, now time.Time) *RoomNotifications {
	n := &RoomNotifications{Muted: muted, MutedUntil: mutedUntil}
	if level != nil {
		l := NotifyLevel(*level)
		n.Level = &l
	}
	if mutedUntil != nil && !mutedUntil.After(now) {
		n.Muted, n.MutedUntil = false, nil
	}
	return n
}

// NotificationLevel は、そのワークスペースでの全体の設定を返す。未設定なら DefaultNotifyLevel。
// ワークスペースのメンバーでなければ ErrNotFound（ほかの /workspaces/{id} と同じく存在を明かさない）。
func (s *Service) NotificationLevel(ctx context.Context, actor, workspaceID ulid.ULID) (NotifyLevel, error) {
	level, err := store.New(s.db).GetWorkspaceNotifyLevel(ctx, store.GetWorkspaceNotifyLevelParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return "", notFoundIfNoRows(err, "get notify level")
	}
	return notifyLevelOf(level), nil
}

// SetNotificationLevel は全体の設定を変える（ADR 0055 決定 2）。本人のすべての接続に届ける（別のタブをそろえる。決定 5）。
func (s *Service) SetNotificationLevel(ctx context.Context, actor, workspaceID ulid.ULID, level NotifyLevel) (NotifyLevel, error) {
	if level != NotifyAll && level != NotifyMentions && level != NotifyNone {
		return "", &ValidationError{Fields: []FieldError{{Field: "level", Reason: ReasonInvalidValue}}}
	}
	value := string(level)
	saved, err := store.New(s.db).SetWorkspaceNotifyLevel(ctx, store.SetWorkspaceNotifyLevelParams{
		NotifyLevel: &value, WorkspaceID: workspaceID, UserID: actor,
	})
	if err != nil {
		return "", notFoundIfNoRows(err, "set notify level")
	}
	level = notifyLevelOf(saved)
	s.deliver(ctx, Event{
		Type: EventNotificationsUpdated,
		To:   Audience{Users: []ulid.ULID{actor}},
		Data: NotificationsUpdated{WorkspaceID: workspaceID, Level: level},
	})
	return level, nil
}

// SetRoomNotifications はルームごとの設定を全部の値で置き換える（PUT。ADR 0055 決定 4）。
//
// 部分の更新にしないのは、「ミュートを外したら期限も消える」のような組み合わせの規則を、ここ 1 か所で守るため。
// 設定を持てるのはルームのメンバーだけ（room_members の行にある）。読めるが参加していない public ルームは ErrForbidden。
func (s *Service) SetRoomNotifications(ctx context.Context, actor, roomID ulid.ULID, in RoomNotifications) (RoomNotifications, error) {
	var fields fieldErrors
	if in.Level != nil && *in.Level != NotifyAll && *in.Level != NotifyMentions {
		fields.add("level", ReasonInvalidValue)
	}
	// 期限はクライアントが端末のタイムゾーンで求めて送る（「明日まで」は翌々日の 0:00）。サーバーは未来の時刻かだけを見る。
	// 過ぎた時刻を受け付けると、設定した瞬間に切れるミュートができる（書けたのに効かない、が起きる）。
	if in.MutedUntil != nil && (!in.Muted || !in.MutedUntil.After(s.clock.Now())) {
		fields.add("muted_until", ReasonInvalidValue)
	}
	if err := fields.err(); err != nil {
		return RoomNotifications{}, err
	}

	q := store.New(s.db)
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return RoomNotifications{}, err
	}
	if !authz.CanSetRoomNotifications(a.kind(), a.actor(actor)) {
		return RoomNotifications{}, ErrForbidden
	}
	// DM の通知は全体の設定だけで決まる（決定 1）。上書きを受け付けると、効かない値が保存される。
	if a.kind() == authz.RoomDM && in.Level != nil {
		return RoomNotifications{}, &ValidationError{Fields: []FieldError{{Field: "level", Reason: ReasonInvalidValue}}}
	}

	var level *string
	if in.Level != nil {
		v := string(*in.Level)
		level = &v
	}
	row, err := q.SetRoomNotifications(ctx, store.SetRoomNotificationsParams{
		NotifyLevel: level, Muted: in.Muted, MutedUntil: in.MutedUntil, RoomID: roomID, UserID: actor,
	})
	// 1 文の UPDATE なので、判定との間にルームから外されたら行が見つからない。判定の時点に合わせて拒否する（MarkRoomRead と同じ）。
	if errors.Is(err, pgx.ErrNoRows) {
		return RoomNotifications{}, ErrForbidden
	}
	if err != nil {
		return RoomNotifications{}, fmt.Errorf("set room notifications: %w", err)
	}
	saved := *roomNotificationsOf(row.NotifyLevel, row.Muted, row.MutedUntil, s.clock.Now())
	s.deliver(ctx, Event{
		Type: EventRoomNotificationsUpdated,
		To:   Audience{Users: []ulid.ULID{actor}},
		Data: RoomNotificationsUpdated{WorkspaceID: a.room.WorkspaceID, RoomID: roomID, Notifications: saved},
	})
	return saved, nil
}

func notifyLevelOf(level *string) NotifyLevel {
	if level == nil {
		return DefaultNotifyLevel
	}
	return NotifyLevel(*level)
}
