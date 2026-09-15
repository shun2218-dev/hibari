package realtime_test

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// RedisDelivery と Broker の統合テスト。実物の Redis を使い、1 つのテストの中に 2 つのインスタンスを立てる。

// recorder は Broker から渡されたイベントと Resync を記録する Receiver。
type recorder struct {
	mu      sync.Mutex
	events  []chat.Event
	resyncs int
}

func (r *recorder) DeliverLocal(_ context.Context, ev chat.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, ev)
}

func (r *recorder) Resync(context.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.resyncs++
}

func (r *recorder) take() []chat.Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	evs := r.events
	r.events = nil
	return evs
}

func (r *recorder) resyncCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.resyncs
}

type instance struct {
	broker   *realtime.Broker
	received *recorder
	rdb      *goredis.Client
	stop     func()
}

// startInstance は Broker を起動する。clientName は Redis の CLIENT LIST で接続を見分けるための名前。
func startInstance(t *testing.T, clientName string) *instance {
	t.Helper()
	opt, err := goredis.ParseURL(testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	opt.ClientName = clientName
	rdb := goredis.NewClient(opt)
	t.Cleanup(func() { _ = rdb.Close() })

	broker, err := realtime.NewBroker(t.Context(), rdb, ids.New(), slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	in := &instance{broker: broker, received: &recorder{}, rdb: rdb}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		broker.Run(ctx, in.received)
	}()
	var once sync.Once
	in.stop = func() {
		once.Do(func() {
			cancel()
			<-done
		})
	}
	t.Cleanup(in.stop)
	return in
}

func (in *instance) acquire(t *testing.T, channel string) {
	t.Helper()
	if err := in.broker.Acquire(t.Context(), channel); err != nil {
		t.Fatalf("Acquire(%s) = %v", channel, err)
	}
}

// synced は、それまでに publish されたイベントを受け取り終えてから、受け取ったイベントを返す。
func (in *instance) synced(t *testing.T) []chat.Event {
	t.Helper()
	if err := in.broker.Sync(t.Context()); err != nil {
		t.Fatalf("Sync() = %v", err)
	}
	return in.received.take()
}

func types(evs []chat.Event) []chat.EventType {
	out := make([]chat.EventType, len(evs))
	for i, ev := range evs {
		out[i] = ev.Type
	}
	return out
}

func TestBrokerRoutesByChannel(t *testing.T) {
	a, b := startInstance(t, "test-a"), startInstance(t, "test-b")
	delivery := realtime.NewRedisDelivery(a.rdb, ids, slog.New(slog.DiscardHandler))
	room, other, alice := ids.New(), ids.New(), ids.New()

	// a はルームを、b は alice 本人のチャンネルとルームを購読している。
	a.acquire(t, "room:"+room.String())
	b.acquire(t, "room:"+room.String())
	b.acquire(t, "user:"+alice.String())

	delivery.Deliver(t.Context(), chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{room}}, Data: chat.Message{RoomID: room, Body: "hi"}})
	delivery.Deliver(t.Context(), chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{other}}, Data: chat.Message{RoomID: other}})
	// ルームと本人の両方に宛てたイベントは、両方を購読している b にも 1 回だけ渡す。
	delivery.Deliver(t.Context(), chat.Event{
		Type: chat.EventMemberJoined, To: chat.Audience{Rooms: []ulid.ULID{room}, Users: []ulid.ULID{alice}},
		Data: chat.MemberJoined{RoomID: room, User: chat.UserProfile{ID: alice}},
	})

	gotA, gotB := a.synced(t), b.synced(t)
	want := []chat.EventType{chat.EventMessageCreated, chat.EventMemberJoined}
	if !equalTypes(types(gotA), want...) || !equalTypes(types(gotB), want...) {
		t.Fatalf("a received %v, b received %v; want %v for both", types(gotA), types(gotB), want)
	}
	if m, ok := gotB[0].Data.(chat.Message); !ok || m.Body != "hi" {
		t.Errorf("decoded data = %+v", gotB[0].Data)
	}

	// 購読の数が 0 になるまでは受け取り続け、0 になったら受け取らない。
	b.acquire(t, "room:"+room.String())
	b.broker.Release("room:" + room.String())
	delivery.Deliver(t.Context(), chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{room}}, Data: chat.Message{RoomID: room}})
	if got := b.synced(t); len(got) != 1 {
		t.Fatalf("b received %v while still subscribed once", types(got))
	}
	b.broker.Release("room:" + room.String())
	delivery.Deliver(t.Context(), chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{room}}, Data: chat.Message{RoomID: room}})
	if got := b.synced(t); len(got) != 0 {
		t.Fatalf("b received %v after releasing the room", types(got))
	}
	if got := a.synced(t); len(got) != 2 {
		t.Fatalf("a received %d events, want 2", len(got))
	}
	if n := b.broker.Channels(); n != 1 {
		t.Errorf("b channels = %d, want 1 (user:alice)", n)
	}
}

// Acquire が戻った直後に publish されたイベントも受け取る（購読の ack の後に REST を読むクライアントが取りこぼさない）。
func TestAcquireWaitsForSubscription(t *testing.T) {
	in := startInstance(t, "test-acquire")
	delivery := realtime.NewRedisDelivery(in.rdb, ids, slog.New(slog.DiscardHandler))

	var wg sync.WaitGroup
	const n = 50
	for range n {
		wg.Go(func() {
			room := ids.New()
			if err := in.broker.Acquire(context.Background(), "room:"+room.String()); err != nil {
				t.Error(err)
				return
			}
			delivery.Deliver(context.Background(), chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{room}}, Data: chat.Message{RoomID: room}})
		})
	}
	wg.Wait()
	if got := in.synced(t); len(got) != n {
		t.Fatalf("received %d events, want %d", len(got), n)
	}
}

// Redis との接続が切れて張り直されたら、Resync を呼び、購読していたチャンネルを購読し直す。
func TestBrokerResyncsAfterReconnect(t *testing.T) {
	name := "test-reconnect-" + ids.New().String()
	in := startInstance(t, name)
	delivery := realtime.NewRedisDelivery(in.rdb, ids, slog.New(slog.DiscardHandler))
	room := ids.New()
	in.acquire(t, "room:"+room.String())

	killPubSubConnection(t, in.rdb, name)
	waitFor(t, func() bool { return in.received.resyncCount() == 1 })

	delivery.Deliver(t.Context(), chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{room}}, Data: chat.Message{RoomID: room}})
	if got := in.synced(t); len(got) != 1 {
		t.Fatalf("received %v after reconnect, want the message", types(got))
	}
}

// killPubSubConnection は、名前が name の Pub/Sub の接続を Redis の側から切る（Redis の再起動やネットワークの断の代わり）。
func killPubSubConnection(t *testing.T, rdb *goredis.Client, name string) {
	t.Helper()
	list, err := rdb.ClientList(t.Context()).Result()
	if err != nil {
		t.Fatal(err)
	}
	killed := 0
	for line := range strings.SplitSeq(strings.TrimSpace(list), "\n") {
		fields := map[string]string{}
		for kv := range strings.FieldsSeq(line) {
			k, v, _ := strings.Cut(kv, "=")
			fields[k] = v
		}
		// Pub/Sub の接続は、購読しているチャンネルの数（sub）が 1 以上。
		if sub, _ := strconv.Atoi(fields["sub"]); fields["name"] != name || sub == 0 {
			continue
		}
		clientID, _ := strconv.ParseInt(fields["id"], 10, 64)
		if err := rdb.ClientKillByFilter(t.Context(), "ID", strconv.FormatInt(clientID, 10)).Err(); err != nil {
			t.Fatal(err)
		}
		killed++
	}
	if killed != 1 {
		t.Fatalf("killed %d pubsub connections named %s, want 1", killed, name)
	}
}

// Redis に届かなくても、Deliver は PublishTimeout で諦めて戻る（送信 API のレスポンスを止めない）。
func TestRedisDeliveryGivesUpWhenRedisIsDown(t *testing.T) {
	// どこにもつながらないアドレス。接続の拒否はすぐに返るので、待つのは再試行の分だけ。
	rdb := goredis.NewClient(&goredis.Options{Addr: "127.0.0.1:1"})
	t.Cleanup(func() { _ = rdb.Close() })
	done := make(chan struct{})
	go func() {
		defer close(done)
		realtime.NewRedisDelivery(rdb, ids, slog.New(slog.DiscardHandler)).
			Deliver(context.Background(), chat.Event{Type: chat.EventRoomRead, To: chat.Audience{Users: []ulid.ULID{ids.New()}}, Data: chat.RoomRead{}})
	}()
	select {
	case <-done:
	case <-time.After(realtime.PublishTimeout + 3*time.Second):
		t.Fatal("Deliver did not give up")
	}
}

// 止めた Broker は受け取りの goroutine を残さず、以降の購読を拒否する。
func TestBrokerStop(t *testing.T) {
	in := startInstance(t, "test-stop")
	in.acquire(t, "room:"+ids.New().String())
	in.stop()
	if err := in.broker.Acquire(t.Context(), "room:"+ids.New().String()); !errors.Is(err, goredis.ErrClosed) {
		t.Fatalf("Acquire() after stop = %v, want ErrClosed", err)
	}
	if err := in.broker.Sync(t.Context()); !errors.Is(err, goredis.ErrClosed) {
		t.Fatalf("Sync() after stop = %v, want ErrClosed", err)
	}
}
