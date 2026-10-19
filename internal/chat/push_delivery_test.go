package chat_test

import (
	"context"
	"log/slog"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// PushDelivery の列と goroutine（ADR 0069 決定 8）。DB を使わない。送る中身は push_delivery_send_test.go。

// blockingDispatcher は、release が閉じるか ctx が終わるまで戻らない PushDispatcher。
// 送り先がとても遅いときを表し、そのあいだ worker が埋まる。
type blockingDispatcher struct {
	// started は SendPushes に入るたびにイベントが 1 つ送られる（テストが worker の状態を待つため）。
	started chan chat.Event
	release chan struct{}
}

func newBlockingDispatcher() *blockingDispatcher {
	return &blockingDispatcher{started: make(chan chat.Event, 1024), release: make(chan struct{})}
}

func (d *blockingDispatcher) SendPushes(ctx context.Context, ev chat.Event) {
	d.started <- ev
	select {
	case <-d.release:
	case <-ctx.Done():
	}
}

// runPushDelivery は Run を動かし、止めて戻るのを待つ関数を返す。戻らなければ goroutine が漏れているので失敗にする。
func runPushDelivery(t *testing.T, d *chat.PushDelivery, dispatcher chat.PushDispatcher) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		d.Run(ctx, dispatcher)
	}()
	var once sync.Once
	stop = func() {
		once.Do(func() {
			cancel()
			select {
			case <-done:
			case <-time.After(10 * time.Second):
				t.Fatal("Run did not return after cancel")
			}
		})
	}
	t.Cleanup(stop)
	return stop
}

func receive(t *testing.T, ch <-chan chat.Event) chat.Event {
	t.Helper()
	select {
	case ev := <-ch:
		return ev
	case <-time.After(10 * time.Second):
		t.Fatal("dispatcher was not called")
		return chat.Event{}
	}
}

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

// すべてのイベントをそのまま inner に渡し、列に積むのはプッシュのきっかけ（message.created と huddle.ringing）だけ（決定 6）。
func TestPushDeliveryForwardsEverythingAndQueuesTriggers(t *testing.T) {
	inner := &chattest.Recorder{}
	d := chat.NewPushDelivery(inner, chat.PushDeliveryOptions{QueueSize: 16, Workers: 1}, discardLogger())
	dispatcher := newBlockingDispatcher()
	close(dispatcher.release)
	runPushDelivery(t, d, dispatcher)

	types := []chat.EventType{
		chat.EventMessageUpdated, chat.EventMessageCreated, chat.EventMessageDeleted, chat.EventTypingStarted,
		chat.EventHuddleUpdated, chat.EventHuddleRinging, chat.EventPresenceChanged, chat.EventRoomRead,
	}
	for _, typ := range types {
		d.Deliver(t.Context(), chat.Event{Type: typ})
	}

	got := inner.Take()
	if len(got) != len(types) {
		t.Fatalf("inner got %d events, want %d", len(got), len(types))
	}
	for i, ev := range got {
		if ev.Type != types[i] {
			t.Errorf("inner[%d] = %s, want %s (order and content unchanged)", i, ev.Type, types[i])
		}
	}
	if ev := receive(t, dispatcher.started); ev.Type != chat.EventMessageCreated {
		t.Errorf("first push = %s", ev.Type)
	}
	if ev := receive(t, dispatcher.started); ev.Type != chat.EventHuddleRinging {
		t.Errorf("second push = %s", ev.Type)
	}
	// 目印のイベントを最後に積む。worker は 1 つで列を順に読むので、ほかの種類が積まれていれば目印より先に来る
	marker := chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Users: []ulid.ULID{ulid.Make()}}}
	d.Deliver(t.Context(), marker)
	if ev := receive(t, dispatcher.started); ev.Type != marker.Type || len(ev.To.Users) != 1 || ev.To.Users[0] != marker.To.Users[0] {
		t.Errorf("third push = %+v, want the marker (no other event types queued)", ev)
	}
}

// 列があふれたら待たずに捨て、数える。inner への配信は捨てた分も含めてすべて届く（決定 8）。
func TestPushDeliveryDropsWhenQueueIsFull(t *testing.T) {
	inner := &chattest.Recorder{}
	d := chat.NewPushDelivery(inner, chat.PushDeliveryOptions{QueueSize: 1, Workers: 1}, discardLogger())
	dispatcher := newBlockingDispatcher()
	runPushDelivery(t, d, dispatcher)

	ev := chat.Event{Type: chat.EventMessageCreated}
	d.Deliver(t.Context(), ev)
	receive(t, dispatcher.started) // 1 件目は worker が送っている途中で止まっている
	d.Deliver(t.Context(), ev)     // 2 件目は列に入る
	d.Deliver(t.Context(), ev)     // 3・4 件目は入る場所がない
	d.Deliver(t.Context(), ev)

	if got := d.Dropped(); got != 2 {
		t.Errorf("Dropped() = %d, want 2", got)
	}
	if got := len(inner.Take()); got != 4 {
		t.Errorf("inner got %d events, want 4", got)
	}

	close(dispatcher.release)
	receive(t, dispatcher.started) // 列に入った 2 件目は送られる
}

// 送り先が詰まっていても、Deliver（リクエストの処理と WS の配信）は待たない。
// ロードマップ Phase 7.1 の DoD「送り先が遅くても、WebSocket の配信は遅れない（並行テスト）」。
func TestPushDeliveryDoesNotBlockWhenSendersAreStuck(t *testing.T) {
	const (
		queueSize  = 8
		workers    = 2
		goroutines = 50
		perG       = 20
	)
	inner := &chattest.Recorder{}
	d := chat.NewPushDelivery(inner, chat.PushDeliveryOptions{QueueSize: queueSize, Workers: workers}, discardLogger())
	dispatcher := newBlockingDispatcher() // 最後まで release しない
	runPushDelivery(t, d, dispatcher)

	// worker がどちらも送信の途中で止まってから始める（Dropped の数を決めるため）
	d.Deliver(t.Context(), chat.Event{Type: chat.EventMessageCreated})
	d.Deliver(t.Context(), chat.Event{Type: chat.EventMessageCreated})
	receive(t, dispatcher.started)
	receive(t, dispatcher.started)

	var wg sync.WaitGroup
	for range goroutines {
		wg.Go(func() {
			for range perG {
				d.Deliver(context.Background(), chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{ulid.Make()}}})
			}
		})
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Deliver blocked while the push senders were stuck")
	}

	total := workers + goroutines*perG
	if got := len(inner.Take()); got != total {
		t.Errorf("inner got %d events, want %d", got, total)
	}
	if got, want := d.Dropped(), int64(goroutines*perG-queueSize); got != want {
		t.Errorf("Dropped() = %d, want %d", got, want)
	}
}

// ctx を取り消すと、送っている途中の worker も含めて Run が戻り、goroutine が残らない（CLAUDE.md「goroutine」）。
func TestPushDeliveryRunStopsWithoutLeaking(t *testing.T) {
	cycle := func() {
		d := chat.NewPushDelivery(&chattest.Recorder{}, chat.PushDeliveryOptions{QueueSize: 4, Workers: 4}, discardLogger())
		dispatcher := newBlockingDispatcher()
		stop := runPushDelivery(t, d, dispatcher)
		for range 6 {
			d.Deliver(t.Context(), chat.Event{Type: chat.EventHuddleRinging})
		}
		for range 4 {
			receive(t, dispatcher.started) // 4 つの worker がすべて送信の途中
		}
		stop() // 列に残った 2 件は送らずに戻る
	}

	cycle() // 1 回目で、一度だけ作られる goroutine を起動させる
	baseline := runtime.NumGoroutine()
	for range 3 {
		cycle()
	}
	waitFor(t, func() bool { return runtime.NumGoroutine() <= baseline })
}

// waitFor は cond が true になるまで待つ。time.Sleep を使わず、ticker で確かめる（realtime の hub_test.go と同じ）。
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
