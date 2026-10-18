package mail_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/textproto"
	"sync"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/mail"
)

// fakeSender は送信を記録する Sender。fail が返すエラーで失敗させ、block が閉じるまで送信を止められる。
type fakeSender struct {
	mu    sync.Mutex
	sent  []mail.Message
	calls int
	fail  func(call int) error
	block chan struct{}
	// started は Send に入るたびに 1 つ送られる（テストが送信の開始を待つため）。
	started chan struct{}
}

func (s *fakeSender) Send(ctx context.Context, m mail.Message) error {
	s.mu.Lock()
	s.calls++
	call := s.calls
	s.mu.Unlock()
	if s.started != nil {
		s.started <- struct{}{}
	}
	if s.block != nil {
		select {
		case <-s.block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if s.fail != nil {
		if err := s.fail(call); err != nil {
			return err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, m)
	return nil
}

func (s *fakeSender) snapshot() (sent []mail.Message, calls int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]mail.Message(nil), s.sent...), s.calls
}

func discard() *slog.Logger { return slog.New(slog.DiscardHandler) }

func opts() mail.QueueOptions {
	return mail.QueueOptions{Size: 8, Attempts: 3, DrainTimeout: 5 * time.Second}
}

// run は Run を動かし、止めて戻るのを待つ関数を返す。戻らなければ goroutine が漏れているので失敗にする。
func run(t *testing.T, q *mail.Queue) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		q.Run(ctx)
	}()
	return func() {
		cancel()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Fatal("Run did not return after cancel")
		}
	}
}

// 積むだけで戻り、送信の遅さを待たない（パスワードの再設定の時間差を出さない。ADR 0053 決定 6）。
func TestQueueSendDoesNotWaitForDelivery(t *testing.T) {
	sender := &fakeSender{block: make(chan struct{}), started: make(chan struct{}, 8)}
	q := mail.NewQueue(sender, opts(), discard())
	stop := run(t, q)

	if err := q.Send(t.Context(), mail.Message{To: "a@example.com", Kind: "test"}); err != nil {
		t.Fatalf("Send() = %v", err)
	}
	<-sender.started // ワーカーが送信の途中で止まっている
	if err := q.Send(t.Context(), mail.Message{To: "b@example.com", Kind: "test"}); err != nil {
		t.Fatalf("Send() while the worker is blocked = %v", err)
	}

	close(sender.block)
	stop()
	sent, _ := sender.snapshot()
	if len(sent) != 2 {
		t.Fatalf("sent %d messages, want 2", len(sent))
	}
}

func TestQueueRejectsWhenFull(t *testing.T) {
	o := opts()
	o.Size = 1
	q := mail.NewQueue(&fakeSender{}, o, discard())
	// Run を動かしていないので、1 通でいっぱいになる。
	if err := q.Send(t.Context(), mail.Message{Kind: "test"}); err != nil {
		t.Fatalf("first Send() = %v", err)
	}
	if err := q.Send(t.Context(), mail.Message{Kind: "test"}); !errors.Is(err, mail.ErrQueueFull) {
		t.Fatalf("second Send() = %v, want ErrQueueFull", err)
	}
}

func TestQueueRetries(t *testing.T) {
	temporary := &textproto.Error{Code: 451, Msg: "try again later"}
	permanent := &textproto.Error{Code: 550, Msg: "mailbox unavailable"}
	tests := []struct {
		name      string
		fail      func(call int) error
		wantCalls int
		wantSent  int
	}{
		{"succeeds first time", func(int) error { return nil }, 1, 1},
		{"temporary failure then success", func(call int) error {
			if call < 3 {
				return temporary
			}
			return nil
		}, 3, 1},
		{"gives up after the attempts", func(int) error { return temporary }, 3, 0},
		{"connection errors are retried", func(int) error { return io.ErrUnexpectedEOF }, 3, 0},
		// 5xx は送り直しても通らないので、1 回で諦める。
		{"permanent failure is not retried", func(int) error { return permanent }, 1, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sender := &fakeSender{fail: tt.fail}
			q := mail.NewQueue(sender, opts(), discard())
			if err := q.Send(t.Context(), mail.Message{Kind: "test"}); err != nil {
				t.Fatal(err)
			}
			// 止めると、積まれた分を送り切ってから戻る。
			run(t, q)()
			sent, calls := sender.snapshot()
			if calls != tt.wantCalls || len(sent) != tt.wantSent {
				t.Fatalf("calls = %d, sent = %d, want %d, %d", calls, len(sent), tt.wantCalls, tt.wantSent)
			}
		})
	}
}

// 停止の合図の後も、積まれた分は送り切ってから戻る。
func TestQueueDrainsOnShutdown(t *testing.T) {
	sender := &fakeSender{}
	q := mail.NewQueue(sender, opts(), discard())
	for range 5 {
		if err := q.Send(t.Context(), mail.Message{Kind: "test"}); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	q.Run(ctx)

	if sent, _ := sender.snapshot(); len(sent) != 5 {
		t.Fatalf("sent %d messages, want 5", len(sent))
	}
}

// 送り切れないときは DrainTimeout で諦めて戻る（停止を止めない）。
func TestQueueDrainGivesUpAfterTimeout(t *testing.T) {
	sender := &fakeSender{block: make(chan struct{})} // 閉じないので、送信は ctx が終わるまで戻らない
	o := opts()
	o.DrainTimeout = 10 * time.Millisecond
	q := mail.NewQueue(sender, o, discard())
	for range 2 {
		if err := q.Send(t.Context(), mail.Message{Kind: "test"}); err != nil {
			t.Fatal(err)
		}
	}
	run(t, q)()

	if sent, calls := sender.snapshot(); len(sent) != 0 || calls != 1 {
		t.Fatalf("calls = %d, sent = %d, want 1 call and nothing sent", calls, len(sent))
	}
}

// 多数の goroutine から同時に積んでも、失わずに 1 通ずつ届く（go test -race で競合も確かめる）。
func TestQueueConcurrentSend(t *testing.T) {
	sender := &fakeSender{}
	o := opts()
	o.Size = 100
	q := mail.NewQueue(sender, o, discard())
	stop := run(t, q)

	var wg sync.WaitGroup
	for range 100 {
		wg.Go(func() {
			if err := q.Send(t.Context(), mail.Message{Kind: "test"}); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	stop()
	if sent, _ := sender.snapshot(); len(sent) != 100 {
		t.Fatalf("sent %d messages, want 100", len(sent))
	}
}
