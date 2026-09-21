package chat

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/emoji"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// Presence は自動で決まる presence（ADR 0049 決定 1）。本人が選んだ設定（手動の離席）とは混ぜない。
//
// 画面に出す 3 つの状態（オンライン / 離席 / オフライン）は、これと Away を読む側が合わせて決める。
// 寿命が違う 2 つ（Redis の TTL と Postgres の行）を 1 つの値にまとめると、どちらの寿命に合わせるかを決められず、
// 両方に写しを置くことになるため。
type Presence string

const (
	// PresenceActive は、どこか 1 つの接続が画面を見ている。
	PresenceActive Presence = "active"
	// PresenceIdle は、接続はあるがどれも画面を見ていない（別のタブ・10 分操作なし）。
	PresenceIdle Presence = "idle"
	// PresenceOffline は接続がない。
	PresenceOffline Presence = "offline"
)

// presenceOf は Redis の「接続があるか」を Presence にする。
//
// いまの Redis は接続の有無しか持たないので、接続があれば active になる。
// 「見ている接続の数」を持たせて idle を返すのは構築順 4（ADR 0049 決定 2）。
func presenceOf(online bool) Presence {
	if online {
		return PresenceActive
	}
	return PresenceOffline
}

// UserStatus はカスタムステータス（ADR 0049 決定 5）。ワークスペースごとに持つ。
// 絵文字は必須、文言は任意。ExpiresAt が nil なら消えない。
type UserStatus struct {
	Emoji     string
	Text      string
	ExpiresAt *time.Time
}

// StatusTextMax は文言の上限（Slack と同じ）。数えるのはコードポイント。
const StatusTextMax = 100

// statusOf は DB の 3 列から UserStatus を作る。**期限を過ぎていれば無いものとして返す**（ADR 0049 決定 6 の追記）。
//
// 期限を落とすのはこの 1 箇所だけにする。SQL の CASE で落とす案は、sqlc が式の型と NULL 可能性を推せず、
// 生成される型が `interface{}` か「NULL にならない string」になってしまうので採らなかった。
func statusOf(emoji, text *string, expiresAt *time.Time, now time.Time) *UserStatus {
	if emoji == nil {
		return nil
	}
	if expiresAt != nil && !expiresAt.After(now) {
		return nil
	}
	status := &UserStatus{Emoji: *emoji, ExpiresAt: expiresAt}
	if text != nil {
		status.Text = *text
	}
	return status
}

// SetManualAway は本人の手動の離席を設定する（ADR 0049 決定 4）。冪等。
//
// ユーザーごとの設定なので、所属するすべてのワークスペースに同じ値を配る。
func (s *Service) SetManualAway(ctx context.Context, actor ulid.ULID, away bool) (bool, error) {
	q := store.New(s.db)
	if err := q.SetManualAway(ctx, store.SetManualAwayParams{UserID: actor, ManualAway: away, Now: s.clock.Now()}); err != nil {
		return false, fmt.Errorf("set manual away: %w", err)
	}
	// 所属するワークスペースごとに、そのワークスペースのステータスを添えて配る（ADR 0049 決定 8）。
	workspaces, err := q.ListWorkspacesForUser(ctx, actor)
	if err != nil {
		return false, fmt.Errorf("list workspaces for away: %w", err)
	}
	events := make([]Event, 0, len(workspaces))
	for _, w := range workspaces {
		status, err := s.memberStatus(ctx, q, w.Workspace.ID, actor)
		if err != nil {
			return false, err
		}
		events = append(events, memberStatusChangedEvent(w.Workspace.ID, actor, away, status))
	}
	s.deliver(ctx, events...)
	return away, nil
}

// SetStatus はカスタムステータスを設定する。ワークスペースのメンバーでなければ ErrNotFound。
func (s *Service) SetStatus(ctx context.Context, actor, workspaceID ulid.ULID, status UserStatus) (*UserStatus, error) {
	if err := validateStatus(status, s.clock.Now()); err != nil {
		return nil, err
	}
	q := store.New(s.db)
	var text *string
	if status.Text != "" {
		text = &status.Text
	}
	row, err := q.SetMemberStatus(ctx, store.SetMemberStatusParams{
		WorkspaceID:     workspaceID,
		UserID:          actor,
		StatusEmoji:     &status.Emoji,
		StatusText:      text,
		StatusExpiresAt: status.ExpiresAt,
	})
	if err != nil {
		return nil, notFoundIfNoRows(err, "set status")
	}
	saved := statusOf(row.StatusEmoji, row.StatusText, row.StatusExpiresAt, s.clock.Now())
	away, err := s.manualAway(ctx, q, actor)
	if err != nil {
		return nil, err
	}
	s.deliver(ctx, memberStatusChangedEvent(workspaceID, actor, away, saved))
	return saved, nil
}

// ClearStatus はカスタムステータスを解除する。設定していなくても成功（冪等）。
func (s *Service) ClearStatus(ctx context.Context, actor, workspaceID ulid.ULID) error {
	q := store.New(s.db)
	rows, err := q.ClearMemberStatus(ctx, store.ClearMemberStatusParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return fmt.Errorf("clear status: %w", err)
	}
	if rows == 0 {
		return ErrNotFound
	}
	away, err := s.manualAway(ctx, q, actor)
	if err != nil {
		return err
	}
	s.deliver(ctx, memberStatusChangedEvent(workspaceID, actor, away, nil))
	return nil
}

// validateStatus は絵文字と文言と期限を確かめる。絵文字の検証はリアクション（ADR 0044）と同じものを使う。
func validateStatus(status UserStatus, now time.Time) error {
	var fields []FieldError
	if !emoji.Valid(status.Emoji) {
		fields = append(fields, FieldError{Field: "emoji", Reason: ReasonInvalidValue})
	}
	if utf8.RuneCountInString(status.Text) > StatusTextMax {
		fields = append(fields, FieldError{Field: "text", Reason: ReasonTooLong})
	}
	// 過ぎた時刻を受け付けると、設定した瞬間に消えるステータスができる（書けたのに出ない、が起きる）。
	if status.ExpiresAt != nil && !status.ExpiresAt.After(now) {
		fields = append(fields, FieldError{Field: "expires_at", Reason: ReasonInvalidValue})
	}
	if len(fields) > 0 {
		return &ValidationError{Fields: fields}
	}
	return nil
}

// manualAway は本人の手動の離席を読む。行が無ければ false。
func (s *Service) manualAway(ctx context.Context, q *store.Queries, userID ulid.ULID) (bool, error) {
	away, err := q.GetManualAway(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("get manual away: %w", err)
	}
	return away, nil
}

// memberStatus は 1 人ぶんのステータスを読む（配るイベントに載せる値）。期限切れは落とす。
func (s *Service) memberStatus(ctx context.Context, q *store.Queries, workspaceID, userID ulid.ULID) (*UserStatus, error) {
	row, err := q.GetMemberStatus(ctx, store.GetMemberStatusParams{WorkspaceID: workspaceID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get member status: %w", err)
	}
	return statusOf(row.StatusEmoji, row.StatusText, row.StatusExpiresAt, s.clock.Now()), nil
}
