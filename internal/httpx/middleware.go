package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"net/netip"
	"strings"

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

// secretPathValues は、値が秘密なのでログに出さないパス変数の名前。
// 招待コードは「知っていれば参加できる」bearer な秘密で、パス（/api/v1/invites/{code}）に載る（ADR 0011）。
var secretPathValues = []string{"code"}

// loggedPath はログに出すパスを返す。秘密のパス変数の値は {name} に置き換える。
//
// パス変数は ServeMux がパターンに一致したときにだけ設定される。どのパターンにも一致しないパス（404）は伏せられないが、
// その場合はサーバーが扱う秘密にはなっていない。
func loggedPath(r *http.Request) string {
	p := r.URL.Path
	for _, name := range secretPathValues {
		if v := r.PathValue(name); v != "" {
			p = strings.ReplaceAll(p, v, "{"+name+"}")
		}
	}
	return p
}

// withAccessLog はリクエストごとに 1 行の構造化ログを出す。
// クエリ文字列は出さない（将来 ws-ticket などの秘密が載るため）。パスの秘密は loggedPath で伏せる。
//
// ServeMux はパターンとパス変数を、渡された *http.Request にそのまま書き込む。
// そのため next から戻った後なら、外側のこのミドルウェアからも PathValue で読める。
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
			slog.String("path", loggedPath(r)),
			slog.String("client_ip", logIP(clientIPFrom(r.Context()))),
			slog.Int("status", rec.status),
			slog.Duration("duration", clk.Now().Sub(start)),
		)
	})
}

// logIP はログに出す IP の表記を返す。分からなければ空文字列。
func logIP(ip netip.Addr) string {
	if !ip.IsValid() {
		return ""
	}
	return ip.String()
}
