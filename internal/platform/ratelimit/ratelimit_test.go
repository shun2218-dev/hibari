package ratelimit_test

import (
	"crypto/rand"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

func TestLimiterFixedWindow(t *testing.T) {
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })

	// ウィンドウの途中（12:05）から始める。
	clk := clock.NewFake(time.Date(2026, 9, 13, 12, 5, 0, 0, time.UTC))
	l := ratelimit.New(rdb, clk)
	// テスト用 Redis はパッケージや過去の実行と共有するので、ルール名を実行ごとに一意にする。
	rule := ratelimit.Rule{Name: "test-" + id.NewGenerator(clk, rand.Reader).New().String(), Limit: 3, Window: 15 * time.Minute}

	for i := range 3 {
		d, err := l.Allow(t.Context(), rule, "alice@example.com")
		if err != nil || !d.Allowed {
			t.Fatalf("attempt %d: %+v, %v; want allowed", i+1, d, err)
		}
	}
	d, err := l.Allow(t.Context(), rule, "alice@example.com")
	if err != nil || d.Allowed {
		t.Fatalf("attempt 4: %+v, %v; want denied", d, err)
	}
	// 12:00〜12:15 のウィンドウなので、12:05 からは 10 分。
	if d.RetryAfter != 10*time.Minute {
		t.Errorf("RetryAfter = %v, want 10m", d.RetryAfter)
	}

	// キーごとに独立して数える。
	if d, _ := l.Allow(t.Context(), rule, "bob@example.com"); !d.Allowed {
		t.Error("another key was denied")
	}

	// 次のウィンドウに入ると数え直す。
	clk.Advance(10 * time.Minute)
	if d, err := l.Allow(t.Context(), rule, "alice@example.com"); err != nil || !d.Allowed {
		t.Fatalf("next window: %+v, %v; want allowed", d, err)
	}
}
