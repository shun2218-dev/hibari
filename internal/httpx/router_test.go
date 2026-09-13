package httpx_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/httpx"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

func newTestRouter(logw io.Writer, checks ...httpx.HealthCheck) http.Handler {
	clk := clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	return httpx.NewRouter(httpx.Deps{
		Logger:       slog.New(slog.NewJSONHandler(logw, nil)),
		Clock:        clk,
		IDs:          id.NewGenerator(clk, rand.Reader),
		HealthChecks: checks,
	})
}

func ok(context.Context) error { return nil }

func TestHealthz(t *testing.T) {
	secret := errors.New("dial tcp postgres.internal:5432: connection refused")
	failing := func(context.Context) error { return secret }

	tests := []struct {
		name       string
		checks     []httpx.HealthCheck
		wantStatus int
		wantBody   map[string]any
	}{
		{
			name:       "all ok",
			checks:     []httpx.HealthCheck{{Name: "postgres", Check: ok}, {Name: "redis", Check: ok}},
			wantStatus: http.StatusOK,
			wantBody: map[string]any{
				"status": "ok",
				"checks": map[string]any{"postgres": "ok", "redis": "ok"},
			},
		},
		{
			name:       "one failing",
			checks:     []httpx.HealthCheck{{Name: "postgres", Check: failing}, {Name: "redis", Check: ok}},
			wantStatus: http.StatusServiceUnavailable,
			wantBody: map[string]any{
				"status": "unavailable",
				"checks": map[string]any{"postgres": "unavailable", "redis": "ok"},
			},
		},
		{
			name: "checks receive a deadline",
			checks: []httpx.HealthCheck{{Name: "redis", Check: func(ctx context.Context) error {
				// healthz が timeout 付きの context を渡していることを確かめる。
				if _, ok := ctx.Deadline(); !ok {
					return errors.New("no deadline")
				}
				return nil
			}}},
			wantStatus: http.StatusOK,
			wantBody:   map[string]any{"status": "ok", "checks": map[string]any{"redis": "ok"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			h := newTestRouter(&logs, tt.checks...)

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q", ct)
			}
			var got map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("body is not JSON: %v", err)
			}
			if gb, _ := json.Marshal(got); string(gb) != mustJSON(t, tt.wantBody) {
				t.Fatalf("body = %s, want %s", gb, mustJSON(t, tt.wantBody))
			}
			// 失敗の詳細はレスポンスに出さない。
			if strings.Contains(rec.Body.String(), "postgres.internal") {
				t.Fatalf("response leaks error detail: %s", rec.Body.String())
			}
		})
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestHealthzMethodNotAllowed(t *testing.T) {
	h := newTestRouter(io.Discard)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/healthz", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

func TestRequestIDAndAccessLog(t *testing.T) {
	var logs bytes.Buffer
	h := newTestRouter(&logs, httpx.HealthCheck{Name: "redis", Check: ok})

	req := httptest.NewRequest(http.MethodGet, "/healthz?ticket=secret-value", nil)
	req.Header.Set("X-Request-Id", "client-supplied")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	rid := rec.Header().Get("X-Request-Id")
	if _, err := ulid.ParseStrict(rid); err != nil {
		t.Fatalf("X-Request-Id = %q, want a server-generated ULID: %v", rid, err)
	}

	var entry map[string]any
	if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
		t.Fatalf("access log is not a single JSON line: %v: %q", err, logs.String())
	}
	want := map[string]any{"request_id": rid, "method": "GET", "path": "/healthz", "status": float64(200)}
	for k, v := range want {
		if entry[k] != v {
			t.Errorf("log[%q] = %v, want %v", k, entry[k], v)
		}
	}
	if strings.Contains(logs.String(), "secret-value") {
		t.Fatalf("access log must not contain the query string: %s", logs.String())
	}
}
