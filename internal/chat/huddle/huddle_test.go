package huddle_test

import (
	"crypto/rand"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/huddle"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

var (
	t0  = time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	ids = id.NewGenerator(clock.NewFake(t0), rand.Reader)
)

// newStore は実物の Redis に向けた Store を返す。テストごとに名前空間を分けるので、並行に動くテストと混ざらない
// （心拍の期限の一覧は全体で 1 つなので、分けないとほかのテストの掃除が参加を外してしまう）。
func newStore(t *testing.T) *huddle.Store {
	t.Helper()
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	return huddle.NewNamespaced(rdb, "test:"+ids.New().String()+":")
}

func participant(huddleID, userID ulid.ULID, joinedAt time.Time) chat.HuddleParticipant {
	return chat.HuddleParticipant{
		ID: ids.New(), HuddleID: huddleID, UserID: userID, AuthSessionID: ids.New(),
		SFUSessionID: "sfu-" + ids.New().String(), TrackName: "audio", JoinedAt: joinedAt,
	}
}

func snapshot(t *testing.T, s *huddle.Store, huddleID ulid.ULID, now time.Time) chat.HuddleSnapshot {
	t.Helper()
	snaps, err := s.Snapshots(t.Context(), []ulid.ULID{huddleID}, now)
	if err != nil {
		t.Fatal(err)
	}
	return snaps[huddleID]
}

func userIDs(ps []chat.HuddleParticipant) []ulid.ULID {
	out := make([]ulid.ULID, len(ps))
	for i, p := range ps {
		out[i] = p.UserID
	}
	return out
}

func TestJoinAndSnapshot(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	a, b := participant(h, ids.New(), t0), participant(h, ids.New(), t0.Add(time.Second))

	// 入った順に並ぶ（後から入った b を先に書いても）
	r1, err := s.Join(t.Context(), b, t0.Add(30*time.Second), 20)
	if err != nil {
		t.Fatal(err)
	}
	r2, err := s.Join(t.Context(), a, t0.Add(30*time.Second), 20)
	if err != nil {
		t.Fatal(err)
	}
	if r1.Evicted != nil || r2.Evicted != nil || r2.Version <= r1.Version {
		t.Errorf("results = %+v, %+v", r1, r2)
	}

	snap := snapshot(t, s, h, t0)
	if snap.Version != r2.Version || len(snap.Participants) != 2 {
		t.Fatalf("snapshot = %+v", snap)
	}
	if snap.Participants[0] != a || snap.Participants[1] != b {
		t.Errorf("participants = %+v", snap.Participants)
	}
	got, err := s.Participant(t.Context(), h, a.ID)
	if err != nil || got == nil || *got != a {
		t.Errorf("Participant = %+v, %v", got, err)
	}
	gotHuddle, gotParticipant, ok, err := s.Current(t.Context(), a.UserID)
	if err != nil || !ok || gotHuddle != h || gotParticipant != a.ID {
		t.Errorf("Current = %s %s %v %v", gotHuddle, gotParticipant, ok, err)
	}
}

// 人数の上限（決定 7）。同じ人が別の端末から入り直すだけなら、人数は増えない。
func TestJoinLimit(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	a, b := participant(h, ids.New(), t0), participant(h, ids.New(), t0)
	for _, p := range []chat.HuddleParticipant{a, b} {
		if _, err := s.Join(t.Context(), p, t0.Add(time.Minute), 2); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := s.Join(t.Context(), participant(h, ids.New(), t0), t0.Add(time.Minute), 2); !errors.Is(err, chat.ErrHuddleFull) {
		t.Errorf("third join err = %v", err)
	}
	moved := participant(h, a.UserID, t0.Add(time.Second))
	res, err := s.Join(t.Context(), moved, t0.Add(time.Minute), 2)
	if err != nil {
		t.Fatalf("moving device was rejected: %v", err)
	}
	if res.Evicted == nil || res.Evicted.Participant != a {
		t.Errorf("evicted = %+v", res.Evicted)
	}
}

// 1 人が入れるハドルは 1 つ。別のハドルに入ると前のハドルから抜ける（決定 6）。
func TestJoinAnotherHuddleEvicts(t *testing.T) {
	s := newStore(t)
	h1, h2 := ids.New(), ids.New()
	u := ids.New()
	first := participant(h1, u, t0)
	other := participant(h1, ids.New(), t0)
	for _, p := range []chat.HuddleParticipant{first, other} {
		if _, err := s.Join(t.Context(), p, t0.Add(time.Minute), 20); err != nil {
			t.Fatal(err)
		}
	}

	res, err := s.Join(t.Context(), participant(h2, u, t0.Add(time.Second)), t0.Add(time.Minute), 20)
	if err != nil {
		t.Fatal(err)
	}
	if res.Evicted == nil || res.Evicted.Participant != first || res.Evicted.Remaining != 1 {
		t.Fatalf("evicted = %+v", res.Evicted)
	}
	if res.Evicted.Version != snapshot(t, s, h1, t0).Version {
		t.Errorf("evicted version %d is not h1's version", res.Evicted.Version)
	}
	if got := userIDs(snapshot(t, s, h1, t0).Participants); len(got) != 1 || got[0] != other.UserID {
		t.Errorf("h1 participants = %v", got)
	}
}

func TestHeartbeat(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	p := participant(h, ids.New(), t0)
	if _, err := s.Join(t.Context(), p, t0.Add(30*time.Second), 20); err != nil {
		t.Fatal(err)
	}

	ok, err := s.Heartbeat(t.Context(), p.UserID, h, p.ID, t0.Add(time.Hour))
	if err != nil || !ok {
		t.Fatalf("Heartbeat = %v, %v", ok, err)
	}
	// 別の参加（前の端末）の心拍は、もう外れているので false
	if ok, _ := s.Heartbeat(t.Context(), p.UserID, h, ids.New(), t0.Add(time.Hour)); ok {
		t.Error("heartbeat for an unknown participant succeeded")
	}
	if _, err := s.Remove(t.Context(), h, p.ID); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.Heartbeat(t.Context(), p.UserID, h, p.ID, t0.Add(time.Hour)); ok {
		t.Error("heartbeat after removal succeeded")
	}
}

// 心拍の期限を過ぎた参加だけを外す（決定 5）。
func TestSweep(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	base := t0
	stale, fresh := participant(h, ids.New(), base), participant(h, ids.New(), base)
	if _, err := s.Join(t.Context(), stale, base.Add(10*time.Second), 20); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(t.Context(), fresh, base.Add(10*time.Second), 20); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.Heartbeat(t.Context(), fresh.UserID, h, fresh.ID, base.Add(time.Hour)); !ok {
		t.Fatal("heartbeat failed")
	}

	removed, err := s.Sweep(t.Context(), base.Add(20*time.Second), 1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || removed[0].Participant != stale || removed[0].Remaining != 1 {
		t.Fatalf("swept = %+v", removed)
	}
	if got := userIDs(snapshot(t, s, h, base).Participants); len(got) != 1 || got[0] != fresh.UserID {
		t.Errorf("participants = %v", got)
	}
	if _, _, ok, _ := s.Current(t.Context(), stale.UserID); ok {
		t.Error("swept user is still current")
	}
}

func TestRemoveIsIdempotent(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	p := participant(h, ids.New(), t0)
	if _, err := s.Join(t.Context(), p, t0.Add(time.Minute), 20); err != nil {
		t.Fatal(err)
	}

	r, err := s.Remove(t.Context(), h, p.ID)
	if err != nil || r == nil || r.Participant != p || r.Remaining != 0 {
		t.Fatalf("Remove = %+v, %v", r, err)
	}
	again, err := s.Remove(t.Context(), h, p.ID)
	if err != nil || again != nil {
		t.Errorf("second Remove = %+v, %v", again, err)
	}
}

func TestSetMuted(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	p := participant(h, ids.New(), t0)
	if _, err := s.Join(t.Context(), p, t0.Add(time.Minute), 20); err != nil {
		t.Fatal(err)
	}

	v, ok, err := s.SetMuted(t.Context(), h, p.ID, true)
	if err != nil || !ok {
		t.Fatalf("SetMuted = %d, %v, %v", v, ok, err)
	}
	snap := snapshot(t, s, h, t0)
	if !snap.Participants[0].Muted || snap.Version != v {
		t.Errorf("snapshot = %+v", snap)
	}
	// ほかの項目はそのまま（Lua で JSON を書き直しても崩れない）
	want := p
	want.Muted = true
	if snap.Participants[0] != want {
		t.Errorf("participant = %+v, want %+v", snap.Participants[0], want)
	}
	if _, ok, _ := s.SetMuted(t.Context(), h, ids.New(), true); ok {
		t.Error("SetMuted for an unknown participant succeeded")
	}
}

// 「もうすぐ参加する」は期限まで残り、入ったら消える（決定 11）。
func TestJoiningSoon(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	caller, callee := participant(h, ids.New(), t0), ids.New()
	if _, err := s.Join(t.Context(), caller, t0.Add(time.Minute), 20); err != nil {
		t.Fatal(err)
	}

	v, err := s.JoiningSoon(t.Context(), h, callee, t0.Add(5*time.Minute), t0)
	if err != nil {
		t.Fatal(err)
	}
	snap := snapshot(t, s, h, t0.Add(time.Minute))
	if len(snap.JoiningSoon) != 1 || snap.JoiningSoon[0] != callee || snap.Version != v {
		t.Errorf("snapshot = %+v", snap)
	}
	if got := snapshot(t, s, h, t0.Add(6*time.Minute)).JoiningSoon; len(got) != 0 {
		t.Errorf("expired joining soon = %v", got)
	}
	if _, err := s.Join(t.Context(), participant(h, callee, t0.Add(time.Minute)), t0.Add(2*time.Minute), 20); err != nil {
		t.Fatal(err)
	}
	if got := snapshot(t, s, h, t0.Add(time.Minute)).JoiningSoon; len(got) != 0 {
		t.Errorf("joining soon after joining = %v", got)
	}
}

func TestClear(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	a, b := participant(h, ids.New(), t0), participant(h, ids.New(), t0)
	for _, p := range []chat.HuddleParticipant{a, b} {
		if _, err := s.Join(t.Context(), p, t0.Add(time.Minute), 20); err != nil {
			t.Fatal(err)
		}
	}

	cleared, err := s.Clear(t.Context(), h)
	if err != nil || len(cleared) != 2 {
		t.Fatalf("Clear = %+v, %v", cleared, err)
	}
	snap := snapshot(t, s, h, t0)
	if len(snap.Participants) != 0 || snap.Version != 0 {
		t.Errorf("snapshot after clear = %+v", snap)
	}
	for _, p := range []chat.HuddleParticipant{a, b} {
		if _, _, ok, _ := s.Current(t.Context(), p.UserID); ok {
			t.Errorf("%s is still current", p.UserID)
		}
	}
}

// 並行に入っても、上限を超えない（決定 7。CLAUDE.md の並行テスト）。
func TestConcurrentJoinsRespectLimit(t *testing.T) {
	s := newStore(t)
	h := ids.New()
	const limit, tries = 20, 50
	var wg sync.WaitGroup
	var mu sync.Mutex
	joined, full := 0, 0
	for range tries {
		wg.Go(func() {
			_, err := s.Join(t.Context(), participant(h, ids.New(), t0), t0.Add(time.Minute), limit)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				joined++
			case errors.Is(err, chat.ErrHuddleFull):
				full++
			default:
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if joined != limit || full != tries-limit {
		t.Errorf("joined %d, full %d", joined, full)
	}
	if n := len(snapshot(t, s, h, t0).Participants); n != limit {
		t.Errorf("participants = %d", n)
	}
}

// 発行した TURN の認証情報を覚え、外すときに期限の切れていないものだけを返して忘れる（決定 8・14）。
func TestICEUsernames(t *testing.T) {
	s := newStore(t)
	u := ids.New()
	for _, r := range []struct {
		name    string
		expires time.Time
	}{{"old", t0.Add(-time.Hour)}, {"live-1", t0.Add(time.Hour)}, {"live-2", t0.Add(2 * time.Hour)}} {
		if err := s.RecordICEUsername(t.Context(), u, r.name, r.expires, t0.Add(-2*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}

	got, err := s.TakeICEUsernames(t.Context(), u, t0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "live-1" || got[1] != "live-2" {
		t.Errorf("usernames = %v", got)
	}
	if again, _ := s.TakeICEUsernames(t.Context(), u, t0); len(again) != 0 {
		t.Errorf("usernames after take = %v", again)
	}
}
