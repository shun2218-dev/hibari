package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth/store"
)

// ワンタイムトークンの有効期限。
const (
	// EmailVerificationTTL は確認リンクの有効期限。メールを後で開く人もいるので長めにする。
	EmailVerificationTTL = 24 * time.Hour
	// PasswordResetTTL は再設定リンクの有効期限。アカウントを乗っ取れるリンクなので短くする。
	// 画面の文言（docs/ui の「1 時間」）と揃える。
	PasswordResetTTL = time.Hour
)

// one_time_tokens.purpose の値。
const (
	purposeEmailVerify   = "email_verify"
	purposePasswordReset = "password_reset"
)

// revokedPasswordReset は refresh_tokens.revoked_reason の値。
const revokedPasswordReset = "password_reset"

// ErrInvalidOneTimeToken は確認・再設定のトークンが存在しない・期限切れ・使用済みであることを表す。
// どれに当たるかは区別しない（画面はどれも「リンクが無効です。もう一度やり直してください」）。
var ErrInvalidOneTimeToken = errors.New("auth: invalid or expired one-time token")

// RequestEmailVerification は userID の email に確認メールを送り直す。確認済みなら何もしない。
// next は検証のあとに Web が進む先（アプリの中のパス。空なら載せない。ADR 0053 決定 3）。
func (s *Service) RequestEmailVerification(ctx context.Context, userID ulid.ULID, next string) error {
	if reason := nextPathProblem(next); reason != "" {
		return &ValidationError{Fields: []FieldError{{Field: "next", Reason: reason}}}
	}
	u, err := store.New(s.db).GetActiveUserByID(ctx, userID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ErrUserNotFound
	case err != nil:
		return fmt.Errorf("get user: %w", err)
	}
	if u.EmailVerifiedAt != nil {
		return nil
	}
	if err := s.checkRateLimits(ctx, limitKey{s.limits.EmailVerificationPerUser, u.ID.String()}); err != nil {
		return err
	}
	return s.sendEmailVerification(ctx, u.ID, u.Email, next)
}

// sendEmailVerification は確認メールを送る。next は検証してから進む先で、確認のリンクに載せる。
//
// 戻り先をブラウザに覚えさせずリンクに載せるのは、メールを別の端末で開いても戻れるようにするため（ADR 0053 決定 3）。
// next は呼び出し側で検証済みのものだけを渡す。
func (s *Service) sendEmailVerification(ctx context.Context, userID ulid.ULID, email, next string) error {
	raw, err := s.issueOneTimeToken(ctx, userID, purposeEmailVerify, EmailVerificationTTL)
	if err != nil {
		return err
	}
	link := s.link("/verify-email", raw)
	if next != "" {
		link += "&next=" + url.QueryEscape(next)
	}
	if err := s.mailer.SendEmailVerification(ctx, email, link); err != nil {
		return fmt.Errorf("send email verification: %w", err)
	}
	return nil
}

// VerifyEmail はトークンを使用済みにして、持ち主の email を確認済みにする。
func (s *Service) VerifyEmail(ctx context.Context, rawToken string) error {
	now := s.clock.Now()
	return s.inTx(ctx, func(q *store.Queries) error {
		userID, err := s.consumeOneTimeToken(ctx, q, rawToken, purposeEmailVerify, now)
		if err != nil {
			return err
		}
		n, err := q.MarkEmailVerified(ctx, store.MarkEmailVerifiedParams{ID: userID, Now: now})
		if err != nil {
			return fmt.Errorf("mark email verified: %w", err)
		}
		if n == 0 {
			// トークンの発行後に退会した。トークンの消費もロールバックされる。
			return ErrInvalidOneTimeToken
		}
		return nil
	})
}

// RequestPasswordReset は email のアカウントに再設定メールを送る。
//
// アカウントが存在しなくても、存在する場合と同じく成功を返す（CLAUDE.md「エラーハンドリング」）。
// 回数制限もアカウントの有無に関係なく同じように数える。
func (s *Service) RequestPasswordReset(ctx context.Context, email string, c Client) error {
	email = strings.TrimSpace(email)
	if err := s.checkRateLimits(ctx,
		limitKey{s.limits.PasswordResetPerIP, c.ipKey()},
		limitKey{s.limits.PasswordResetPerAccount, accountKey(email)},
	); err != nil {
		return err
	}
	if email == "" {
		return nil
	}

	u, err := store.New(s.db).GetActiveUserByEmail(ctx, email)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("get user: %w", err)
	}

	raw, err := s.issueOneTimeToken(ctx, u.ID, purposePasswordReset, PasswordResetTTL)
	if err != nil {
		return err
	}
	// 送信の失敗をクライアントに返すと、失敗したこと自体がアカウントの存在を明かすので、ログにだけ残す。
	if err := s.mailer.SendPasswordReset(ctx, u.Email, s.link("/reset-password", raw)); err != nil {
		s.logger.ErrorContext(ctx, "send password reset failed",
			slog.String("user_id", u.ID.String()), slog.Any("error", err))
	}
	return nil
}

// ResetPassword はトークンを使用済みにしてパスワードを変え、そのユーザーの全セッションを失効させる。
//
// パスワードを変える理由の多くは「漏れたかもしれない」なので、他の端末に残ったセッションも締め出す。
func (s *Service) ResetPassword(ctx context.Context, rawToken, newPassword string) error {
	// パスワードが制約を満たさないときは、トークンを消費せずに返す（入力し直して同じリンクで再試行できるように）。
	if reason := passwordProblem(newPassword); reason != "" {
		return &ValidationError{Fields: []FieldError{{Field: "password", Reason: reason}}}
	}
	hash, err := s.passwords.Hash(newPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	now := s.clock.Now()
	var userID ulid.ULID
	err = s.inTx(ctx, func(q *store.Queries) error {
		consumedBy, err := s.consumeOneTimeToken(ctx, q, rawToken, purposePasswordReset, now)
		if err != nil {
			return err
		}
		userID = consumedBy
		n, err := q.UpdatePasswordFromReset(ctx, store.UpdatePasswordFromResetParams{ID: userID, PasswordHash: &hash, Now: now})
		if err != nil {
			return fmt.Errorf("update password: %w", err)
		}
		if n == 0 {
			return ErrInvalidOneTimeToken
		}
		// 同時に発行されていた他のリセットのリンクも使えなくする。
		if err := q.DeleteUnconsumedOneTimeTokens(ctx, store.DeleteUnconsumedOneTimeTokensParams{UserID: userID, Purpose: purposePasswordReset}); err != nil {
			return fmt.Errorf("delete other reset tokens: %w", err)
		}
		if _, err := q.RevokeAllRefreshTokensForUser(ctx, store.RevokeAllRefreshTokensForUserParams{UserID: userID, Reason: revokedPasswordReset, Now: now}); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}

	// Refresh Token が 1 つもなくても通知する。WS の接続は Access Token（ws-ticket）から張られうるので、DB の行の有無では判断しない。
	if err := s.revocations.RevokeAllSessions(context.WithoutCancel(ctx), userID); err != nil {
		s.logger.ErrorContext(ctx, "publish user revocation failed",
			slog.String("user_id", userID.String()), slog.Any("error", err))
	}
	return nil
}

// issueOneTimeToken は、同じ用途の未使用のトークンを消してから新しいトークンを保存し、生の値を返す。
func (s *Service) issueOneTimeToken(ctx context.Context, userID ulid.ULID, purpose string, ttl time.Duration) (string, error) {
	raw, hash, err := newOpaqueToken(s.random)
	if err != nil {
		return "", err
	}
	now := s.clock.Now()
	err = s.inTx(ctx, func(q *store.Queries) error {
		if err := q.DeleteUnconsumedOneTimeTokens(ctx, store.DeleteUnconsumedOneTimeTokensParams{UserID: userID, Purpose: purpose}); err != nil {
			return fmt.Errorf("delete old tokens: %w", err)
		}
		if err := q.CreateOneTimeToken(ctx, store.CreateOneTimeTokenParams{
			ID:        s.ids.New(),
			UserID:    userID,
			Purpose:   purpose,
			TokenHash: hash,
			ExpiresAt: now.Add(ttl),
			Now:       now,
		}); err != nil {
			return fmt.Errorf("create one-time token: %w", err)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return raw, nil
}

func (s *Service) consumeOneTimeToken(ctx context.Context, q *store.Queries, rawToken, purpose string, now time.Time) (ulid.ULID, error) {
	if rawToken == "" {
		return ulid.ULID{}, ErrInvalidOneTimeToken
	}
	userID, err := q.ConsumeOneTimeToken(ctx, store.ConsumeOneTimeTokenParams{
		TokenHash: hashOpaqueToken(rawToken),
		Purpose:   purpose,
		Now:       now,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ulid.ULID{}, ErrInvalidOneTimeToken
	case err != nil:
		return ulid.ULID{}, fmt.Errorf("consume one-time token: %w", err)
	}
	return userID, nil
}

// link はメールに載せる Web クライアントの URL を作る。
//
// トークンはクエリ文字列に載る。URL に載せてよいのは短命・使い捨てのトークンだけで、これはそれに当たる
// （Access / Refresh Token は載せない。CLAUDE.md）。受け取ったページは Referer で漏らさないようにする（Phase 6）。
func (s *Service) link(path, rawToken string) string {
	u := s.appBaseURL.JoinPath(path)
	u.RawQuery = "token=" + rawToken // base64url なのでエスケープは要らない
	return u.String()
}

// inTx は fn をトランザクションの中で実行し、エラーならロールバック、成功ならコミットする。
func (s *Service) inTx(ctx context.Context, fn func(q *store.Queries) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer rollback(ctx, tx)
	if err := fn(store.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
