package auth_test

import (
	"errors"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/auth/authtest"
)

func TestRegisterSendsEmailVerification(t *testing.T) {
	env := authtest.New(t)
	u, _, in := env.Register(t)

	mail := env.Mailer.Last(t, in.Email)
	if mail.Kind != "email_verification" || !strings.HasPrefix(mail.Link, authtest.AppBaseURL+"/verify-email?token=") {
		t.Fatalf("mail = %+v", mail)
	}

	// トークンの生の値は DB に保存しない。
	var n int
	if err := env.Pool.QueryRow(t.Context(),
		`SELECT count(*) FROM one_time_tokens WHERE user_id = $1 AND token_hash = convert_to($2, 'UTF8')`, u.ID, mail.Token()).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("raw token is stored in one_time_tokens")
	}

	if err := env.Service.VerifyEmail(t.Context(), mail.Token()); err != nil {
		t.Fatalf("VerifyEmail() error = %v", err)
	}
	got, err := env.Service.Me(t.Context(), u.ID)
	if err != nil || !got.EmailVerified {
		t.Fatalf("Me() = %+v, %v; want verified", got, err)
	}
	// 同じリンクは 2 回使えない。
	if err := env.Service.VerifyEmail(t.Context(), mail.Token()); !errors.Is(err, auth.ErrInvalidOneTimeToken) {
		t.Fatalf("second VerifyEmail() error = %v, want ErrInvalidOneTimeToken", err)
	}
}

// 確認メールを送れなくても登録は成功する。
func TestRegisterSucceedsWhenMailFails(t *testing.T) {
	env := authtest.New(t)
	env.Mailer.SetErr(errors.New("smtp down"))
	if _, _, err := env.Service.Register(t.Context(), env.NewRegisterInput(), auth.Client{}); err != nil {
		t.Fatalf("Register() error = %v, want success even if mail fails", err)
	}
}

func TestVerifyEmailRejects(t *testing.T) {
	tests := []struct {
		name  string
		setup func(t *testing.T, env *authtest.Env) string // 使うトークンを返す
	}{
		{name: "empty", setup: func(*testing.T, *authtest.Env) string { return "" }},
		{name: "unknown", setup: func(*testing.T, *authtest.Env) string { return "unknown-token" }},
		{
			name: "expired after 24 hours",
			setup: func(t *testing.T, env *authtest.Env) string {
				_, _, in := env.Register(t)
				env.Clock.Advance(24 * time.Hour)
				return env.Mailer.Last(t, in.Email).Token()
			},
		},
		{
			name: "superseded by a resent mail",
			setup: func(t *testing.T, env *authtest.Env) string {
				u, _, in := env.Register(t)
				old := env.Mailer.Last(t, in.Email).Token()
				if err := env.Service.RequestEmailVerification(t.Context(), u.ID, ""); err != nil {
					t.Fatal(err)
				}
				return old
			},
		},
		{
			name: "password reset token",
			setup: func(t *testing.T, env *authtest.Env) string {
				_, _, in := env.Register(t)
				if err := env.Service.RequestPasswordReset(t.Context(), in.Email, auth.Client{}); err != nil {
					t.Fatal(err)
				}
				return env.Mailer.Last(t, in.Email).Token()
			},
		},
		{
			name: "user deleted after the mail was sent",
			setup: func(t *testing.T, env *authtest.Env) string {
				u, _, in := env.Register(t)
				if _, err := env.Pool.Exec(t.Context(), `UPDATE users SET deleted_at = $1 WHERE id = $2`, authtest.Start, u.ID); err != nil {
					t.Fatal(err)
				}
				return env.Mailer.Last(t, in.Email).Token()
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := authtest.New(t)
			token := tt.setup(t, env)
			if err := env.Service.VerifyEmail(t.Context(), token); !errors.Is(err, auth.ErrInvalidOneTimeToken) {
				t.Fatalf("VerifyEmail() error = %v, want ErrInvalidOneTimeToken", err)
			}
		})
	}

	t.Run("just before expiry is still valid", func(t *testing.T) {
		env := authtest.New(t)
		_, _, in := env.Register(t)
		env.Clock.Advance(24*time.Hour - time.Second)
		if err := env.Service.VerifyEmail(t.Context(), env.Mailer.Last(t, in.Email).Token()); err != nil {
			t.Fatalf("VerifyEmail() error = %v", err)
		}
	})
}

func TestRequestEmailVerification(t *testing.T) {
	env := authtest.New(t)
	u, _, in := env.Register(t)

	if err := env.Service.RequestEmailVerification(t.Context(), u.ID, ""); err != nil {
		t.Fatal(err)
	}
	if got := len(env.Mailer.Sent(in.Email)); got != 2 {
		t.Fatalf("mails = %d, want 2 (register + resend)", got)
	}
	if err := env.Service.VerifyEmail(t.Context(), env.Mailer.Last(t, in.Email).Token()); err != nil {
		t.Fatal(err)
	}

	// 確認済みなら何も送らない。
	if err := env.Service.RequestEmailVerification(t.Context(), u.ID, ""); err != nil {
		t.Fatal(err)
	}
	if got := len(env.Mailer.Sent(in.Email)); got != 2 {
		t.Fatalf("mails = %d, want no mail for a verified user", got)
	}
	if err := env.Service.RequestEmailVerification(t.Context(), env.IDs.New(), ""); !errors.Is(err, auth.ErrUserNotFound) {
		t.Fatalf("RequestEmailVerification(unknown) error = %v", err)
	}
}

// 同じリンクを同時に開いても、成功するのは 1 回だけ。
func TestVerifyEmailConcurrentConsume(t *testing.T) {
	env := authtest.New(t)
	_, _, in := env.Register(t)
	token := env.Mailer.Last(t, in.Email).Token()

	const n = 20
	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		successes int
	)
	for range n {
		wg.Go(func() {
			err := env.Service.VerifyEmail(t.Context(), token)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				successes++
			case !errors.Is(err, auth.ErrInvalidOneTimeToken):
				t.Errorf("VerifyEmail() unexpected error = %v", err)
			}
		})
	}
	wg.Wait()
	if successes != 1 {
		t.Fatalf("successes = %d, want 1", successes)
	}
}

func TestPasswordReset(t *testing.T) {
	env := authtest.New(t)
	u, mine, in := env.Register(t)
	_, other, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{})
	if err != nil {
		t.Fatal(err)
	}

	if err := env.Service.RequestPasswordReset(t.Context(), strings.ToUpper(in.Email), auth.Client{}); err != nil {
		t.Fatalf("RequestPasswordReset() error = %v", err)
	}
	mail := env.Mailer.Last(t, in.Email)
	if mail.Kind != "password_reset" || !strings.HasPrefix(mail.Link, authtest.AppBaseURL+"/reset-password?token=") {
		t.Fatalf("mail = %+v", mail)
	}

	// 制約を満たさないパスワードではトークンを消費しない。
	var verr *auth.ValidationError
	if err := env.Service.ResetPassword(t.Context(), mail.Token(), "short"); !errors.As(err, &verr) {
		t.Fatalf("ResetPassword(short) error = %v, want *ValidationError", err)
	}

	const newPassword = "a brand new passphrase"
	if err := env.Service.ResetPassword(t.Context(), mail.Token(), newPassword); err != nil {
		t.Fatalf("ResetPassword() error = %v", err)
	}

	// 古いパスワードではログインできず、新しいパスワードでできる。
	if _, _, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{}); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Errorf("Login(old password) error = %v", err)
	}
	if _, _, err := env.Service.Login(t.Context(), in.Email, newPassword, auth.Client{}); err != nil {
		t.Errorf("Login(new password) error = %v", err)
	}
	// リセットのリンクが届いたので、email も確認済みになる。
	if got, _ := env.Service.Me(t.Context(), u.ID); !got.EmailVerified {
		t.Error("email is not verified after password reset")
	}

	// リセット前のセッションはすべて失効し、ユーザー単位の失効が通知される。
	for name, s := range map[string]auth.Session{"mine": mine, "other": other} {
		if _, err := env.Service.Refresh(t.Context(), s.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
			t.Errorf("Refresh(%s) after reset error = %v, want ErrInvalidRefreshToken", name, err)
		}
		if got := revokedReasons(t, env, s.ID); !equalStrings(got, []string{"password_reset"}) {
			t.Errorf("reasons of %s = %v, want [password_reset]", name, got)
		}
	}
	if got := env.Revocations.Users(); len(got) != 1 || got[0] != u.ID {
		t.Errorf("revoked users = %v, want [%s]", got, u.ID)
	}
	// password_reset で失効した family は再利用の検知の対象にならない。
	if got := env.Revocations.Sessions(); len(got) != 0 {
		t.Errorf("revoked sessions = %v, want none", got)
	}

	// 同じリンクは 2 回使えない。
	if err := env.Service.ResetPassword(t.Context(), mail.Token(), "yet another passphrase"); !errors.Is(err, auth.ErrInvalidOneTimeToken) {
		t.Fatalf("second ResetPassword() error = %v, want ErrInvalidOneTimeToken", err)
	}
}

func TestPasswordResetRequestDoesNotRevealAccount(t *testing.T) {
	env := authtest.New(t)
	_, _, in := env.Register(t)
	unknown := "nobody-" + in.Email

	if err := env.Service.RequestPasswordReset(t.Context(), unknown, auth.Client{}); err != nil {
		t.Fatalf("RequestPasswordReset(unknown) error = %v, want nil", err)
	}
	if got := env.Mailer.Sent(unknown); len(got) != 0 {
		t.Fatalf("mail was sent to an unknown address: %v", got)
	}
	// 送信に失敗しても、エラーにしない（失敗がアカウントの存在を明かすため）。
	env.Mailer.SetErr(errors.New("smtp down"))
	if err := env.Service.RequestPasswordReset(t.Context(), in.Email, auth.Client{}); err != nil {
		t.Fatalf("RequestPasswordReset() with failing mailer error = %v, want nil", err)
	}
}

func TestPasswordResetTokenLifetime(t *testing.T) {
	env := authtest.New(t)
	_, _, in := env.Register(t)

	request := func() string {
		t.Helper()
		if err := env.Service.RequestPasswordReset(t.Context(), in.Email, auth.Client{}); err != nil {
			t.Fatal(err)
		}
		return env.Mailer.Last(t, in.Email).Token()
	}

	// 1 時間で期限切れ。
	expired := request()
	env.Clock.Advance(time.Hour)
	if err := env.Service.ResetPassword(t.Context(), expired, "a brand new passphrase"); !errors.Is(err, auth.ErrInvalidOneTimeToken) {
		t.Fatalf("ResetPassword(expired) error = %v", err)
	}

	// 新しいリンクを要求すると、前のリンクは使えない。
	older := request()
	newer := request()
	if err := env.Service.ResetPassword(t.Context(), older, "a brand new passphrase"); !errors.Is(err, auth.ErrInvalidOneTimeToken) {
		t.Fatalf("ResetPassword(older) error = %v", err)
	}
	if err := env.Service.ResetPassword(t.Context(), newer, "a brand new passphrase"); err != nil {
		t.Fatalf("ResetPassword(newer) error = %v", err)
	}
}

// TestEmailVerificationLinkCarriesNext は、確認メールのリンクに戻り先を載せることを確かめる（ADR 0053 決定 3）。
// 別の端末でメールを開いても招待の画面へ戻れるように、ブラウザではなくリンクに持たせる。
func TestEmailVerificationLinkCarriesNext(t *testing.T) {
	const next = "/invite/abc?from=mail"

	t.Run("register", func(t *testing.T) {
		env := authtest.New(t)
		in := env.NewRegisterInput()
		in.Next = next
		if _, _, err := env.Service.Register(t.Context(), in, auth.Client{}); err != nil {
			t.Fatal(err)
		}
		if got := nextOf(t, env.Mailer.Last(t, in.Email)); got != next {
			t.Fatalf("next in link = %q, want %q", got, next)
		}
	})

	t.Run("resend", func(t *testing.T) {
		env := authtest.New(t)
		u, _, in := env.Register(t)
		if got := nextOf(t, env.Mailer.Last(t, in.Email)); got != "" {
			t.Fatalf("next in link without next = %q, want none", got)
		}
		if err := env.Service.RequestEmailVerification(t.Context(), u.ID, next); err != nil {
			t.Fatal(err)
		}
		mail := env.Mailer.Last(t, in.Email)
		if got := nextOf(t, mail); got != next {
			t.Fatalf("next in link = %q, want %q", got, next)
		}
		// 戻り先を載せても、トークンはそのまま読める。
		if err := env.Service.VerifyEmail(t.Context(), mail.Token()); err != nil {
			t.Fatalf("VerifyEmail() error = %v", err)
		}
	})

	t.Run("rejects a path outside the app", func(t *testing.T) {
		env := authtest.New(t)
		in := env.NewRegisterInput()
		in.Next = "//evil.example/"
		_, _, err := env.Service.Register(t.Context(), in, auth.Client{})
		var verr *auth.ValidationError
		if !errors.As(err, &verr) || len(verr.Fields) != 1 || verr.Fields[0].Field != "next" {
			t.Fatalf("Register() error = %v, want a validation error on next", err)
		}
		if sent := env.Mailer.Sent(in.Email); len(sent) != 0 {
			t.Fatalf("mails = %+v, want none", sent)
		}

		u, _, _ := env.Register(t)
		err = env.Service.RequestEmailVerification(t.Context(), u.ID, "https://evil.example/")
		if !errors.As(err, &verr) || verr.Fields[0].Field != "next" {
			t.Fatalf("RequestEmailVerification() error = %v, want a validation error on next", err)
		}
	})
}

func nextOf(t *testing.T, m authtest.Mail) string {
	t.Helper()
	u, err := url.Parse(m.Link)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("next")
}
