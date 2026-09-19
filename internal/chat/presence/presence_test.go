package presence_test

import (
	"crypto/rand"
	"sync"
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

var ids = id.NewGenerator(clock.NewFake(time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)), rand.Reader)

func openRedis(t *testing.T) *goredis.Client {
	t.Helper()
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

// listen は channel を購読し、Redis が購読を確認してから、届いた payload を流す Go の channel を返す。
func listen(t *testing.T, rdb *goredis.Client, channel string) <-chan string {
	t.Helper()
	ps := rdb.Subscribe(t.Context(), channel)
	t.Cleanup(func() { _ = ps.Close() })
	if _, err := ps.Receive(t.Context()); err != nil {
		t.Fatal(err)
	}
	out := make(chan string, 1000)
	go func() {
		for m := range ps.Channel() {
			out <- m.Payload
		}
	}()
	return out
}

// received は、いまの時点で届いている payload を返す。publish はスクリプトの中で同期的に行われるので、
// 「届かないこと」は、後から publish した目印が届くまでに届いていないことで確かめる。
func received(t *testing.T, rdb *goredis.Client, channel string, ch <-chan string) []string {
	t.Helper()
	if err := rdb.Publish(t.Context(), channel, "marker").Err(); err != nil {
		t.Fatal(err)
	}
	var got []string
	timeout := time.After(5 * time.Second)
	for {
		select {
		case p := <-ch:
			if p == "marker" {
				return got
			}
			got = append(got, p)
		case <-timeout:
			t.Fatal("marker not received within 5s")
		}
	}
}

func announce(channel, payload string) presence.Announcement {
	return presence.Announcement{Channels: []string{channel}, Payload: []byte(payload)}
}

// 複数のインスタンスに接続していても、最初の接続でだけオンライン、最後の切断でだけオフラインを知らせる。
func TestConnectDisconnectAcrossInstances(t *testing.T) {
	rdb := openRedis(t)
	a, b := presence.New(rdb, ids.New()), presence.New(rdb, ids.New())
	alice, bob := ids.New(), ids.New()
	channel := "test:presence:" + ids.New().String()
	events := listen(t, rdb, channel)
	online := func() map[ulid.ULID]bool {
		t.Helper()
		got, err := a.Online(t.Context(), []ulid.ULID{alice, bob})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}

	steps := []struct {
		name       string
		do         func() (bool, error)
		wantFirst  bool
		wantEvents []string
		wantOnline bool
	}{
		{"connect on A", func() (bool, error) { return a.Connect(t.Context(), alice, announce(channel, "on")) }, true, []string{"on"}, true},
		{"connect on B", func() (bool, error) { return b.Connect(t.Context(), alice, announce(channel, "on")) }, false, nil, true},
		{"disconnect from A", func() (bool, error) { return a.Disconnect(t.Context(), alice, announce(channel, "off")) }, false, nil, true},
		{"disconnect from B", func() (bool, error) { return b.Disconnect(t.Context(), alice, announce(channel, "off")) }, true, []string{"off"}, false},
	}
	for _, s := range steps {
		got, err := s.do()
		if err != nil || got != s.wantFirst {
			t.Fatalf("%s = %v, %v; want %v", s.name, got, err, s.wantFirst)
		}
		if ev := received(t, rdb, channel, events); len(ev) != len(s.wantEvents) || (len(ev) > 0 && ev[0] != s.wantEvents[0]) {
			t.Fatalf("%s published %v, want %v", s.name, ev, s.wantEvents)
		}
		if got := online(); got[alice] != s.wantOnline || got[bob] {
			t.Fatalf("%s: Online() = %v, want alice=%v", s.name, got, s.wantOnline)
		}
	}

	if got, err := a.Online(t.Context(), nil); err != nil || len(got) != 0 {
		t.Fatalf("Online(nil) = %v, %v", got, err)
	}
}

// インスタンスが落ちて Disconnect を呼べなくても、そのインスタンスのフィールドは TTL で消えてオフラインに戻る。
func TestCrashedInstanceExpires(t *testing.T) {
	rdb := openRedis(t)
	crashed, alive := ids.New(), presence.New(rdb, ids.New())
	alice := ids.New()
	key := "presence:" + alice.String()
	if _, err := presence.New(rdb, crashed).Connect(t.Context(), alice, presence.Announcement{}); err != nil {
		t.Fatal(err)
	}

	// TTL が付いていて、Refresh の間隔より長いこと。
	ttls, err := rdb.HTTL(t.Context(), key, crashed.String()).Result()
	if err != nil {
		t.Fatal(err)
	}
	if len(ttls) != 1 || time.Duration(ttls[0])*time.Second <= presence.RefreshInterval || time.Duration(ttls[0])*time.Second > presence.OnlineTTL {
		t.Fatalf("field TTL = %v s, want (%v, %v]", ttls, presence.RefreshInterval, presence.OnlineTTL)
	}

	// 期限を 1 ミリ秒に縮めて、TTL が切れた状態を作る。期限切れのフィールドは数えない（HLEN ではなく HKEYS で数える）。
	if err := rdb.HPExpire(t.Context(), key, time.Millisecond, crashed.String()).Err(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		got, err := alive.Online(t.Context(), []ulid.ULID{alice})
		return err == nil && !got[alice]
	})

	// 期限切れの後の接続は、最初の接続としてオンラインを知らせる。
	first, err := alive.Connect(t.Context(), alice, presence.Announcement{})
	if err != nil || !first {
		t.Fatalf("Connect() after the other instance expired = %v, %v; want true", first, err)
	}
}

func TestRefresh(t *testing.T) {
	rdb := openRedis(t)
	instance := ids.New()
	st := presence.New(rdb, instance)
	alice, bob := ids.New(), ids.New()
	if _, err := st.Connect(t.Context(), alice, presence.Announcement{}); err != nil {
		t.Fatal(err)
	}
	if err := rdb.HExpire(t.Context(), "presence:"+alice.String(), 5*time.Second, instance.String()).Err(); err != nil {
		t.Fatal(err)
	}

	// 延ばすのは TTL だけ。消えていたフィールド（bob）も置き直す。
	if err := st.Refresh(t.Context(), alice, bob); err != nil {
		t.Fatal(err)
	}
	for _, u := range []ulid.ULID{alice, bob} {
		ttls, err := rdb.HTTL(t.Context(), "presence:"+u.String(), instance.String()).Result()
		if err != nil {
			t.Fatal(err)
		}
		if len(ttls) != 1 || time.Duration(ttls[0])*time.Second <= presence.RefreshInterval {
			t.Errorf("TTL of %s after Refresh = %v s", u, ttls)
		}
	}
	if err := st.Refresh(t.Context()); err != nil {
		t.Fatalf("Refresh() without users = %v", err)
	}
}

// 2 つのインスタンスで同じユーザーの接続と切断が並行しても、イベントは状態の変わった順に並ぶ
// （online と offline が交互になり、最後のイベントが最終的な状態と一致する）。
func TestConcurrentTransitionsKeepEventOrder(t *testing.T) {
	rdb := openRedis(t)
	a, b := presence.New(rdb, ids.New()), presence.New(rdb, ids.New())
	alice := ids.New()
	channel := "test:presence:" + ids.New().String()
	events := listen(t, rdb, channel)

	var wg sync.WaitGroup
	for _, st := range []*presence.Store{a, b} {
		wg.Go(func() {
			// Hub はユーザーごとに接続と切断を直列にするので、1 つのインスタンスの中では順番に呼ぶ。
			for range 100 {
				if _, err := st.Connect(t.Context(), alice, announce(channel, "on")); err != nil {
					t.Error(err)
					return
				}
				if _, err := st.Disconnect(t.Context(), alice, announce(channel, "off")); err != nil {
					t.Error(err)
					return
				}
			}
		})
	}
	wg.Wait()
	if _, err := a.Connect(t.Context(), alice, announce(channel, "on")); err != nil {
		t.Fatal(err)
	}

	got := received(t, rdb, channel, events)
	if len(got) == 0 || got[len(got)-1] != "on" {
		t.Fatalf("last event = %v, want on", got)
	}
	for i, p := range got {
		want := "on"
		if i%2 == 1 {
			want = "off"
		}
		if p != want {
			t.Fatalf("event %d = %q, want %q (events must alternate)", i, p, want)
		}
	}
}

func TestStartTyping(t *testing.T) {
	rdb := openRedis(t)
	st := presence.New(rdb, ids.New())
	room, other, alice, bob := ids.New(), ids.New(), ids.New(), ids.New()
	thread, otherThread := ids.New(), ids.New()

	for _, tt := range []struct {
		name       string
		room, user ulid.ULID
		thread     *ulid.ULID
		want       bool
	}{
		{"first", room, alice, nil, true},
		// TTL の間は配信し直さない。
		{"again within ttl", room, alice, nil, false},
		{"other user", room, bob, nil, true},
		{"other room", other, alice, nil, true},
		// スレッドはチャンネルと別に間引く（ADR 0036）。
		{"thread in the same room", room, alice, &thread, true},
		{"same thread within ttl", room, alice, &thread, false},
		{"other thread", room, alice, &otherThread, true},
	} {
		got, err := st.StartTyping(t.Context(), tt.room, tt.user, tt.thread)
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
	if got, err := st.StartTyping(t.Context(), room, alice, nil); err != nil || !got {
		t.Errorf("StartTyping() after expiry = %v, %v; want true", got, err)
	}
}

// waitFor は cond が true になるまで待つ。time.Sleep を使わず、ticker で確かめる。
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	timeout := time.After(5 * time.Second)
	for !cond() {
		select {
		case <-ticker.C:
		case <-timeout:
			t.Fatal("condition not met within 5s")
		}
	}
}
