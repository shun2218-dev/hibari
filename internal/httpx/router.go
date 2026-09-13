package httpx

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// Deps はルーターが必要とする依存。コンストラクタで注入し、グローバルな状態を持たない。
type Deps struct {
	Logger       *slog.Logger
	Clock        clock.Clock
	IDs          id.Generator
	HealthChecks []HealthCheck
}

// healthTimeout は healthz が依存先を待つ上限。LB のヘルスチェックの間隔より十分短くする。
const healthTimeout = 2 * time.Second

// NewRouter は全エンドポイントを登録した http.Handler を返す。
// パスは net/http の ServeMux のメソッド付きパターン（Go 1.22+）で書く。
func NewRouter(d Deps) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /healthz", Healthz(d.Logger, healthTimeout, d.HealthChecks...))

	var h http.Handler = mux
	h = withAccessLog(d.Logger, d.Clock, h)
	h = withRequestID(d.IDs, h)
	return h
}
