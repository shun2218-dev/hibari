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
	"sync"
	"syscall"
	"time"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/presence"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/httpx"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/config"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	platformlog "github.com/shun2218-dev/hibari/internal/platform/log"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
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
	// instanceID はこのプロセスを表す。presence でインスタンスごとの接続の有無を数えるのと、Pub/Sub の再接続の検知に使う（ADR 0016）。
	// 複数台のログを見分けられるよう、すべてのログに付ける。
	instanceID := ids.New()
	logger = logger.With(slog.String("instance_id", instanceID.String()))

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
	// ストレージには起動時に接続しない。落ちていても、添付とアバター以外の機能は動かせるようにする。
	objectStorage, err := storage.New(cfg.Storage)
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
		Storage:      objectStorage,
		AvatarLimits: auth.AvatarLimits{MaxBytes: cfg.AvatarMaxBytes, AllowedTypes: cfg.AvatarAllowedTypes},
		// 本番用のメール送信はまだない。デプロイ（Phase 7 以降）の前に、非同期で送る実装に差し替える。
		Mailer:     auth.LogMailer{Logger: logger},
		AppBaseURL: cfg.AppBaseURL,
		Logger:     logger,
	})
	// 同じプロセスなので公開鍵を直接渡す。auth を別プロセスに切り出したら、JWKS を取得して渡す形に変える（ADR 0001）。
	verifier := authn.NewVerifier([]authn.PublicKey{accessTokens.PublicKey()}, cfg.JWTIssuer, cfg.JWTAudience, clk)


	// WebSocket の配信（ADR 0015 / 0016）。イベントは Redis Pub/Sub で全インスタンスに流し、各インスタンスの Hub が自分の接続に届ける。
	broker, err := realtime.NewBroker(startupCtx, rdb, instanceID, logger)
	if err != nil {
		return err
	}
	delivery := realtime.NewRedisDelivery(rdb, ids, logger)
	presenceStore := presence.New(rdb, instanceID)
	hub := realtime.NewHub(realtime.Deps{
		Authorizer: chat.NewSubscriptionAuthorizer(pool),
		Presence:   presenceStore,
		// chat は auth を import しないので、セッションの有効性の問い合わせは authn のインターフェースとしてここで配線する（ADR 0001）。
		Sessions:   authService,
		Publisher:  delivery,
		Subscriber: broker,
		Logger:     logger,
	})
	// 失効イベントの購読は、接続を受け付ける前に始める。始める前に発行された失効は、ws-ticket の消費時の検証で拒否される。
	revocations, err := authn.SubscribeRevocations(startupCtx, rdb, logger)
	if err != nil {
		return err
	}

	chatService := chat.NewService(chat.Deps{
		DB:               pool,
		Clock:            clk,
		IDs:              ids,
		Random:           rand.Reader,
		Logger:           logger,
		Storage:          objectStorage,
		AttachmentLimits: chat.AttachmentLimits{MaxBytes: cfg.AttachmentMaxBytes, AllowedTypes: cfg.AttachmentAllowedTypes},
		Delivery:         delivery,
		Presence:         presenceStore,
	})

	// 添付の掃除ジョブ（ADR 0013）。DB のプールを閉じる前に止めて、終わるのを待つ。
	// defer は後に書いたものから実行されるので、pool.Close の defer より後に書く。
	// Hub の定期処理（presence の延長と再検証）と、失効イベントの購読も同じく止めてから後始末する。
	jobCtx, stopJobs := context.WithCancel(ctx)
	var jobs sync.WaitGroup
	jobs.Go(func() { chatService.RunAttachmentCleanup(jobCtx, chat.AttachmentCleanupInterval) })
	jobs.Go(func() { hub.Run(jobCtx, presence.RefreshInterval, realtime.RevalidateInterval) })
	jobs.Go(func() {
		if err := revocations.Run(jobCtx, hub.CloseSessions); err != nil {
			// Redis との接続が切れて購読が終わった。失効の反映は定期の再検証（5 分ごと）に頼ることになる。
			logger.ErrorContext(jobCtx, "revocation subscription stopped", slog.Any("error", err))
		}
	})
	defer func() {
		stopJobs()
		jobs.Wait()
	}()

	// Redis Pub/Sub の受信（ADR 0016）は、停止の合図（ctx）では止めず、Hub の停止が終わってから止める。
	// 先に止めると、停止の途中で閉じていく接続の購読の解除や、その間に届くイベントの受け渡しができない。
	// defer は後に書いたものから実行されるので、Redis のクライアントを閉じる defer より先に実行される。
	brokerCtx, stopBroker := context.WithCancel(context.WithoutCancel(ctx))
	brokerDone := make(chan struct{})
	go func() {
		defer close(brokerDone)
		broker.Run(brokerCtx, hub)
	}()
	defer func() {
		stopBroker()
		<-brokerDone
	}()

	handler := httpx.NewRouter(httpx.Deps{
		Logger: logger,
		Clock:  clk,
		IDs:    ids,
		HealthChecks: []httpx.HealthCheck{
			{Name: "postgres", Check: pool.Ping},
			{Name: "redis", Check: func(ctx context.Context) error { return rdb.Ping(ctx).Err() }},
		},
		// 前段のプロキシ（ローカルは Caddy、本番は Fly のプロキシ）。空なら X-Forwarded-For を読まない（ADR 0017）。
		TrustedProxies:      cfg.TrustedProxies,
		Auth:                authService,
		Verifier:            verifier,
		JWKS:                jwks,
		RefreshCookieSecure: cfg.RefreshCookieSecure,
		Chat:                chatService,
		Realtime:            hub,
		WSTickets:           authn.NewWSTickets(rdb, rand.Reader),
		Sessions:            authService,
		// ブラウザからの接続は Web クライアントのオリジンだけを許す。
		WS: httpx.DefaultWSConfig([]string{cfg.AppBaseURL.Host}),
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
	// http.Server.Shutdown はアップグレード済みの WebSocket を扱わないので、Hub に閉じさせて、登録が外れるのを待つ。
	// DB のプールを閉じる（defer）前に、接続の後始末（presence の更新など）を終わらせる。
	hubCtx, cancelHub := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
	defer cancelHub()
	if err := hub.Shutdown(hubCtx); err != nil {
		return fmt.Errorf("shutdown websocket hub: %w", err)
	}
	logger.InfoContext(ctx, "server stopped")
	return nil
}
