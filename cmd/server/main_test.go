package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// 実物の Postgres / Redis に対してサーバーを起動し、/healthz が 200 を返し、
// ctx のキャンセルで run がエラーなく戻る（graceful shutdown して後始末まで終わる）ことを確かめる。
func TestRunServesHealthzAndShutsDown(t *testing.T) {
	env := map[string]string{
		"DATABASE_URL":     testenv.DatabaseURL(t),
		"REDIS_URL":        testenv.RedisURL(t),
		"HTTP_ADDR":        "127.0.0.1:0", // 空いているポートを OS に選ばせる
		"SHUTDOWN_TIMEOUT": "5s",
	}
	lookup := func(k string) (string, bool) { v, ok := env[k]; return v, ok }

	logR, logW := io.Pipe()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, lookup, logW)
		_ = logW.Close()
	}()

	// 起動ログから実際に listen したアドレスを読む。
	addrCh := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(logR)
		for sc.Scan() {
			var rec map[string]any
			if json.Unmarshal(sc.Bytes(), &rec) == nil && rec["msg"] == "server started" {
				addrCh <- rec["addr"].(string)
			}
		}
		close(addrCh)
	}()

	var addr string
	select {
	case addr = <-addrCh:
	case err := <-done:
		t.Fatalf("run exited before start: %v", err)
	case <-time.After(30 * time.Second):
		t.Fatal("server did not start")
	}
	if addr == "" {
		t.Fatal("server did not log its address")
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+addr+"/healthz", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `"status":"ok"`) {
		t.Fatalf("GET /healthz = %d %s", resp.StatusCode, body)
	}

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("run() = %v, want nil after cancel", err)
	}
}
