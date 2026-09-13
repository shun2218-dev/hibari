// Package httpx は HTTP のルーティング、ミドルウェア、サーバーの起動と停止を担う。
// ドメインエラーから HTTP レスポンスへの変換もここだけで行う（Phase 2 以降）。
package httpx

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

// Serve は ln で srv を動かし、ctx がキャンセルされたら graceful shutdown する。
//
// shutdown では新規の接続の受け付けを止め、処理中のリクエストが終わるのを timeout まで待つ。
// デプロイや `docker compose restart` のたびに処理中のリクエストを切らないため。
// WebSocket のように Hijack された接続は Shutdown の対象外なので、呼び出し側（main）が戻った後に Hub を止める（ADR 0015）。
func Serve(ctx context.Context, srv *http.Server, ln net.Listener, timeout time.Duration) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.Serve(ln)
	}()

	select {
	case err := <-errCh:
		// ctx より先に Serve が終わるのは異常（ポートの問題など）。
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	// 親の ctx はキャンセル済みなので、待ち時間の上限には新しい context を使う。
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	// Serve の goroutine が終わるのを待ってから返す（goroutine を残さない）。
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	return nil
}
