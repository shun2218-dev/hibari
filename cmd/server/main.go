// Command server は hibari の API サーバー（auth と chat を同居させた単一バイナリ。ADR 0001）。
package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/httpx"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/config"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	platformlog "github.com/shun2218-dev/hibari/internal/platform/log"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
)

// version はビルド時に -ldflags "-X main.version=vX.Y.Z" で埋め込む（CLAUDE.md「リリース手順」）。
var version = "dev"

func main() {
	// SIGTERM は docker compose stop / Kubernetes などが送る停止要求。SIGINT は Ctrl+C と air の再起動。
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.LookupEnv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "server:", err)
		os.Exit(1)
	}
}

// run は依存を組み立ててサーバーを動かし、ctx がキャンセルされたら後始末をして返す。
// main から分けているのは、defer による後始末を os.Exit より前に確実に走らせるため。
func run(ctx context.Context, lookupEnv config.LookupEnv, logOut io.Writer) error {
	cfg, err := config.Load(lookupEnv)
	if err != nil {
		return err
	}
	logger := platformlog.New(logOut, cfg.LogLevel, cfg.LogFormat)

	// 鍵がなければ DB に接続する前に落とす。動き出してから「ログインだけできない」状態にしない。
	keyPEM, err := os.ReadFile(cfg.JWTPrivateKeyFile)
	if err != nil {
		return fmt.Errorf("read JWT_PRIVATE_KEY_FILE (run `make keys` to create a development key): %w", err)
	}
	signingKey, err := auth.ParseEd25519PrivateKeyPEM(keyPEM)
	if err != nil {
		return err
	}

	// 起動時の接続は無期限に待たない。依存先が上がっていないなら早く落として再起動に任せる。
	startupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	pool, err := db.Open(startupCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	rdb, err := redis.Open(startupCtx, cfg.RedisURL)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()

	clk := clock.System{}
	ids := id.NewGenerator(clk, rand.Reader)

	accessTokens, err := auth.NewAccessTokenIssuer(signingKey, cfg.JWTIssuer, cfg.JWTAudience, clk, ids)
	if err != nil {
		return err
	}
	jwks, err := accessTokens.JWKS()
	if err != nil {
		return err
	}
	passwords, err := auth.NewPasswordHasher(auth.DefaultPasswordParams, rand.Reader)
	if err != nil {
		return err
	}
	authService := auth.NewService(auth.Deps{
		DB:           pool,
		Clock:        clk,
		IDs:          ids,
		Random:       rand.Reader,
		Passwords:    passwords,
		AccessTokens: accessTokens,
		Revocations:  authn.NewRevocationPublisher(rdb),
		Limiter:      ratelimit.New(rdb, clk),
		Limits:       auth.DefaultRateLimits,
		// 本番用のメール送信はまだない。デプロイ（Phase 7 以降）の前に、非同期で送る実装に差し替える。
		Mailer:     auth.LogMailer{Logger: logger},
		AppBaseURL: cfg.AppBaseURL,
		Logger:     logger,
	})
	// 同じプロセスなので公開鍵を直接渡す。auth を別プロセスに切り出したら、JWKS を取得して渡す形に変える（ADR 0001）。
	verifier := authn.NewVerifier([]authn.PublicKey{accessTokens.PublicKey()}, cfg.JWTIssuer, cfg.JWTAudience, clk)

	handler := httpx.NewRouter(httpx.Deps{
		Logger: logger,
		Clock:  clk,
		IDs:    ids,
		HealthChecks: []httpx.HealthCheck{
			{Name: "postgres", Check: pool.Ping},
			{Name: "redis", Check: func(ctx context.Context) error { return rdb.Ping(ctx).Err() }},
		},
		Auth:                authService,
		Verifier:            verifier,
		JWKS:                jwks,
		RefreshCookieSecure: cfg.RefreshCookieSecure,
	})

	srv := &http.Server{
		Handler: handler,
		// Slowloris 対策としてヘッダの読み取りに上限を設ける。
		// WriteTimeout は設定しない。長時間つながる WebSocket（Phase 4）を切ってしまうため。
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", cfg.HTTPAddr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", cfg.HTTPAddr, err)
	}

	logger.InfoContext(ctx, "server started", slog.String("addr", ln.Addr().String()), slog.String("version", version))
	if err := httpx.Serve(ctx, srv, ln, cfg.ShutdownTimeout); err != nil {
		return err
	}
	logger.InfoContext(ctx, "server stopped")
	return nil
}
