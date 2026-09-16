package httpx_test

import (
	"crypto/rand"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/httpx"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

const webOrigin = "http://localhost:3000"

func newCORSRouter() http.Handler {
	clk := clock.NewFake(time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC))
	return httpx.NewRouter(httpx.Deps{
		Logger:         slog.New(slog.DiscardHandler),
		Clock:          clk,
		IDs:            id.NewGenerator(clk, rand.Reader),
		HealthChecks:   []httpx.HealthCheck{{Name: "postgres", Check: ok}},
		AllowedOrigins: []string{webOrigin},
	})
}

func TestCORSPreflight(t *testing.T) {
	tests := []struct {
		name        string
		origin      string
		wantAllowed bool
	}{
		{name: "allowed origin", origin: webOrigin, wantAllowed: true},
		// 大文字小文字だけが違う表記も同じオリジンとして扱う。
		{name: "allowed origin in upper case", origin: "HTTP://LOCALHOST:3000", wantAllowed: true},
		{name: "other port", origin: "http://localhost:3001"},
		{name: "other scheme", origin: "https://localhost:3000"},
		// 前方一致で許してはいけない。
		{name: "suffixed host", origin: "http://localhost:3000.evil.test"},
		{name: "null origin", origin: "null"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// ServeMux に OPTIONS のルートはないが、プリフライトは 405 ではなく 204 で終わる。
			req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/refresh", nil)
			req.Header.Set("Origin", tt.origin)
			req.Header.Set("Access-Control-Request-Method", http.MethodPost)
			req.Header.Set("Access-Control-Request-Headers", "content-type, x-hibari-client")
			rec := httptest.NewRecorder()
			newCORSRouter().ServeHTTP(rec, req)

			if rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204", rec.Code)
			}
			h := rec.Header()
			if got := h.Values("Vary"); len(got) == 0 || got[0] != "Origin" {
				t.Errorf("Vary = %v, want to include Origin", got)
			}
			if !tt.wantAllowed {
				for _, k := range []string{"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"} {
					if v := h.Get(k); v != "" {
						t.Errorf("%s = %q, want empty for a disallowed origin", k, v)
					}
				}
				return
			}
			want := map[string]string{
				// 送られてきた表記をそのまま返す。ブラウザは Origin ヘッダとの完全一致で比べる。
				"Access-Control-Allow-Origin":      tt.origin,
				"Access-Control-Allow-Credentials": "true",
				"Access-Control-Allow-Methods":     "GET, POST, PATCH, DELETE",
				"Access-Control-Allow-Headers":     "Authorization, Content-Type, X-Hibari-Client",
				"Access-Control-Max-Age":           "7200",
			}
			for k, v := range want {
				if got := h.Get(k); got != v {
					t.Errorf("%s = %q, want %q", k, got, v)
				}
			}
		})
	}
}

func TestCORSActualRequest(t *testing.T) {
	tests := []struct {
		name        string
		origin      string
		wantAllowed bool
	}{
		{name: "allowed origin", origin: webOrigin, wantAllowed: true},
		{name: "disallowed origin", origin: "https://evil.test"},
		// Origin のないクライアント（ネイティブアプリ、curl）はそのまま通す。
		{name: "no origin"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			newCORSRouter().ServeHTTP(rec, req)

			// 許可していないオリジンでも、サーバーの処理は変わらない（読めなくするのはブラウザ）。
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			h := rec.Header()
			if tt.origin != "" && h.Get("Vary") != "Origin" {
				t.Errorf("Vary = %q, want Origin", h.Get("Vary"))
			}
			wantOrigin, wantCred, wantExpose := "", "", ""
			if tt.wantAllowed {
				wantOrigin, wantCred, wantExpose = tt.origin, "true", "X-Request-Id, Retry-After"
			}
			if got := h.Get("Access-Control-Allow-Origin"); got != wantOrigin {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, wantOrigin)
			}
			if got := h.Get("Access-Control-Allow-Credentials"); got != wantCred {
				t.Errorf("Access-Control-Allow-Credentials = %q, want %q", got, wantCred)
			}
			if got := h.Get("Access-Control-Expose-Headers"); got != wantExpose {
				t.Errorf("Access-Control-Expose-Headers = %q, want %q", got, wantExpose)
			}
		})
	}
}

// Origin のない OPTIONS はプリフライトではないので、ServeMux にそのまま渡す。
func TestCORSOptionsWithoutOriginIsNotPreflight(t *testing.T) {
	rec := httptest.NewRecorder()
	newCORSRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodOptions, "/healthz", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

func TestOriginOf(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "http://localhost:3000", want: "http://localhost:3000"},
		// パスはオリジンに含めない。
		{in: "https://Hibari.Example/app", want: "https://hibari.example"},
	}
	for _, tt := range tests {
		u, err := url.Parse(tt.in)
		if err != nil {
			t.Fatal(err)
		}
		if got := httpx.OriginOf(u); got != tt.want {
			t.Errorf("OriginOf(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
