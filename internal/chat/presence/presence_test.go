package presence_test

import (
	"crypto/rand"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/shun2218-dev/hibari/internal/chat/presence"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

func setup(t *testing.T) (*presence.Store, *goredis.Client, id.Generator) {
	t.Helper()
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	// キーは ULID を含むので、テストの実行やパッケージをまたいで衝突しない。
	return presence.New(rdb), rdb, id.NewGenerator(clock.NewFake(time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)), rand.Reader)
}

func TestOnline(t *testing.T) {
	st, rdb, ids := setup(t)
	alice, bob, carol := ids.New(), ids.New(), ids.New()

	if err := st.SetOnline(t.Context(), alice, bob); err != nil {
		t.Fatal(err)
	}
	got, err := st.Online(t.Context(), []ulid.ULID{alice, bob, carol})
	if err != nil {
		t.Fatal(err)
	}
	if !got[alice] || !got[bob] || got[carol] || len(got) != 2 {
		t.Fatalf("Online() = %v, want alice and bob", got)
	}

	// TTL で消えるので、接続が残っている間は延ばし続ける必要がある。待たずに TTL の値を確かめる。
	ttl, err := rdb.TTL(t.Context(), "presence:"+alice.String()).Result()
	if err != nil {
		t.Fatal(err)
	}
	if ttl <= presence.RefreshInterval || ttl > presence.OnlineTTL {
		t.Errorf("presence TTL = %v, want (%v, %v]", ttl, presence.RefreshInterval, presence.OnlineTTL)
	}

	if err := st.SetOffline(t.Context(), alice); err != nil {
		t.Fatal(err)
	}
	got, err = st.Online(t.Context(), []ulid.ULID{alice, bob})
	if err != nil {
		t.Fatal(err)
	}
	if got[alice] || !got[bob] {
		t.Fatalf("Online() after SetOffline(alice) = %v", got)
	}

	if got, err := st.Online(t.Context(), nil); err != nil || len(got) != 0 {
		t.Fatalf("Online(nil) = %v, %v", got, err)
	}
}

func TestStartTyping(t *testing.T) {
	st, rdb, ids := setup(t)
	room, other, alice, bob := ids.New(), ids.New(), ids.New(), ids.New()

	for _, tt := range []struct {
		name       string
		room, user ulid.ULID
		want       bool
	}{
		{"first", room, alice, true},
		// TTL の間は配信し直さない。
		{"again within ttl", room, alice, false},
		{"other user", room, bob, true},
		{"other room", other, alice, true},
	} {
		got, err := st.StartTyping(t.Context(), tt.room, tt.user)
		if err != nil || got != tt.want {
			t.Errorf("%s: StartTyping() = %v, %v; want %v", tt.name, got, err, tt.want)
		}
	}

	ttl, err := rdb.PTTL(t.Context(), "typing:"+room.String()+":"+alice.String()).Result()
	if err != nil {
		t.Fatal(err)
	}
	if ttl <= 0 || ttl > presence.TypingTTL {
		t.Errorf("typing TTL = %v, want (0, %v]", ttl, presence.TypingTTL)
	}
	// TTL が切れた後は、もう一度配信する。
	if err := rdb.Del(t.Context(), "typing:"+room.String()+":"+alice.String()).Err(); err != nil {
		t.Fatal(err)
	}
	if got, err := st.StartTyping(t.Context(), room, alice); err != nil || !got {
		t.Errorf("StartTyping() after expiry = %v, %v; want true", got, err)
	}
}
