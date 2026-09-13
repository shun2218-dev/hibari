package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// writeSigningKey は `make keys` と同じ形式（PKCS#8 の PEM）の使い捨ての鍵を一時ディレクトリに書き、そのパスを返す。
func writeSigningKey(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "jwt_ed25519.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// 署名鍵のファイルがなければ、DB に接続する前に原因の分かるエラーで起動を止める。
func TestRunFailsWithoutSigningKey(t *testing.T) {
	env := map[string]string{
		"DATABASE_URL":         "postgres://unused",
		"REDIS_URL":            "redis://unused",
		"JWT_PRIVATE_KEY_FILE": filepath.Join(t.TempDir(), "missing.pem"),
	}
	lookup := func(k string) (string, bool) { v, ok := env[k]; return v, ok }

	err := run(t.Context(), lookup, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "make keys") {
		t.Fatalf("run() = %v, want an error mentioning `make keys`", err)
	}
}

// 実物の Postgres / Redis に対してサーバーを起動し、/healthz が 200 を返し、
// ctx のキャンセルで run がエラーなく戻る（graceful shutdown して後始末まで終わる）ことを確かめる。
func TestRunServesHealthzAndShutsDown(t *testing.T) {
	env := map[string]string{
		"DATABASE_URL":     testenv.DatabaseURL(t),
		"REDIS_URL":        testenv.RedisURL(t),
		"HTTP_ADDR":        "127.0.0.1:0", // 空いているポートを OS に選ばせる
		"SHUTDOWN_TIMEOUT": "5s",

		"JWT_PRIVATE_KEY_FILE": writeSigningKey(t),
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
