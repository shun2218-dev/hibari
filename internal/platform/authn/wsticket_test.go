package authn_test

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

func TestWSTickets(t *testing.T) {
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	tickets := authn.NewWSTickets(rdb, rand.Reader)
	ids := id.NewGenerator(clock.NewFake(time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)), rand.Reader)
	who := authn.Identity{UserID: ids.New(), SessionID: ids.New()}

	t.Run("issue and consume once", func(t *testing.T) {
		ticket, err := tickets.Issue(t.Context(), who)
		if err != nil {
			t.Fatal(err)
		}
		if len(ticket) != 43 {
			t.Errorf("ticket length = %d, want 43", len(ticket))
		}
		// 待たずに、寿命が ADR 0007 の 30 秒で設定されていることを確かめる。
		ttl, err := rdb.PTTL(t.Context(), "authn:wsticket:"+ticket).Result()
		if err != nil || ttl <= 0 || ttl > authn.WSTicketTTL {
			t.Errorf("ticket TTL = %v, %v; want (0, %v]", ttl, err, authn.WSTicketTTL)
		}
		got, err := tickets.Consume(t.Context(), ticket)
		if err != nil || got != who {
			t.Fatalf("Consume() = %+v, %v; want %+v", got, err, who)
		}
		// 使い捨て。
		if _, err := tickets.Consume(t.Context(), ticket); !errors.Is(err, authn.ErrInvalidWSTicket) {
			t.Fatalf("second Consume() error = %v, want ErrInvalidWSTicket", err)
		}
	})

	t.Run("invalid tickets", func(t *testing.T) {
		issued, err := tickets.Issue(t.Context(), who)
		if err != nil {
			t.Fatal(err)
		}
		// 形式は正しいが発行していない値。
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		neverIssued := base64.RawURLEncoding.EncodeToString(b)
		for _, ticket := range []string{"", "short", strings.Repeat("A", 44), "!" + issued[1:], neverIssued} {
			if _, err := tickets.Consume(t.Context(), ticket); !errors.Is(err, authn.ErrInvalidWSTicket) {
				t.Errorf("Consume(%q) error = %v, want ErrInvalidWSTicket", ticket, err)
			}
		}
	})

	// 同じチケットで同時に接続しても、成功するのは 1 本だけ。
	t.Run("concurrent consume", func(t *testing.T) {
		ticket, err := tickets.Issue(t.Context(), who)
		if err != nil {
			t.Fatal(err)
		}
		var ok atomic.Int32
		var wg sync.WaitGroup
		for range 50 {
			wg.Go(func() {
				if _, err := tickets.Consume(t.Context(), ticket); err == nil {
					ok.Add(1)
				} else if !errors.Is(err, authn.ErrInvalidWSTicket) {
					t.Errorf("Consume() error = %v", err)
				}
			})
		}
		wg.Wait()
		if ok.Load() != 1 {
			t.Fatalf("successful consumes = %d, want 1", ok.Load())
		}
	})
}
