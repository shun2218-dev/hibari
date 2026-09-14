package auth_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/auth/authtest"
)

// revokedReasons は family のトークンの失効理由を作成順に返す（NULL は "active"）。
func revokedReasons(t *testing.T, env *authtest.Env, familyID ulid.ULID) []string {
	t.Helper()
	rows, err := env.Pool.Query(t.Context(),
		`SELECT coalesce(revoked_reason, 'active') FROM refresh_tokens WHERE family_id = $1 ORDER BY id`, familyID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		got = append(got, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return got
}

func equalStrings(a, b []string) bool {
	return strings.Join(a, ",") == strings.Join(b, ",")
}

func TestRegister(t *testing.T) {
	env := authtest.New(t)
	in := env.NewRegisterInput()
	client := auth.Client{UserAgent: "Mozilla/5.0 " + strings.Repeat("x", 600), IP: netip.MustParseAddr("::ffff:192.0.2.10")}

	u, s, err := env.Service.Register(t.Context(), in, client)
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if u.Handle != in.Handle || u.Email != in.Email || u.DisplayName != in.DisplayName || u.EmailVerified {
		t.Errorf("user = %+v, want fields from input and unverified email", u)
	}
	if !u.CreatedAt.Equal(authtest.Start) {
		t.Errorf("created_at = %v, want the clock's time", u.CreatedAt)
	}

	// 登録するとそのままログインした状態になる。
	id, err := env.Verifier.Verify(s.AccessToken)
	if err != nil {
		t.Fatalf("access token does not verify: %v", err)
	}
	if id.UserID != u.ID || id.SessionID != s.ID {
		t.Errorf("identity = %+v, want user %s session %s", id, u.ID, s.ID)
	}
	if want := authtest.Start.Add(30 * 24 * time.Hour); !s.RefreshTokenExpiresAt.Equal(want) {
		t.Errorf("refresh expires at %v, want %v", s.RefreshTokenExpiresAt, want)
	}

	// DB には生の値ではなく SHA-256 だけを保存する。User-Agent は切り詰め、IPv4-mapped の IPv6 は IPv4 にする。
	var (
		hash []byte
		ua   string
		ip   netip.Addr
	)
	if err := env.Pool.QueryRow(t.Context(),
		`SELECT token_hash, user_agent, ip FROM refresh_tokens WHERE family_id = $1`, s.ID).Scan(&hash, &ua, &ip); err != nil {
		t.Fatal(err)
	}
	if want := sha256.Sum256([]byte(s.RefreshToken)); string(hash) != string(want[:]) {
		t.Error("token_hash is not the SHA-256 of the refresh token")
	}
	if len(ua) != 512 {
		t.Errorf("user_agent length = %d, want truncated to 512", len(ua))
	}
	if ip != netip.MustParseAddr("192.0.2.10") {
		t.Errorf("ip = %v, want 192.0.2.10", ip)
	}
}

func TestRegisterRejectsDuplicates(t *testing.T) {
	env := authtest.New(t)
	_, _, existing := env.Register(t)

	tests := []struct {
		name    string
		mutate  func(in *auth.RegisterInput)
		wantErr error
	}{
		// citext なので大文字小文字だけが違う値も重複になる。
		{name: "same email in different case", mutate: func(in *auth.RegisterInput) { in.Email = strings.ToUpper(existing.Email) }, wantErr: auth.ErrEmailTaken},
		{name: "same handle in different case", mutate: func(in *auth.RegisterInput) { in.Handle = strings.ToUpper(existing.Handle) }, wantErr: auth.ErrHandleTaken},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := env.NewRegisterInput()
			tt.mutate(&in)
			_, _, err := env.Service.Register(t.Context(), in, auth.Client{})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Register() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestRegisterValidationDoesNotTouchDB(t *testing.T) {
	env := authtest.New(t)
	_, _, err := env.Service.Register(t.Context(), auth.RegisterInput{Handle: "x"}, auth.Client{})
	var verr *auth.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("Register() error = %v, want *ValidationError", err)
	}
}

func TestLogin(t *testing.T) {
	env := authtest.New(t)
	u, _, in := env.Register(t)

	tests := []struct {
		name     string
		email    string
		password string
		wantErr  error
	}{
		{name: "correct", email: in.Email, password: in.Password},
		{name: "email is case-insensitive and trimmed", email: "  " + strings.ToUpper(in.Email) + " ", password: in.Password},
		{name: "wrong password", email: in.Email, password: in.Password + "!", wantErr: auth.ErrInvalidCredentials},
		// 存在しない email でも、パスワード違いと同じエラーにする。
		{name: "unknown email", email: "nobody-" + in.Email, password: in.Password, wantErr: auth.ErrInvalidCredentials},
		{name: "empty", wantErr: auth.ErrInvalidCredentials},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotUser, s, err := env.Service.Login(t.Context(), tt.email, tt.password, auth.Client{})
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("Login() error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Login() error = %v", err)
			}
			if gotUser.ID != u.ID {
				t.Errorf("user = %s, want %s", gotUser.ID, u.ID)
			}
			if id, err := env.Verifier.Verify(s.AccessToken); err != nil || id.SessionID != s.ID {
				t.Errorf("Verify() = %+v, %v", id, err)
			}
		})
	}
}

// ログインのたびに別のセッション（family）になる。
func TestLoginStartsNewSession(t *testing.T) {
	env := authtest.New(t)
	_, first, in := env.Register(t)
	_, second, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("login reused the session id of another session")
	}
}

func TestRefreshRotatesAndDetectsReuse(t *testing.T) {
	env := authtest.New(t)
	u, s1, _ := env.Register(t)

	env.Clock.Advance(time.Minute)
	s2, err := env.Service.Refresh(t.Context(), s1.RefreshToken, auth.Client{})
	if err != nil {
		t.Fatalf("Refresh(r1) error = %v", err)
	}
	if s2.ID != s1.ID {
		t.Errorf("session id changed on rotation: %s -> %s", s1.ID, s2.ID)
	}
	if s2.RefreshToken == s1.RefreshToken || s2.AccessToken == s1.AccessToken {
		t.Error("rotation returned the same tokens")
	}
	// 有効期限はローテーションした時点から数え直す。
	if want := authtest.Start.Add(time.Minute + 30*24*time.Hour); !s2.RefreshTokenExpiresAt.Equal(want) {
		t.Errorf("refresh expires at %v, want %v", s2.RefreshTokenExpiresAt, want)
	}
	if id, err := env.Verifier.Verify(s2.AccessToken); err != nil || id.UserID != u.ID || id.SessionID != s1.ID {
		t.Errorf("Verify(new access token) = %+v, %v", id, err)
	}

	s3, err := env.Service.Refresh(t.Context(), s2.RefreshToken, auth.Client{})
	if err != nil {
		t.Fatalf("Refresh(r2) error = %v", err)
	}
	if got := revokedReasons(t, env, s1.ID); !equalStrings(got, []string{"rotated", "rotated", "active"}) {
		t.Fatalf("reasons after two rotations = %v", got)
	}

	// 1 度使った r1 をもう一度使うと、family 全体が失効する。
	if _, err := env.Service.Refresh(t.Context(), s1.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("Refresh(reused r1) error = %v, want ErrInvalidRefreshToken", err)
	}
	if got := revokedReasons(t, env, s1.ID); !equalStrings(got, []string{"rotated", "rotated", "reuse_detected"}) {
		t.Fatalf("reasons after reuse = %v", got)
	}
	// 正規の最新トークン r3 も使えなくなる。
	if _, err := env.Service.Refresh(t.Context(), s3.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("Refresh(r3 after reuse) error = %v, want ErrInvalidRefreshToken", err)
	}
	// 失効の通知は family が実際に失効した 1 回だけ。
	if got := env.Revocations.Sessions(); len(got) != 1 || got[0] != s1.ID {
		t.Fatalf("revoked sessions = %v, want [%s]", got, s1.ID)
	}
}

func TestRefreshRejects(t *testing.T) {
	env := authtest.New(t)

	t.Run("unknown token", func(t *testing.T) {
		if _, err := env.Service.Refresh(t.Context(), "not-a-token", auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("empty token", func(t *testing.T) {
		if _, err := env.Service.Refresh(t.Context(), "", auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("expired token", func(t *testing.T) {
		env := authtest.New(t)
		_, s, _ := env.Register(t)
		env.Clock.Advance(30 * 24 * time.Hour)
		if _, err := env.Service.Refresh(t.Context(), s.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
			t.Fatalf("error = %v", err)
		}
		// 期限切れは再利用ではないので、失効させない。
		if got := revokedReasons(t, env, s.ID); !equalStrings(got, []string{"active"}) {
			t.Fatalf("reasons = %v, want the expired token left as is", got)
		}
	})
	t.Run("deleted user", func(t *testing.T) {
		env := authtest.New(t)
		u, s, in := env.Register(t)
		if _, err := env.Pool.Exec(t.Context(), `UPDATE users SET deleted_at = $1 WHERE id = $2`, authtest.Start, u.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.Refresh(t.Context(), s.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
			t.Errorf("Refresh() error = %v", err)
		}
		if _, _, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{}); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Errorf("Login() error = %v", err)
		}
		if _, err := env.Service.Me(t.Context(), u.ID); !errors.Is(err, auth.ErrUserNotFound) {
			t.Errorf("Me() error = %v", err)
		}
	})
}

// 同じ Refresh Token で同時に refresh しても、成功は 1 件だけで、残りは再利用として family ごと失効する。
// 行ロック（FOR UPDATE）がないと、複数の goroutine が同じトークンをローテーションできてしまう。
//
// 単に goroutine を同時に起動するだけだと、プールの接続が作られる間に 1 本目がコミットまで終わってしまい、
// 競合が起きずにテストが通ってしまう（FOR UPDATE を消しても通る）。そこで別のトランザクションで対象の行を
// ロックしておき、全員がその行のロック待ちに入ったことを確かめてから解放して、確実に競合させる。
func TestRefreshConcurrentSameToken(t *testing.T) {
	env := authtest.New(t)
	_, s, _ := env.Register(t)

	blocker, err := env.Pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = blocker.Rollback(context.WithoutCancel(t.Context())) }()
	if _, err := blocker.Exec(t.Context(), `SELECT 1 FROM refresh_tokens WHERE family_id = $1 FOR UPDATE`, s.ID); err != nil {
		t.Fatal(err)
	}

	const n = 20
	// blocker が 1 本使うので、同時にロック待ちに入れるのはプールの残りの本数まで。溢れた分はプールの空きを待つ。
	concurrent := min(n, int(env.Pool.Config().MaxConns)-1)
	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		successes []auth.Session
		failures  int
	)
	for range n {
		wg.Go(func() {
			got, err := env.Service.Refresh(t.Context(), s.RefreshToken, auth.Client{})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				successes = append(successes, got)
			case errors.Is(err, auth.ErrInvalidRefreshToken):
				failures++
			default:
				t.Errorf("Refresh() unexpected error = %v", err)
			}
		})
	}
	waitForLockWaiters(t, blocker, concurrent)
	if err := blocker.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	wg.Wait()

	if len(successes) != 1 || failures != n-1 {
		t.Fatalf("successes = %d, failures = %d; want 1 and %d", len(successes), failures, n-1)
	}
	// 勝った 1 件のトークンも、後続の再利用検知で失効している。
	if _, err := env.Service.Refresh(t.Context(), successes[0].RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("Refresh(winner's token) error = %v, want ErrInvalidRefreshToken", err)
	}
	if got := env.Revocations.Sessions(); len(got) != 1 {
		t.Fatalf("revocation notified %d times, want once", len(got))
	}
}

// waitForLockWaiters は、blocker が持つ行ロックを want 本のセッションが待っている状態になるまで待つ。
// pg_blocking_pids を blocker から辿って数えるので、並行して走る他のテストの影響を受けない。
// 辿る必要があるのは、2 本目以降の待ちは blocker ではなく「先に並んだ待ち」（行のロックを取った側）に待たされるため。
// pg_stat_activity はトランザクション内で最初に読んだ内容がキャッシュされて変わらないので、ロック管理の現在の状態を返す pg_locks を使う。
// 問い合わせは blocker の接続で行う。プールの接続はロック待ちの goroutine が使い切っているので、
// プールから借りようとすると解放されない接続を待ち続けてデッドロックする。
func waitForLockWaiters(t *testing.T, blocker pgx.Tx, want int) {
	t.Helper()
	var blockerPID int
	if err := blocker.QueryRow(t.Context(), `SELECT pg_backend_pid()`).Scan(&blockerPID); err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.After(10 * time.Second)
	for {
		var got int
		if err := blocker.QueryRow(t.Context(), `
			WITH RECURSIVE
			    pending AS (SELECT DISTINCT pid FROM pg_locks WHERE NOT granted),
			    waiters(pid) AS (
			        SELECT pid FROM pending WHERE $1::int = ANY(pg_blocking_pids(pid))
			        UNION
			        SELECT p.pid FROM pending p JOIN waiters w ON w.pid = ANY(pg_blocking_pids(p.pid))
			    )
			SELECT count(*) FROM waiters`, blockerPID).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got >= want {
			return
		}
		select {
		case <-ticker.C:
		case <-timeout:
			t.Fatalf("%d sessions are waiting for the lock, want %d", got, want)
		}
	}
}

// 別の端末（セッション）でログアウトしても、自分のセッションは有効なまま（ADR 0007）。
func TestLogoutRevokesOnlyThatSession(t *testing.T) {
	env := authtest.New(t)
	_, mine, in := env.Register(t)
	_, other, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{})
	if err != nil {
		t.Fatal(err)
	}
	// ローテーション済みのチェーンでも、最新のトークンでログアウトできる。
	other, err = env.Service.Refresh(t.Context(), other.RefreshToken, auth.Client{})
	if err != nil {
		t.Fatal(err)
	}

	if err := env.Service.Logout(t.Context(), other.RefreshToken); err != nil {
		t.Fatalf("Logout() error = %v", err)
	}
	if got := revokedReasons(t, env, other.ID); !equalStrings(got, []string{"rotated", "logout"}) {
		t.Fatalf("reasons of the logged-out session = %v", got)
	}
	if _, err := env.Service.Refresh(t.Context(), other.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("Refresh(logged-out session) error = %v", err)
	}
	if _, err := env.Service.Refresh(t.Context(), mine.RefreshToken, auth.Client{}); err != nil {
		t.Fatalf("Refresh(my session) error = %v, want still valid", err)
	}

	// 2 回目のログアウトや、知らないトークンでのログアウトは成功扱いで、通知もしない。
	if err := env.Service.Logout(t.Context(), other.RefreshToken); err != nil {
		t.Fatalf("second Logout() error = %v", err)
	}
	if err := env.Service.Logout(t.Context(), "unknown"); err != nil {
		t.Fatalf("Logout(unknown) error = %v", err)
	}
	// logout で失効した family のトークンを使っても、再利用として二重に通知しない。
	if got := env.Revocations.Sessions(); len(got) != 1 || got[0] != other.ID {
		t.Fatalf("revoked sessions = %v, want [%s]", got, other.ID)
	}
}

func TestSessionActive(t *testing.T) {
	env := authtest.New(t)
	u, mine, in := env.Register(t)
	_, other, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{})
	if err != nil {
		t.Fatal(err)
	}
	active := func(userID, sid ulid.ULID) bool {
		t.Helper()
		ok, err := env.Service.SessionActive(t.Context(), userID, sid)
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}

	if !active(u.ID, mine.ID) || !active(u.ID, other.ID) {
		t.Fatal("new sessions are not active")
	}
	// 別のユーザーの ID と組み合わせた sid は有効にしない。
	stranger, _, _ := env.Register(t)
	if active(stranger.ID, mine.ID) {
		t.Error("session is active for another user")
	}
	if active(u.ID, env.IDs.New()) {
		t.Error("unknown session is active")
	}

	// ローテーションしても同じセッションのまま有効。
	if _, err := env.Service.Refresh(t.Context(), mine.RefreshToken, auth.Client{}); err != nil {
		t.Fatal(err)
	}
	if !active(u.ID, mine.ID) {
		t.Error("session is not active after rotation")
	}

	// ログアウトしたセッションだけが無効になる。
	if err := env.Service.Logout(t.Context(), other.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if active(u.ID, other.ID) || !active(u.ID, mine.ID) {
		t.Errorf("after logout: other active = %v, mine active = %v", active(u.ID, other.ID), active(u.ID, mine.ID))
	}

	// Refresh Token の期限を過ぎたら無効。
	env.Clock.Advance(auth.RefreshTokenTTL + time.Second)
	if active(u.ID, mine.ID) {
		t.Error("session is active after the refresh token expired")
	}
}

func TestMe(t *testing.T) {
	env := authtest.New(t)
	u, _, _ := env.Register(t)

	got, err := env.Service.Me(t.Context(), u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != u {
		t.Fatalf("Me() = %+v, want %+v", got, u)
	}
	if _, err := env.Service.Me(t.Context(), env.IDs.New()); !errors.Is(err, auth.ErrUserNotFound) {
		t.Fatalf("Me(unknown) error = %v, want ErrUserNotFound", err)
	}
}
