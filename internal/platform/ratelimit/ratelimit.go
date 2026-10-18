// Package ratelimit は Redis の固定ウィンドウでリクエストの回数を制限する。
//
// 固定ウィンドウは「ウィンドウの境界の前後で最大 2 倍まで通る」弱点があるが、
// 実装が INCR 1 回で済み、Redis のキーも 1 つなので読みやすい。
// 目的は総当たりや大量送信のコストを上げることで、厳密な流量制御ではないので、これで足りる。
package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
)

// Rule は 1 種類の制限。Name は Redis のキーの一部になるので、ルールごとに一意にする。
type Rule struct {
	Name   string
	Limit  int
	Window time.Duration
}

// Decision は判定の結果。
type Decision struct {
	Allowed bool
	// RetryAfter は拒否したときに、次のウィンドウが始まるまでの時間。
	RetryAfter time.Duration
}

// Limiter は Redis に回数を記録する。
type Limiter struct {
	rdb   *goredis.Client
	clock clock.Clock
}

// New は Limiter を返す。
func New(rdb *goredis.Client, clk clock.Clock) *Limiter {
	return &Limiter{rdb: rdb, clock: clk}
}

// Allow は rule の key に対する 1 回分を数え、制限内なら Allowed を返す。拒否した回も数える。
//
// ウィンドウは Redis の TTL ではなく Clock の時刻から決める（キーにウィンドウの番号を含める）。
// テストで Clock を進めるだけで次のウィンドウに移れるようにするためと、
// 複数台のサーバーで同じ時刻の区切りを共有するため。
func (l *Limiter) Allow(ctx context.Context, rule Rule, key string) (Decision, error) {
	now := l.clock.Now()
	window := now.UnixNano() / int64(rule.Window)
	windowEnd := time.Unix(0, (window+1)*int64(rule.Window))
	// key には email や IP が入る。Redis の中身を見たときに個人情報が並ばないよう、ハッシュにする。
	sum := sha256.Sum256([]byte(key))
	redisKey := fmt.Sprintf("ratelimit:%s:%d:%s", rule.Name, window, hex.EncodeToString(sum[:16]))

	var incr *goredis.IntCmd
	_, err := l.rdb.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		incr = p.Incr(ctx, redisKey)
		// キーの掃除のためだけの TTL。判定には使わないので、時計のずれを見込んで長めにする。
		p.ExpireNX(ctx, redisKey, rule.Window+time.Minute)
		return nil
	})
	if err != nil {
		return Decision{}, fmt.Errorf("rate limit %s: %w", rule.Name, err)
	}
	if incr.Val() > int64(rule.Limit) {
		return Decision{Allowed: false, RetryAfter: windowEnd.Sub(now)}, nil
	}
	return Decision{Allowed: true}, nil
}
