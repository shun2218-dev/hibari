// Package presence は presence（オンラインか）と typing（入力中か）を Redis に置く。
//
// どちらも失われても困らない一時的な状態なので、Postgres には書かず、TTL 付きのキーだけで持つ（CLAUDE.md ルール 5）。
// 最終オンライン時刻や離席は持たない（docs/ui の「presence はオンラインのドットだけ」）。
package presence

import (
	"context"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"
)

const (
	// OnlineTTL は presence のキーの寿命。接続が残っている間は Hub が RefreshInterval ごとに延ばす（ADR 0015）。
	// プロセスが落ちて offline のイベントが出なくても、この時間でオフラインに戻る。
	OnlineTTL = 60 * time.Second
	// RefreshInterval は presence の TTL を延ばす間隔。OnlineTTL より十分短くして、1 回の遅れでオフラインに見えないようにする。
	RefreshInterval = 30 * time.Second
	// TypingTTL は typing のキーの寿命。この間は同じユーザーの同じルームの typing.started を配信し直さない。
	TypingTTL = 5 * time.Second
)

// Store は presence と typing の Redis の読み書き。
type Store struct {
	rdb *goredis.Client
}

// New は Store を返す。
func New(rdb *goredis.Client) *Store {
	return &Store{rdb: rdb}
}

func onlineKey(userID ulid.ULID) string {
	return "presence:" + userID.String()
}

func typingKey(roomID, userID ulid.ULID) string {
	return "typing:" + roomID.String() + ":" + userID.String()
}

// SetOnline は userIDs をオンラインにし、TTL を OnlineTTL に延ばす。接続したときと、接続中の定期的な延長の両方で使う。
func (s *Store) SetOnline(ctx context.Context, userIDs ...ulid.ULID) error {
	if len(userIDs) == 0 {
		return nil
	}
	_, err := s.rdb.Pipelined(ctx, func(p goredis.Pipeliner) error {
		for _, id := range userIDs {
			p.Set(ctx, onlineKey(id), "1", OnlineTTL)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("set presence: %w", err)
	}
	return nil
}

// SetOffline は userID をオフラインにする。
func (s *Store) SetOffline(ctx context.Context, userID ulid.ULID) error {
	if err := s.rdb.Del(ctx, onlineKey(userID)).Err(); err != nil {
		return fmt.Errorf("delete presence: %w", err)
	}
	return nil
}

// Online は userIDs のうちオンラインのユーザーを返す。1 回の MGET で読む（一覧で N+1 にしない）。
func (s *Store) Online(ctx context.Context, userIDs []ulid.ULID) (map[ulid.ULID]bool, error) {
	online := make(map[ulid.ULID]bool, len(userIDs))
	if len(userIDs) == 0 {
		return online, nil
	}
	keys := make([]string, len(userIDs))
	for i, id := range userIDs {
		keys[i] = onlineKey(id)
	}
	values, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("get presence: %w", err)
	}
	for i, v := range values {
		if v != nil {
			online[userIDs[i]] = true
		}
	}
	return online, nil
}

// StartTyping は userID がルームで入力中であることを TypingTTL の間だけ記録する。
// すでに記録されていれば何もせず false を返す。true のときだけ typing.started を配信する（配信を 5 秒に 1 回に間引く。ADR 0015）。
func (s *Store) StartTyping(ctx context.Context, roomID, userID ulid.ULID) (bool, error) {
	ok, err := s.rdb.SetNX(ctx, typingKey(roomID, userID), "1", TypingTTL).Result()
	if err != nil {
		return false, fmt.Errorf("set typing: %w", err)
	}
	return ok, nil
}
