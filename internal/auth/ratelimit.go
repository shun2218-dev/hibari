package auth

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
)

// RateLimiter は回数制限の判定（ratelimit.Limiter が実装する）。
type RateLimiter interface {
	Allow(ctx context.Context, rule ratelimit.Rule, key string) (ratelimit.Decision, error)
}

// RateLimits は認証のエンドポイントごとの回数制限。
type RateLimits struct {
	// LoginPerIP は同じ IP からのログインの試行。NAT の内側の複数人を巻き込まないよう、アカウント単位より緩くする。
	LoginPerIP ratelimit.Rule
	// LoginPerAccount は同じ email へのログインの試行。攻撃者が IP を変えても、1 つのアカウントへの総当たりを抑える。
	// アカウントが存在しない email にも同じように数える（制限のかかり方でアカウントの有無が分からないように）。
	LoginPerAccount ratelimit.Rule
	// RegisterPerIP は同じ IP からの登録。登録は email の重複を明かすので、列挙のコストを上げる（ADR 0010）。
	RegisterPerIP ratelimit.Rule
	// PasswordResetPerIP / PasswordResetPerAccount はリセットメールの要求。メールの大量送信の踏み台にさせない。
	PasswordResetPerIP      ratelimit.Rule
	PasswordResetPerAccount ratelimit.Rule
	// EmailVerificationPerUser は確認メールの再送。
	EmailVerificationPerUser ratelimit.Rule
}

// DefaultRateLimits は本番の回数制限。
var DefaultRateLimits = RateLimits{
	LoginPerIP:               ratelimit.Rule{Name: "login-ip", Limit: 50, Window: 15 * time.Minute},
	LoginPerAccount:          ratelimit.Rule{Name: "login-account", Limit: 10, Window: 15 * time.Minute},
	RegisterPerIP:            ratelimit.Rule{Name: "register-ip", Limit: 10, Window: time.Hour},
	PasswordResetPerIP:       ratelimit.Rule{Name: "password-reset-ip", Limit: 10, Window: time.Hour},
	PasswordResetPerAccount:  ratelimit.Rule{Name: "password-reset-account", Limit: 3, Window: time.Hour},
	EmailVerificationPerUser: ratelimit.Rule{Name: "email-verification-user", Limit: 5, Window: time.Hour},
}

// RateLimitedError は回数制限を超えたことを表す。
type RateLimitedError struct {
	RetryAfter time.Duration
}

func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("auth: rate limited (retry after %s)", e.RetryAfter)
}

// limitKey は 1 つのルールと、その対象のキー。キーが空（IP が分からないなど）のルールは数えない。
type limitKey struct {
	rule ratelimit.Rule
	key  string
}

// checkRateLimits はすべてのルールを数え、1 つでも超えていれば RateLimitedError を返す。
//
// Redis に問い合わせられないときは制限せずに通す（fail-open）。
// 回数制限は多層防御の 1 つで、Argon2id によって総当たりはもともと遅い。
// Redis の障害をログインの障害にしない方を選ぶ（ADR 0010 追記）。
func (s *Service) checkRateLimits(ctx context.Context, keys ...limitKey) error {
	var denied *RateLimitedError
	for _, k := range keys {
		if k.key == "" {
			continue
		}
		d, err := s.limiter.Allow(ctx, k.rule, k.key)
		if err != nil {
			s.logger.ErrorContext(ctx, "rate limiter unavailable; allowing request",
				slog.String("rule", k.rule.Name), slog.Any("error", err))
			continue
		}
		// 1 つ目で拒否されても残りのルールも数え、Retry-After は最も長いものを返す。
		// どのルールで止まったか（IP か、アカウントか）はクライアントに区別させない。
		if !d.Allowed && (denied == nil || d.RetryAfter > denied.RetryAfter) {
			denied = &RateLimitedError{RetryAfter: d.RetryAfter}
		}
	}
	if denied != nil {
		return denied
	}
	return nil
}
