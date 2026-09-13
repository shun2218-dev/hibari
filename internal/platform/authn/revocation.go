package authn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"
)

// RevocationChannel は失効イベントを流す Redis Pub/Sub のチャンネル（ADR 0007）。
const RevocationChannel = "auth:revoked"

// Revocation は失効イベント。
//   - 1 セッションの失効（ログアウト、Refresh Token の再利用検知）: SessionID だけが入る
//   - ユーザーの全セッションの失効（パスワードリセット、退会）: UserID と All が入る
//
// Redis Pub/Sub は at-most-once なので、受け取れなかったインスタンスがありうる前提で使う（ADR 0007）。
type Revocation struct {
	SessionID ulid.ULID
	UserID    ulid.ULID
	All       bool
}

// revocationMessage はチャンネルに流す JSON の形。
// {"sid": "..."} または {"user_id": "...", "all": true}（ADR 0007）。
type revocationMessage struct {
	SessionID *ulid.ULID `json:"sid,omitempty"`
	UserID    *ulid.ULID `json:"user_id,omitempty"`
	All       bool       `json:"all,omitempty"`
}

var errMalformedRevocation = errors.New("authn: malformed revocation message")

func decodeRevocation(payload string) (Revocation, error) {
	var m revocationMessage
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return Revocation{}, fmt.Errorf("%w: %w", errMalformedRevocation, err)
	}
	switch {
	case m.SessionID != nil && m.UserID == nil && !m.All:
		return Revocation{SessionID: *m.SessionID}, nil
	case m.SessionID == nil && m.UserID != nil && m.All:
		return Revocation{UserID: *m.UserID, All: true}, nil
	default:
		return Revocation{}, errMalformedRevocation
	}
}

// RevocationPublisher は失効イベントを publish する。
type RevocationPublisher struct {
	rdb *goredis.Client
}

// NewRevocationPublisher は RevocationPublisher を返す。
func NewRevocationPublisher(rdb *goredis.Client) *RevocationPublisher {
	return &RevocationPublisher{rdb: rdb}
}

// RevokeSession は sid のセッションが失効したことを通知する。
func (p *RevocationPublisher) RevokeSession(ctx context.Context, sid ulid.ULID) error {
	return p.publish(ctx, revocationMessage{SessionID: &sid})
}

// RevokeAllSessions は userID のすべてのセッションが失効したことを通知する。
func (p *RevocationPublisher) RevokeAllSessions(ctx context.Context, userID ulid.ULID) error {
	return p.publish(ctx, revocationMessage{UserID: &userID, All: true})
}

func (p *RevocationPublisher) publish(ctx context.Context, m revocationMessage) error {
	b, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("marshal revocation: %w", err)
	}
	if err := p.rdb.Publish(ctx, RevocationChannel, b).Err(); err != nil {
		return fmt.Errorf("publish revocation: %w", err)
	}
	return nil
}

// RevocationSubscription は失効イベントの購読。Phase 4 で Hub が接続を切るのに使う（失効フック）。
type RevocationSubscription struct {
	ps     *goredis.PubSub
	logger *slog.Logger
}

// SubscribeRevocations は購読を開始し、Redis が購読を確認してから返す。
// 確認を待つのは、戻った直後に publish されたイベントを取りこぼさないため（テストもこれで同期する）。
func SubscribeRevocations(ctx context.Context, rdb *goredis.Client, logger *slog.Logger) (*RevocationSubscription, error) {
	ps := rdb.Subscribe(ctx, RevocationChannel)
	if _, err := ps.Receive(ctx); err != nil {
		_ = ps.Close()
		return nil, fmt.Errorf("subscribe %s: %w", RevocationChannel, err)
	}
	return &RevocationSubscription{ps: ps, logger: logger}, nil
}

// Run は ctx がキャンセルされるまでイベントを受け取り、1 件ずつ fn を呼ぶ。戻るときに購読を閉じる。
// 壊れたメッセージはログに残して読み飛ばす（1 件のせいで以降の失効を受け取れなくなるのを避ける）。
func (s *RevocationSubscription) Run(ctx context.Context, fn func(context.Context, Revocation)) error {
	defer func() { _ = s.ps.Close() }()
	ch := s.ps.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case msg, ok := <-ch:
			if !ok {
				return errors.New("authn: revocation subscription closed")
			}
			rev, err := decodeRevocation(msg.Payload)
			if err != nil {
				s.logger.WarnContext(ctx, "ignored revocation message", slog.Any("error", err))
				continue
			}
			fn(ctx, rev)
		}
	}
}
