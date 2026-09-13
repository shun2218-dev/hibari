package httpx

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// requestIDKey は context のキー。非公開の型にして、他パッケージのキーと衝突させない。
type requestIDKey struct{}

// RequestID は context に入っているリクエスト ID を返す。なければ空文字列。
func RequestID(ctx context.Context) string {
	v, _ := ctx.Value(requestIDKey{}).(string)
	return v
}

const requestIDHeader = "X-Request-Id"

// withRequestID はリクエストごとに ID を採番し、context とレスポンスヘッダに入れる。
//
// クライアントから送られてきた X-Request-Id は使わない。任意の文字列がログに混ざり、
// ログの検索や集計を汚せてしまうため。問い合わせではレスポンスヘッダの値を使ってもらう。
func withRequestID(ids id.Generator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := ids.New().String()
		w.Header().Set(requestIDHeader, rid)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, rid)))
	})
}

// statusRecorder はアクセスログのためにステータスコードを記録する。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Unwrap は http.ResponseController が元の ResponseWriter の機能（Flush、Hijack など）に届くようにする。
// これがないと Phase 4 の WebSocket のアップグレードがこのミドルウェアの下で失敗する。
func (s *statusRecorder) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}

// withAccessLog はリクエストごとに 1 行の構造化ログを出す。
// クエリ文字列は出さない（将来 ws-ticket などの秘密が載るため）。
func withAccessLog(logger *slog.Logger, clk clock.Clock, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := clk.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		logger.InfoContext(r.Context(), "http request",
			slog.String("request_id", RequestID(r.Context())),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rec.status),
			slog.Duration("duration", clk.Now().Sub(start)),
		)
	})
}
