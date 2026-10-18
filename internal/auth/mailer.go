package auth

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/mail"
)

// Mailer は認証のメールを送る。
//
// 本番の実装（NewMailer）は、送信を待たずにキュー（mail.Queue）に積んで戻ること。
// パスワードリセットの要求では、アカウントが存在するときだけメールを送るので、
// 送信を同期で待つと応答時間の差でアカウントの有無が分かってしまう（ADR 0010 追記、ADR 0053 決定 6）。
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

// NewMailer は、文面を組み立てて sender に渡す Mailer を返す。本番では sender に mail.Queue を渡す。
//
// 文面は auth が持ち、届ける方法（SMTP・キュー）は platform/mail が持つ。業者を替えても文面は変わらない。
func NewMailer(sender mail.Sender) Mailer {
	return textMailer{sender: sender}
}

type textMailer struct {
	sender mail.Sender
}

func (m textMailer) SendEmailVerification(ctx context.Context, to, link string) error {
	return m.send(ctx, mail.Message{
		To:      to,
		Subject: "hibari: メールアドレスの確認",
		Body: "hibari にご登録いただきありがとうございます。\n" +
			"次のリンクを開いて、メールアドレスの確認を済ませてください。確認が済むとチャットを使えるようになります。\n\n" +
			link + "\n\n" +
			"リンクの有効期限は" + durationJa(EmailVerificationTTL) + "です。期限が切れたら、アプリの画面から確認メールを送り直せます。\n" +
			"このメールに心当たりがない場合は、破棄してください。\n",
		Kind: "email_verification",
	})
}

func (m textMailer) SendPasswordReset(ctx context.Context, to, link string) error {
	return m.send(ctx, mail.Message{
		To:      to,
		Subject: "hibari: パスワードの再設定",
		Body: "hibari のパスワードの再設定を受け付けました。\n" +
			"次のリンクを開いて、新しいパスワードを設定してください。\n\n" +
			link + "\n\n" +
			"リンクの有効期限は" + durationJa(PasswordResetTTL) + "で、1 回だけ使えます。\n" +
			"再設定を申し込んでいない場合は、このメールを破棄してください。パスワードは変わりません。\n",
		Kind: "password_reset",
	})
}

func (m textMailer) send(ctx context.Context, msg mail.Message) error {
	if err := m.sender.Send(ctx, msg); err != nil {
		return fmt.Errorf("send %s: %w", msg.Kind, err)
	}
	return nil
}

// durationJa は有効期限を文面の言葉にする（24 時間・1 時間・15 分）。
func durationJa(d time.Duration) string {
	if d >= time.Hour && d%time.Hour == 0 {
		return fmt.Sprintf(" %d 時間", int(d/time.Hour))
	}
	return fmt.Sprintf(" %d 分", int(d/time.Minute))
}
