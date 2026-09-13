package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/auth/authtest"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
)

// expectRateLimited は err が回数制限のエラーであることを確かめ、RetryAfter を返す。
func expectRateLimited(t *testing.T, err error) time.Duration {
	t.Helper()
	var rl *auth.RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("error = %v, want *RateLimitedError", err)
	}
	return rl.RetryAfter
}

// newLimitedEnv は 1 つのルールだけを limit 回に絞った Env を返す。ルール名は実行ごとに一意にする。
func newLimitedEnv(t *testing.T, limit int, set func(l *auth.RateLimits, r ratelimit.Rule)) *authtest.Env {
	t.Helper()
	limits := authtest.GenerousRateLimits
	set(&limits, ratelimit.Rule{Name: authtest.RuleName("test"), Limit: limit, Window: 15 * time.Minute})
	return authtest.New(t, authtest.WithRateLimits(limits))
}

func TestLoginRateLimitPerAccount(t *testing.T) {
	env := newLimitedEnv(t, 3, func(l *auth.RateLimits, r ratelimit.Rule) { l.LoginPerAccount = r })
	_, _, in := env.Register(t)
	unknown := "nobody-" + in.Email

	for _, email := range []string{in.Email, unknown} {
		for i := range 3 {
			if _, _, err := env.Service.Login(t.Context(), email, "wrong password", auth.Client{}); !errors.Is(err, auth.ErrInvalidCredentials) {
				t.Fatalf("%s attempt %d: error = %v, want ErrInvalidCredentials", email, i+1, err)
			}
		}
		// 存在するアカウントにも存在しない email にも、同じように制限がかかる。
		expectRateLimited(t, func() error {
			_, _, err := env.Service.Login(t.Context(), email, "wrong password", auth.Client{})
			return err
		}())
	}

	// 大文字小文字だけを変えても、同じアカウントとして数える。正しいパスワードでも止める。
	_, _, err := env.Service.Login(t.Context(), "  "+strings.ToUpper(in.Email), in.Password, auth.Client{})
	expectRateLimited(t, err)

	// ウィンドウが変われば通る。
	env.Clock.Advance(15 * time.Minute)
	if _, _, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{}); err != nil {
		t.Fatalf("Login() in the next window error = %v", err)
	}
}

func TestLoginRateLimitPerIP(t *testing.T) {
	env := newLimitedEnv(t, 2, func(l *auth.RateLimits, r ratelimit.Rule) { l.LoginPerIP = r })
	_, _, in := env.Register(t)
	attacker := auth.Client{IP: env.NewIP()}

	for range 2 {
		_, _, _ = env.Service.Login(t.Context(), "someone-"+env.IDs.New().String()+"@example.com", "x", attacker)
	}
	_, _, err := env.Service.Login(t.Context(), in.Email, in.Password, attacker)
	// Clock は 12:00 ちょうどなので、15 分のウィンドウの終わりまで 15 分。
	if got := expectRateLimited(t, err); got != 15*time.Minute {
		t.Errorf("RetryAfter = %v, want 15m", got)
	}
	// 別の IP からは通る。
	if _, _, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{IP: env.NewIP()}); err != nil {
		t.Fatalf("Login() from another IP error = %v", err)
	}
}

func TestRegisterRateLimitPerIP(t *testing.T) {
	env := newLimitedEnv(t, 1, func(l *auth.RateLimits, r ratelimit.Rule) { l.RegisterPerIP = r })
	client := auth.Client{IP: env.NewIP()}
	if _, _, err := env.Service.Register(t.Context(), env.NewRegisterInput(), client); err != nil {
		t.Fatal(err)
	}
	_, _, err := env.Service.Register(t.Context(), env.NewRegisterInput(), client)
	expectRateLimited(t, err)
}

func TestPasswordResetRateLimitPerAccount(t *testing.T) {
	env := newLimitedEnv(t, 2, func(l *auth.RateLimits, r ratelimit.Rule) { l.PasswordResetPerAccount = r })
	_, _, in := env.Register(t)

	for range 2 {
		if err := env.Service.RequestPasswordReset(t.Context(), in.Email, auth.Client{}); err != nil {
			t.Fatal(err)
		}
	}
	expectRateLimited(t, env.Service.RequestPasswordReset(t.Context(), in.Email, auth.Client{}))
	if got := len(env.Mailer.Sent(in.Email)); got != 3 {
		t.Fatalf("mails = %d, want 3 (register + 2 resets)", got)
	}
}

func TestEmailVerificationRateLimitPerUser(t *testing.T) {
	env := newLimitedEnv(t, 1, func(l *auth.RateLimits, r ratelimit.Rule) { l.EmailVerificationPerUser = r })
	u, _, _ := env.Register(t)
	if err := env.Service.RequestEmailVerification(t.Context(), u.ID); err != nil {
		t.Fatal(err)
	}
	expectRateLimited(t, env.Service.RequestEmailVerification(t.Context(), u.ID))
}

type failingLimiter struct{}

func (failingLimiter) Allow(context.Context, ratelimit.Rule, string) (ratelimit.Decision, error) {
	return ratelimit.Decision{}, errors.New("redis: connection refused")
}

// Redis に問い合わせられなくても、ログインは止めない（fail-open）。
func TestRateLimiterFailureAllowsRequests(t *testing.T) {
	env := authtest.New(t, authtest.WithRateLimiter(failingLimiter{}))
	_, _, in := env.Register(t)
	if _, _, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{IP: env.NewIP()}); err != nil {
		t.Fatalf("Login() error = %v, want success when the limiter is down", err)
	}
}
