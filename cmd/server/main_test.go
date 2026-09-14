package main

import (
	"bufio"
	"bytes"
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

	"github.com/coder/websocket"
	"github.com/oklog/ulid/v2"

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
		"S3_ENDPOINT":          "http://unused",
		"S3_BUCKET":            "unused",
		"S3_ACCESS_KEY_ID":     "unused",
		"S3_SECRET_ACCESS_KEY": "unused",
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
	s3 := testenv.S3(t)
	env["S3_ENDPOINT"], env["S3_BUCKET"], env["S3_ACCESS_KEY_ID"], env["S3_SECRET_ACCESS_KEY"] = s3.Endpoint, s3.Bucket, s3.AccessKeyID, s3.SecretAccessKey
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

	// WebSocket を 1 本張っておく。http.Server.Shutdown はアップグレード済みの接続を扱わないので、
	// run が Hub に閉じさせてから戻ること（ADR 0015）を確かめる。
	ws := dialWebSocket(ctx, t, addr)

	cancel()
	if _, _, err := ws.Read(context.Background()); websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Errorf("websocket read during shutdown = %v, want close 1001", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("run() = %v, want nil after cancel", err)
	}
}

// dialWebSocket は登録したユーザーの ws-ticket で接続する。
func dialWebSocket(ctx context.Context, t *testing.T, addr string) *websocket.Conn {
	t.Helper()
	post := func(path, token string, body any) map[string]any {
		t.Helper()
		b, _ := json.Marshal(body)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "http://"+addr+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("POST %s: %v", path, err)
		}
		defer func() { _ = resp.Body.Close() }()
		var out map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || resp.StatusCode >= 300 {
			t.Fatalf("POST %s = %d, %v: %v", path, resp.StatusCode, err, out)
		}
		return out
	}
	handle := "main" + strings.ToLower(ulid.Make().String())
	reg := post("/api/v1/auth/register", "", map[string]string{
		"handle": handle, "display_name": "main test", "email": handle + "@example.com", "password": "correct horse battery staple",
	})
	ticket := post("/api/v1/ws/ticket", reg["access_token"].(string), nil)["ticket"].(string)
	conn, resp, err := websocket.Dial(ctx, "ws://"+addr+"/api/v1/ws?ticket="+ticket, nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	return conn
}
