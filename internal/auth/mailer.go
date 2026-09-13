package auth

import (
	"context"
	"log/slog"
)

// Mailer は認証のメールを送る。
//
// 本番の実装（SMTP や送信 API）は、送信を待たずにキューに積んで戻ること。
// パスワードリセットの要求では、アカウントが存在するときだけメールを送るので、
// 送信を同期で待つと応答時間の差でアカウントの有無が分かってしまう（ADR 0010 追記）。
type Mailer interface {
	// SendEmailVerification は email の確認リンクを送る。
	SendEmailVerification(ctx context.Context, to, link string) error
	// SendPasswordReset はパスワードの再設定リンクを送る。
	SendPasswordReset(ctx context.Context, to, link string) error
}

// LogMailer は開発用の Mailer。メールを送らず、宛先とリンクをログに出す。
//
// リンクにはワンタイムトークンが含まれる。トークンをログに出してよいのは、この開発用の実装だけ（CLAUDE.md「ログ」）。
type LogMailer struct {
	Logger *slog.Logger
}

func (m LogMailer) SendEmailVerification(ctx context.Context, to, link string) error {
	m.Logger.InfoContext(ctx, "dev mailer: email verification", slog.String("to", to), slog.String("link", link))
	return nil
}

func (m LogMailer) SendPasswordReset(ctx context.Context, to, link string) error {
	m.Logger.InfoContext(ctx, "dev mailer: password reset", slog.String("to", to), slog.String("link", link))
	return nil
}
