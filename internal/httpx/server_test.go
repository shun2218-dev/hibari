package httpx_test

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/httpx"
)

func TestServeGracefulShutdown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			close(started)
			<-release // 処理中のリクエストを模す
			_, _ = io.WriteString(w, "done")
		}),
		ReadHeaderTimeout: time.Second,
	}

	ctx, cancel := context.WithCancel(t.Context())
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpx.Serve(ctx, srv, ln, 5*time.Second) }()

	type result struct {
		body string
		err  error
	}
	respCh := make(chan result, 1)
	go func() {
		resp, err := http.Get("http://" + ln.Addr().String()) //nolint:noctx // テスト用の単発リクエスト
		if err != nil {
			respCh <- result{err: err}
			return
		}
		defer func() { _ = resp.Body.Close() }()
		b, err := io.ReadAll(resp.Body)
		respCh <- result{body: string(b), err: err}
	}()

	<-started
	cancel() // リクエストの処理中に停止を要求する

	// 処理中のリクエストが終わるまで Serve は返らない。
	select {
	case err := <-serveErr:
		t.Fatalf("Serve returned before in-flight request finished: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	close(release)

	if r := <-respCh; r.err != nil || r.body != "done" {
		t.Fatalf("in-flight request: body=%q err=%v, want body=done", r.body, r.err)
	}
	if err := <-serveErr; err != nil {
		t.Fatalf("Serve() = %v, want nil", err)
	}

	// 停止後は新しい接続を受け付けない。
	if _, err := net.DialTimeout("tcp", ln.Addr().String(), time.Second); err == nil {
		t.Fatal("listener should be closed after shutdown")
	}
}

func TestServeShutdownTimeout(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	srv := &http.Server{
		Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			close(started)
			<-release
		}),
		ReadHeaderTimeout: time.Second,
	}

	ctx, cancel := context.WithCancel(t.Context())
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpx.Serve(ctx, srv, ln, 10*time.Millisecond) }()

	go func() {
		resp, err := http.Get("http://" + ln.Addr().String()) //nolint:noctx // テスト用の単発リクエスト
		if err == nil {
			_ = resp.Body.Close()
		}
	}()

	<-started
	cancel()

	if err := <-serveErr; err == nil {
		t.Fatal("Serve() = nil, want shutdown timeout error")
	}
}
