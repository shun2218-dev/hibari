// Package authtest は、auth.Service を実物の Postgres に対して組み立てるテスト用のヘルパー。
//
// auth と httpx の統合テストで同じ組み立てを繰り返さないために置く。本番のコードからは import しない。
package authtest

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"log/slog"
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
)

// Env は組み立て済みの Service とその依存。
type Env struct {
	Pool         *pgxpool.Pool
	Clock        *clock.Fake
	IDs          id.Generator
	Service      *auth.Service
	AccessTokens *auth.AccessTokenIssuer
	Verifier     *authn.Verifier
	Revocations  *RecordingNotifier
}

// New は Env を返す。TEST_DATABASE_URL がなければテストをスキップする（CI では失敗する）。
func New(t testing.TB) *Env {
	t.Helper()
	pool, err := db.Open(t.Context(), testenv.DatabaseURL(t))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(pool.Close)

	clk := clock.NewFake(Start)
	ids := id.NewGenerator(clk, rand.Reader)
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
	rec := &RecordingNotifier{}
	svc := auth.NewService(auth.Deps{
		DB:           pool,
		Clock:        clk,
		IDs:          ids,
		Random:       rand.Reader,
		Passwords:    passwords,
		AccessTokens: issuer,
		Revocations:  rec,
		Logger:       slog.New(slog.DiscardHandler),
	})
	return &Env{
		Pool:         pool,
		Clock:        clk,
		IDs:          ids,
		Service:      svc,
		AccessTokens: issuer,
		Verifier:     authn.NewVerifier([]authn.PublicKey{issuer.PublicKey()}, Issuer, Audience, clk),
		Revocations:  rec,
	}
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
