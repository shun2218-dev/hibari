package huddle_test

import (
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/huddle"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// statusEnv は、ハドル中の印（ADR 0067 決定 3）を確かめる環境。印が配られるチャンネルを購読し、届いた中身を順に読む。
type statusEnv struct {
	store *huddle.Store
	rdb   *goredis.Client
	ps    *goredis.PubSub
	// ch はワークスペースごとの配る宛先（テストごとに名前を分け、ほかのテストの publish と混ざらないようにする）。
	ch map[ulid.ULID]string
}

func newStatusEnv(t *testing.T, workspaces ...ulid.ULID) *statusEnv {
	t.Helper()
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	e := &statusEnv{store: huddle.NewNamespaced(rdb, "test:"+ids.New().String()+":"), rdb: rdb, ch: map[ulid.ULID]string{}}
	var channels []string
	for _, ws := range workspaces {
		e.ch[ws] = "test-status:" + ids.New().String()
		channels = append(channels, e.ch[ws])
	}
	e.ps = rdb.Subscribe(t.Context(), channels...)
	t.Cleanup(func() { _ = e.ps.Close() })
	for range channels {
		if _, err := e.ps.Receive(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

// status は、userID が ws で入るときの印（中身はどのワークスペースの何かが分かる文字列にする）。
func (e *statusEnv) status(ws, userID ulid.ULID) chat.HuddleStatus {
	return chat.HuddleStatus{
		WorkspaceID: ws,
		Channels:    []string{e.ch[ws]},
		Joined:      []byte("in " + userID.String()),
		Left:        []byte("out " + userID.String()),
	}
}

// drain は、ここまでに配られた中身を宛先ごとに返す。最後に目印を publish し、それが届くまで読む（届かないことを確かめるため）。
func (e *statusEnv) drain(t *testing.T) map[string][]string {
	t.Helper()
	const mark = "--mark--"
	for _, ch := range e.ch {
		if err := e.rdb.Publish(t.Context(), ch, mark).Err(); err != nil {
			t.Fatal(err)
		}
	}
	got := map[string][]string{}
	pending := len(e.ch)
	timeout := time.After(5 * time.Second)
	for pending > 0 {
		select {
		case m := <-e.ps.Channel():
			if m.Payload == mark {
				pending--
				continue
			}
			got[m.Channel] = append(got[m.Channel], m.Payload)
		case <-timeout:
			t.Fatal("publish が届かない")
		}
	}
	return got
}

func (e *statusEnv) inHuddle(t *testing.T, ws, userID ulid.ULID) bool {
	t.Helper()
	in, err := e.store.InHuddle(t.Context(), ws, []ulid.ULID{userID})
	if err != nil {
		t.Fatal(err)
	}
	return in[userID]
}

func (e *statusEnv) join(t *testing.T, p chat.HuddleParticipant, status chat.HuddleStatus) {
	t.Helper()
	if _, err := e.store.Join(t.Context(), p, t0.Add(time.Minute), 20, status); err != nil {
		t.Fatal(err)
	}
}

// 印は、そのワークスペースで初めて付いたときと外れたときだけ配る。同じワークスペースの中で別のハドルや端末に移っても配らない。
func TestHuddleStatusTransitions(t *testing.T) {
	ws1, ws2 := ids.New(), ids.New()
	e := newStatusEnv(t, ws1, ws2)
	u := ids.New()
	in, out := "in "+u.String(), "out "+u.String()

	first := participant(ids.New(), u, t0)
	e.join(t, first, e.status(ws1, u))
	if got := e.drain(t); !slices.Equal(got[e.ch[ws1]], []string{in}) || len(got[e.ch[ws2]]) != 0 {
		t.Fatalf("入った: %v", got)
	}
	if !e.inHuddle(t, ws1, u) || e.inHuddle(t, ws2, u) {
		t.Fatal("入ったワークスペースでだけハドル中になる")
	}

	// 同じワークスペースの別のハドルへ、さらに別の端末へ移る
	other := participant(ids.New(), u, t0.Add(time.Second))
	e.join(t, other, e.status(ws1, u))
	device := participant(other.HuddleID, u, t0.Add(2*time.Second))
	e.join(t, device, e.status(ws1, u))
	if got := e.drain(t); len(got) != 0 {
		t.Fatalf("同じワークスペースの中で移っても配らない: %v", got)
	}
	// 移った後に古い参加を外しても（もう外れている）、いまの参加の印は残る
	if _, err := e.store.Remove(t.Context(), other.HuddleID, other.ID); err != nil {
		t.Fatal(err)
	}
	if !e.inHuddle(t, ws1, u) {
		t.Fatal("古い参加を外して、いまの参加の印まで外れた")
	}

	// 別のワークスペースのハドルへ移る
	elsewhere := participant(ids.New(), u, t0.Add(3*time.Second))
	e.join(t, elsewhere, e.status(ws2, u))
	if got := e.drain(t); !slices.Equal(got[e.ch[ws1]], []string{out}) || !slices.Equal(got[e.ch[ws2]], []string{in}) {
		t.Fatalf("別のワークスペースへ移った: %v", got)
	}
	if e.inHuddle(t, ws1, u) || !e.inHuddle(t, ws2, u) {
		t.Fatal("前のワークスペースで外れ、新しいワークスペースで付く")
	}

	// 抜ける
	if _, err := e.store.Remove(t.Context(), elsewhere.HuddleID, elsewhere.ID); err != nil {
		t.Fatal(err)
	}
	if got := e.drain(t); !slices.Equal(got[e.ch[ws2]], []string{out}) || len(got[e.ch[ws1]]) != 0 {
		t.Fatalf("抜けた: %v", got)
	}
	if e.inHuddle(t, ws2, u) {
		t.Fatal("抜けたらハドル中でなくなる")
	}
}

// 期限切れ（掃除のジョブ）とハドルの終わり（全員を外す）でも、抜けたときの中身が配られる。
func TestHuddleStatusSweepAndClear(t *testing.T) {
	ws := ids.New()
	e := newStatusEnv(t, ws)
	a, b := ids.New(), ids.New()

	pa := participant(ids.New(), a, t0)
	if _, err := e.store.Join(t.Context(), pa, t0.Add(30*time.Second), 20, e.status(ws, a)); err != nil {
		t.Fatal(err)
	}
	if _, err := e.store.Sweep(t.Context(), t0.Add(31*time.Second), 10); err != nil {
		t.Fatal(err)
	}
	pb := participant(ids.New(), b, t0)
	e.join(t, pb, e.status(ws, b))
	if _, err := e.store.Clear(t.Context(), pb.HuddleID); err != nil {
		t.Fatal(err)
	}

	want := []string{"in " + a.String(), "out " + a.String(), "in " + b.String(), "out " + b.String()}
	if got := e.drain(t); !slices.Equal(got[e.ch[ws]], want) {
		t.Fatalf("got %v, want %v", got[e.ch[ws]], want)
	}
	in, err := e.store.InHuddle(t.Context(), ws, []ulid.ULID{a, b})
	if err != nil {
		t.Fatal(err)
	}
	if len(in) != 0 {
		t.Fatalf("InHuddle = %v", in)
	}
}

// 同じ人が同じワークスペースのハドルに並行して入っても、印が付いたと配るのは 1 回だけ。
// 最後に残った参加を外すと、外れたと 1 回だけ配る（並行テスト。CLAUDE.md のテストの決まり）。
func TestHuddleStatusConcurrentJoins(t *testing.T) {
	ws := ids.New()
	e := newStatusEnv(t, ws)
	u := ids.New()

	var wg sync.WaitGroup
	for i := range 10 {
		wg.Go(func() {
			p := participant(ids.New(), u, t0.Add(time.Duration(i)*time.Millisecond))
			if _, err := e.store.Join(t.Context(), p, t0.Add(time.Minute), 20, e.status(ws, u)); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if got := e.drain(t); !slices.Equal(got[e.ch[ws]], []string{"in " + u.String()}) {
		t.Fatalf("入った: %v", got)
	}

	h, p, ok, err := e.store.Current(t.Context(), u)
	if err != nil || !ok {
		t.Fatalf("Current = %v, %v", ok, err)
	}
	if _, err := e.store.Remove(t.Context(), h, p); err != nil {
		t.Fatal(err)
	}
	if got := e.drain(t); !slices.Equal(got[e.ch[ws]], []string{"out " + u.String()}) {
		t.Fatalf("抜けた: %v", got)
	}
}

// 配る宛先がなければ（イベントを作れなかった）、印の出し入れだけをする。
func TestHuddleStatusWithoutChannels(t *testing.T) {
	ws := ids.New()
	e := newStatusEnv(t, ws)
	u := ids.New()

	p := participant(ids.New(), u, t0)
	e.join(t, p, chat.HuddleStatus{WorkspaceID: ws})
	if !e.inHuddle(t, ws, u) {
		t.Fatal("配らなくても印は付く")
	}
	if _, err := e.store.Remove(t.Context(), p.HuddleID, p.ID); err != nil {
		t.Fatal(err)
	}
	if got := e.drain(t); len(got) != 0 {
		t.Fatalf("配らない: %v", got)
	}
	if e.inHuddle(t, ws, u) {
		t.Fatal("抜けたら外れる")
	}
}
