// Package authtest は、auth.Service を実物の Postgres に対して組み立てるテスト用のヘルパー。
//
// auth と httpx の統合テストで同じ組み立てを繰り返さないために置く。本番のコードからは import しない。
package authtest

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"log/slog"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// Start はテストの時計の初期値。
var Start = time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)

// FastPasswordParams はテスト用の軽い Argon2id のパラメータ。
// -race の下で何百回もハッシュを計算するので、本番の値（19 MiB）ではテストが遅くなりすぎる。
var FastPasswordParams = auth.PasswordParams{MemoryKiB: 64, Iterations: 1, Parallelism: 1, SaltLen: 16, KeyLen: 32}

const (
	Issuer   = "hibari-test"
	Audience = "hibari-test-api"
	// AppBaseURL はメールのリンクの起点。
	AppBaseURL = "https://app.hibari.test"
)

// generous は、回数制限そのものを確かめるテスト以外で制限にかからないためのルール。
// httptest のサーバーでは全員が 127.0.0.1 から接続し、Clock も同じ時刻から始まるので、本番の値だとテスト同士が制限を食い合う。
func generous(name string) ratelimit.Rule {
	return ratelimit.Rule{Name: name, Limit: 1 << 30, Window: time.Hour}
}

// AvatarLimits はテストで使うアバターの設定値（本番の既定値と同じ）。
var AvatarLimits = auth.AvatarLimits{MaxBytes: 2 << 20, AllowedTypes: []string{"image/png", "image/jpeg", "image/webp"}}

// GenerousRateLimits は実質的に制限しない RateLimits。
var GenerousRateLimits = auth.RateLimits{
	LoginPerIP:               generous("login-ip"),
	LoginPerAccount:          generous("login-account"),
	RegisterPerIP:            generous("register-ip"),
	PasswordResetPerIP:       generous("password-reset-ip"),
	PasswordResetPerAccount:  generous("password-reset-account"),
	EmailVerificationPerUser: generous("email-verification-user"),
}

type options struct {
	limits  auth.RateLimits
	limiter auth.RateLimiter
}

// Option は New の組み立てを変える。
type Option func(*options)

// WithRateLimits は回数制限のルールを差し替える。Redis には他のテストの回数も残っているので、
// ルールの Name は RuleName で実行ごとに一意にする。
func WithRateLimits(l auth.RateLimits) Option {
	return func(o *options) { o.limits = l }
}

// WithRateLimiter は回数制限の判定そのものを差し替える（Redis の障害を再現するなど）。
func WithRateLimiter(l auth.RateLimiter) Option {
	return func(o *options) { o.limiter = l }
}

// Env は組み立て済みの Service とその依存。
type Env struct {
	Pool         *pgxpool.Pool
	Storage      *storage.S3
	Clock        *clock.Fake
	IDs          id.Generator
	Service      *auth.Service
	AccessTokens *auth.AccessTokenIssuer
	Verifier     *authn.Verifier
	Revocations  *RecordingNotifier
	Mailer       *RecordingMailer
}

// New は Env を返す。TEST_DATABASE_URL / TEST_REDIS_URL がなければテストをスキップする（CI では失敗する）。
func New(t testing.TB, opts ...Option) *Env {
	t.Helper()
	o := options{limits: GenerousRateLimits}
	for _, opt := range opts {
		opt(&o)
	}

	pool, err := db.Open(t.Context(), testenv.DatabaseURL(t))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(pool.Close)

	clk := clock.NewFake(Start)
	ids := id.NewGenerator(clk, rand.Reader)
	if o.limiter == nil {
		rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
		if err != nil {
			t.Fatalf("open redis: %v", err)
		}
		t.Cleanup(func() { _ = rdb.Close() })
		o.limiter = ratelimit.New(rdb, clk)
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	issuer, err := auth.NewAccessTokenIssuer(key, Issuer, Audience, clk, ids)
	if err != nil {
		t.Fatal(err)
	}
	passwords, err := auth.NewPasswordHasher(FastPasswordParams, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	st, err := storage.New(storage.Config{
		Endpoint:        testenv.S3(t).Endpoint,
		Region:          "us-east-1",
		Bucket:          testenv.S3(t).Bucket,
		AccessKeyID:     testenv.S3(t).AccessKeyID,
		SecretAccessKey: testenv.S3(t).SecretAccessKey,
		UsePathStyle:    true,
	})
	if err != nil {
		t.Fatalf("open storage: %v", err)
	}

	rec := &RecordingNotifier{}
	mailer := &RecordingMailer{}
	baseURL, _ := url.Parse(AppBaseURL)
	svc := auth.NewService(auth.Deps{
		DB:           pool,
		Clock:        clk,
		IDs:          ids,
		Random:       rand.Reader,
		Passwords:    passwords,
		AccessTokens: issuer,
		Revocations:  rec,
		Limiter:      o.limiter,
		Limits:       o.limits,
		Storage:      st,
		AvatarLimits: AvatarLimits,
		Mailer:       mailer,
		AppBaseURL:   baseURL,
		Logger:       slog.New(slog.DiscardHandler),
	})
	return &Env{
		Pool:         pool,
		Storage:      st,
		Clock:        clk,
		IDs:          ids,
		Service:      svc,
		AccessTokens: issuer,
		Verifier:     authn.NewVerifier([]authn.PublicKey{issuer.PublicKey()}, Issuer, Audience, clk),
		Revocations:  rec,
		Mailer:       mailer,
	}
}

// RuleName は実行ごとに一意なルール名を返す。
func RuleName(base string) string {
	return base + "-" + ulid.Make().String()
}

// NewIP は他のテストと重ならない IPv6 アドレスを返す（IP 単位の回数制限のテスト用）。
func (e *Env) NewIP() netip.Addr {
	b := e.IDs.New()
	b[0] = 0x20 // 2000::/3 のグローバルユニキャストにする
	return netip.AddrFrom16(b)
}

// NewRegisterInput は、他のテスト（並行して走る別パッケージを含む）と衝突しない登録の入力を返す。
// テスト用 DB はパッケージをまたいで共有するので、固定の email や handle を使わない。
func (e *Env) NewRegisterInput() auth.RegisterInput {
	handle := "u" + strings.ToLower(e.IDs.New().String())
	return auth.RegisterInput{
		Handle:      handle,
		DisplayName: "テスト " + handle[len(handle)-4:],
		Email:       handle + "@example.com",
		Password:    "correct horse battery staple",
	}
}

// Register は新しいユーザーを登録し、ユーザー・最初のセッション・入力を返す。
func (e *Env) Register(t testing.TB) (auth.User, auth.Session, auth.RegisterInput) {
	t.Helper()
	in := e.NewRegisterInput()
	u, s, err := e.Service.Register(t.Context(), in, auth.Client{UserAgent: "authtest"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	return u, s, in
}

// RecordingNotifier は publish された失効イベントを記録する。Redis への publish そのものは authn のテストで確かめる。
type RecordingNotifier struct {
	mu       sync.Mutex
	sessions []ulid.ULID
	users    []ulid.ULID
}

func (r *RecordingNotifier) RevokeSession(_ context.Context, sid ulid.ULID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions = append(r.sessions, sid)
	return nil
}

func (r *RecordingNotifier) RevokeAllSessions(_ context.Context, userID ulid.ULID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.users = append(r.users, userID)
	return nil
}

// Sessions は失効が通知されたセッション ID を、通知された順に返す。
func (r *RecordingNotifier) Sessions() []ulid.ULID {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]ulid.ULID(nil), r.sessions...)
}

// Users は全セッションの失効が通知されたユーザー ID を返す。
func (r *RecordingNotifier) Users() []ulid.ULID {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]ulid.ULID(nil), r.users...)
}

// Mail は送られた（ことにした）メール。
type Mail struct {
	Kind string // "email_verification" / "password_reset"
	To   string
	Link string
}

// Token はリンクのクエリ文字列からトークンを取り出す。
func (m Mail) Token() string {
	u, err := url.Parse(m.Link)
	if err != nil {
		return ""
	}
	return u.Query().Get("token")
}

// RecordingMailer は送信を記録する Mailer。
type RecordingMailer struct {
	mu    sync.Mutex
	mails []Mail
	// err が nil でなければ、記録した上でこのエラーを返す（送信の失敗を再現する）。SetErr で設定する。
	err error
}

func (m *RecordingMailer) record(kind, to, link string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mails = append(m.mails, Mail{Kind: kind, To: to, Link: link})
	return m.err
}

func (m *RecordingMailer) SendEmailVerification(_ context.Context, to, link string) error {
	return m.record("email_verification", to, link)
}

func (m *RecordingMailer) SendPasswordReset(_ context.Context, to, link string) error {
	return m.record("password_reset", to, link)
}

// SetErr は以降の送信で返すエラーを設定する。
func (m *RecordingMailer) SetErr(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.err = err
}

// Sent は to 宛てに送られたメールを送信順に返す。
func (m *RecordingMailer) Sent(to string) []Mail {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Mail
	for _, mail := range m.mails {
		if strings.EqualFold(mail.To, to) {
			out = append(out, mail)
		}
	}
	return out
}

// Last は to 宛ての最後のメールを返す。なければテストを失敗させる。
func (m *RecordingMailer) Last(t testing.TB, to string) Mail {
	t.Helper()
	sent := m.Sent(to)
	if len(sent) == 0 {
		t.Fatalf("no mail was sent to %s", to)
	}
	return sent[len(sent)-1]
}
