package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// HealthCheck は依存先 1 つの疎通確認。
type HealthCheck struct {
	Name  string
	Check func(ctx context.Context) error
}

type healthResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

const (
	healthOK          = "ok"
	healthUnavailable = "unavailable"
)

// Healthz は、すべての依存先に到達できれば 200、1 つでも失敗すれば 503 を返す。
//
// 「プロセスが生きている」だけでなく DB と Redis への疎通まで見るのは、
// ロードバランサ（Phase 5）が、依存先に届かないインスタンスへ振り分けないようにするため。
// 失敗の詳細（接続先のホスト名など）はレスポンスに出さず、ログにだけ残す。
func Healthz(logger *slog.Logger, timeout time.Duration, checks ...HealthCheck) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		// 直列にすると、遅い依存先 1 つのせいで他の確認まで timeout を食い合うので並列に行う。
		results := make([]error, len(checks))
		var wg sync.WaitGroup
		for i, c := range checks {
			wg.Go(func() { results[i] = c.Check(ctx) })
		}
		wg.Wait()

		resp := healthResponse{Status: healthOK, Checks: make(map[string]string, len(checks))}
		for i, c := range checks {
			if err := results[i]; err != nil {
				resp.Status = healthUnavailable
				resp.Checks[c.Name] = healthUnavailable
				logger.WarnContext(ctx, "health check failed",
					slog.String("check", c.Name),
					slog.String("request_id", RequestID(r.Context())),
					slog.Any("error", err))
				continue
			}
			resp.Checks[c.Name] = healthOK
		}

		status := http.StatusOK
		if resp.Status != healthOK {
			status = http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(resp)
	})
}
