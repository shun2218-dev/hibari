package authn

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

func TestDecodeRevocation(t *testing.T) {
	ids := id.NewGenerator(clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)), rand.Reader)
	sid, uid := ids.New(), ids.New()

	tests := []struct {
		name    string
		payload string
		want    Revocation
		wantErr bool
	}{
		{name: "session", payload: `{"sid":"` + sid.String() + `"}`, want: Revocation{SessionID: sid}},
		{name: "all sessions of user", payload: `{"user_id":"` + uid.String() + `","all":true}`, want: Revocation{UserID: uid, All: true}},
		{name: "user without all", payload: `{"user_id":"` + uid.String() + `"}`, wantErr: true},
		{name: "both sid and user", payload: `{"sid":"` + sid.String() + `","user_id":"` + uid.String() + `","all":true}`, wantErr: true},
		{name: "empty object", payload: `{}`, wantErr: true},
		{name: "invalid ulid", payload: `{"sid":"nope"}`, wantErr: true},
		{name: "not json", payload: `sid`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeRevocation(tt.payload)
			if tt.wantErr {
				if !errors.Is(err, errMalformedRevocation) {
					t.Fatalf("error = %v, want errMalformedRevocation", err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("decodeRevocation() = %+v, %v; want %+v", got, err, tt.want)
			}
		})
	}
}

// publish した失効イベントを、実物の Redis の Pub/Sub 経由で購読側が受け取れる。
func TestRevocationPublishAndSubscribe(t *testing.T) {
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })

	sub, err := SubscribeRevocations(t.Context(), rdb, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	received := make(chan Revocation, 4)
	done := make(chan error, 1)
	go func() {
		done <- sub.Run(ctx, func(_ context.Context, r Revocation) { received <- r })
	}()

	ids := id.NewGenerator(clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)), rand.Reader)
	sid, uid := ids.New(), ids.New()
	pub := NewRevocationPublisher(rdb)
	// 壊れたメッセージは読み飛ばし、以降のイベントは受け取り続ける。
	if err := rdb.Publish(t.Context(), RevocationChannel, "garbage").Err(); err != nil {
		t.Fatal(err)
	}
	if err := pub.RevokeSession(t.Context(), sid); err != nil {
		t.Fatal(err)
	}
	if err := pub.RevokeAllSessions(t.Context(), uid); err != nil {
		t.Fatal(err)
	}

	// テストが並行して動く他のパッケージも同じチャンネルに publish しうるので、目的のイベントが届くまで読む。
	want := []Revocation{{SessionID: sid}, {UserID: uid, All: true}}
	timeout := time.After(10 * time.Second)
	for len(want) > 0 {
		select {
		case got := <-received:
			if got == want[0] {
				want = want[1:]
			}
		case err := <-done:
			t.Fatalf("Run() returned early: %v", err)
		case <-timeout:
			t.Fatalf("did not receive %+v", want)
		}
	}

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run() after cancel = %v, want nil", err)
	}
}
