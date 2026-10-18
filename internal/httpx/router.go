package httpx

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// Deps はルーターが必要とする依存。コンストラクタで注入し、グローバルな状態を持たない。
type Deps struct {
	Logger       *slog.Logger
	Clock        clock.Clock
	IDs          id.Generator
	HealthChecks []HealthCheck
	// TrustedProxies は X-Forwarded-For を信用する前段のプロキシ。空なら XFF を読まない（ADR 0017）。
	TrustedProxies TrustedProxies
	// AllowedOrigins はブラウザから API を呼んでよいオリジン（scheme://host[:port]）。空なら CORS のヘッダを付けない（ADR 0021）。
	AllowedOrigins []string

	Auth     AuthService
	Verifier *authn.Verifier
	// AllowUnverifiedEmail は、email を検証していない利用者にも chat を使わせるか（ADR 0053 決定 4）。
	// 「塞ぐ」ではなく「外す」を名前にするのは、設定し忘れたゼロ値が塞ぐ側になるようにするため。
	// true にできるのは開発環境だけ（設定の読み込みが MAIL_TRANSPORT=smtp との組み合わせを拒む）。
	AllowUnverifiedEmail bool
	// JWKS は /.well-known/jwks.json で返す公開鍵の JSON。
	JWKS []byte
	// RefreshCookieSecure は Refresh Token の Cookie に Secure 属性を付けるか。
	RefreshCookieSecure bool

	Chat ChatService

	// Realtime は WebSocket の接続を束ねる Hub（ADR 0015）。
	Realtime RealtimeHub
	// WSTickets は ws-ticket の発行と消費（ADR 0007）。
	WSTickets WSTicketStore
	// Sessions は WebSocket の接続時にセッションの有効性を確かめる。
	Sessions authn.SessionChecker
	WS       WSConfig
}

// requireChatUser は chat の API と ws-ticket の発行の前に置く認証（ADR 0053 決定 1）。
//
// Access Token を検証し、email を検証済みでなければ 403 で止める。chat の入り口をすべてこれで包むので、
// chat のハンドラも chat のパッケージも検証の状態を知らずに済む。auth の API は Require だけを使う
// （確認メールの再送や /users/me は、検証を済ませるのに要るため）。
func requireChatUser(d Deps) func(http.Handler) http.Handler {
	requireAuth := authn.Require(d.Verifier, writeUnauthorized)
	requireVerified := authn.RequireVerifiedEmail(!d.AllowUnverifiedEmail, writeEmailUnverified)
	return func(next http.Handler) http.Handler {
		return requireAuth(requireVerified(next))
	}
}

// healthTimeout は healthz が依存先を待つ上限。LB のヘルスチェックの間隔より十分短くする。
const healthTimeout = 2 * time.Second

// NewRouter は全エンドポイントを登録した http.Handler を返す。
// パスは net/http の ServeMux のメソッド付きパターン（Go 1.22+）で書く。
func NewRouter(d Deps) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /healthz", Healthz(d.Logger, healthTimeout, d.HealthChecks...))
	registerAuthRoutes(mux, d)
	registerChatRoutes(mux, d)
	registerWSRoutes(mux, d)

	var h http.Handler = mux
	// プリフライトもアクセスログに残すので、ログより内側に置く。
	h = withCORS(d.AllowedOrigins, h)
	h = withAccessLog(d.Logger, d.Clock, h)
	// アクセスログにも同じクライアント IP を出すので、ログより外側で求める。
	h = withClientIP(d.TrustedProxies, h)
	h = withRequestID(d.IDs, h)
	return h
}
