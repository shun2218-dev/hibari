package storage_test

import (
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/storage"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

func newStorage(t *testing.T) *storage.S3 {
	t.Helper()
	env := testenv.S3(t)
	s, err := storage.New(storage.Config{
		Endpoint:        env.Endpoint,
		Region:          "us-east-1",
		Bucket:          env.Bucket,
		AccessKeyID:     env.AccessKeyID,
		SecretAccessKey: env.SecretAccessKey,
		UsePathStyle:    true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// uniqueKey は実行ごとに一意なキーを返す。テスト用のバケットはパッケージと実行をまたいで共有する。
func uniqueKey(t *testing.T) string {
	t.Helper()
	return "storage-test/" + strings.ToLower(rand.Text())
}

func put(t *testing.T, req storage.PresignedRequest, body []byte, header http.Header) int {
	t.Helper()
	r, err := http.NewRequestWithContext(t.Context(), req.Method, req.URL, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	r.Header = header
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

// ロードマップ Phase 3c の DoD: 上限を超えるサイズの PUT がストレージ側で拒否される。
// 署名に Content-Length と Content-Type を含めるので、申告と違う PUT は 403 になる（ADR 0013）。
func TestPresignPut(t *testing.T) {
	s := newStorage(t)
	key := uniqueKey(t)
	body := []byte("0123456789")
	req, err := s.PresignPut(t.Context(), key, "text/plain", int64(len(body)), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != http.MethodPut {
		t.Errorf("method = %s", req.Method)
	}
	// クライアントに渡すヘッダーは Content-Type だけ。Host と Content-Length は HTTP クライアントが付ける。
	if got := req.Header.Get("Content-Type"); got != "text/plain" || len(req.Header) != 1 {
		t.Errorf("header = %v", req.Header)
	}
	u, err := url.Parse(req.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Query().Get("X-Amz-SignedHeaders"); got != "content-length;content-type;host" {
		t.Errorf("signed headers = %q", got)
	}

	for _, tt := range []struct {
		name        string
		body        []byte
		contentType string
	}{
		{"larger than declared", []byte("0123456789A"), "text/plain"},
		{"smaller than declared", []byte("012345678"), "text/plain"},
		{"different content type", body, "text/html"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := put(t, req, tt.body, http.Header{"Content-Type": {tt.contentType}}); got != http.StatusForbidden {
				t.Errorf("PUT status = %d, want 403", got)
			}
		})
	}
	if _, err := s.Head(t.Context(), key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Head() after rejected PUTs error = %v, want ErrNotFound", err)
	}

	if got := put(t, req, body, req.Header); got != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200", got)
	}
	info, err := s.Head(t.Context(), key)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size != int64(len(body)) || info.ContentType != "text/plain" {
		t.Errorf("Head() = %+v", info)
	}

	// GET URL はレスポンスのヘッダーを上書きできる。
	getURL, err := s.PresignGet(t.Context(), key, time.Minute, storage.GetOptions{ContentType: "text/plain", ContentDisposition: `attachment; filename="a.txt"`})
	if err != nil {
		t.Fatal(err)
	}
	r, err := http.NewRequestWithContext(t.Context(), http.MethodGet, getURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || !bytes.Equal(got, body) || resp.Header.Get("Content-Disposition") != `attachment; filename="a.txt"` {
		t.Errorf("GET = %d %q, Content-Disposition %q", resp.StatusCode, got, resp.Header.Get("Content-Disposition"))
	}

	// DELETE は冪等。
	for range 2 {
		if err := s.Delete(t.Context(), key); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}
	}
	if _, err := s.Head(t.Context(), key); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("Head() after Delete error = %v, want ErrNotFound", err)
	}
}

func TestPresignUsesPublicEndpoint(t *testing.T) {
	s, err := storage.New(storage.Config{
		Endpoint:        "http://s3:9000",
		PublicEndpoint:  "https://files.example.com",
		Region:          "auto",
		Bucket:          "b",
		AccessKeyID:     "id",
		SecretAccessKey: "secret",
		UsePathStyle:    true,
	})
	if err != nil {
		t.Fatal(err)
	}
	req, err := s.PresignPut(t.Context(), "k", "image/png", 1, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(req.URL, "https://files.example.com/b/k?") {
		t.Errorf("URL = %s", req.URL)
	}
}

func TestNewRejectsInvalidConfig(t *testing.T) {
	valid := storage.Config{Endpoint: "http://s3:9000", Region: "us-east-1", Bucket: "b", AccessKeyID: "id", SecretAccessKey: "secret"}
	for _, tt := range []struct {
		name   string
		modify func(*storage.Config)
	}{
		{"missing endpoint", func(c *storage.Config) { c.Endpoint = "" }},
		{"missing bucket", func(c *storage.Config) { c.Bucket = "" }},
		{"missing region", func(c *storage.Config) { c.Region = "" }},
		{"missing access key", func(c *storage.Config) { c.AccessKeyID = "" }},
		{"missing secret", func(c *storage.Config) { c.SecretAccessKey = "" }},
		{"relative endpoint", func(c *storage.Config) { c.Endpoint = "s3:9000" }},
		{"invalid public endpoint", func(c *storage.Config) { c.PublicEndpoint = "ftp://files" }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cfg := valid
			tt.modify(&cfg)
			if _, err := storage.New(cfg); err == nil {
				t.Error("New() error = nil")
			}
		})
	}
}

// サーバーが取ってきたリンクのプレビューの画像を置き、署名付き GET URL で読める（ADR 0065 決定 7）。
func TestPut(t *testing.T) {
	s := newStorage(t)
	key := uniqueKey(t)
	body := []byte("\x89PNG fake image")
	if err := s.Put(t.Context(), key, "image/png", body); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Delete(t.Context(), key) })

	info, err := s.Head(t.Context(), key)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size != int64(len(body)) || info.ContentType != "image/png" {
		t.Errorf("head = %+v", info)
	}
	u, err := s.PresignGet(t.Context(), key, time.Minute, storage.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(u) //nolint:noctx // テストの中だけ
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	got, _ := io.ReadAll(resp.Body)
	if !bytes.Equal(got, body) {
		t.Errorf("body = %q", got)
	}
}
