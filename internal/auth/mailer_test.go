package auth_test

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/auth/authtest"
	"github.com/shun2218-dev/hibari/internal/platform/mail"
)

// recordingSender は mail.Sender に渡されたメールを記録する。release を閉じるまで送信を止められる。
type recordingSender struct {
	mu      sync.Mutex
	sent    []mail.Message
	release chan struct{}
	err     error
}

func (s *recordingSender) Send(ctx context.Context, m mail.Message) error {
	if s.release != nil {
		select {
		case <-s.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.sent = append(s.sent, m)
	return nil
}

func (s *recordingSender) to(addr string) []mail.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []mail.Message
	for _, m := range s.sent {
		if m.To == addr {
			out = append(out, m)
		}
	}
	return out
}

func TestMailerText(t *testing.T) {
	const link = "https://app.example.com/x?token=abc"
	tests := []struct {
		name        string
		send        func(auth.Mailer) error
		wantKind    string
		wantSubject string
		wantBody    []string
	}{
		{
			name:        "email verification",
			send:        func(m auth.Mailer) error { return m.SendEmailVerification(t.Context(), "a@example.com", link) },
			wantKind:    "email_verification",
			wantSubject: "hibari: メールアドレスの確認",
			wantBody:    []string{link, "有効期限は 24 時間"},
		},
		{
			name:        "password reset",
			send:        func(m auth.Mailer) error { return m.SendPasswordReset(t.Context(), "a@example.com", link) },
			wantKind:    "password_reset",
			wantSubject: "hibari: パスワードの再設定",
			wantBody:    []string{link, "有効期限は 1 時間"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sender := &recordingSender{}
			if err := tt.send(auth.NewMailer(sender)); err != nil {
				t.Fatal(err)
			}
			got := sender.to("a@example.com")
			if len(got) != 1 {
				t.Fatalf("sent %d messages, want 1", len(got))
			}
			if got[0].Kind != tt.wantKind || got[0].Subject != tt.wantSubject {
				t.Errorf("kind, subject = %q, %q", got[0].Kind, got[0].Subject)
			}
			for _, w := range tt.wantBody {
				if !strings.Contains(got[0].Body, w) {
					t.Errorf("body does not contain %q:\n%s", w, got[0].Body)
				}
			}
		})
	}
}

// 積めなかった失敗は呼び出し側に返す（登録は成功させ、再設定はログにだけ残す。判断は Service）。
func TestMailerReturnsSenderError(t *testing.T) {
	m := auth.NewMailer(&recordingSender{err: mail.ErrQueueFull})
	if err := m.SendEmailVerification(t.Context(), "a@example.com", "l"); !errors.Is(err, mail.ErrQueueFull) {
		t.Fatalf("err = %v, want ErrQueueFull", err)
	}
}

// パスワードの再設定の要求は、登録のある人でもメールの送信を待たずに戻る（ADR 0053 決定 6）。
// 送信を待つと、登録のある人だけ応答が遅くなり、アカウントの有無が分かってしまう。
//
// 時間を測って比べると揺れるので、「送信が止まったままでも、どちらも戻る」ことで確かめる。
// 送信を同期で待つ実装なら、止まった送信を待ち続けて戻らない。
func TestPasswordResetDoesNotWaitForMail(t *testing.T) {
	sender := &recordingSender{release: make(chan struct{})}
	queue := mail.NewQueue(sender, mail.QueueOptions{Size: 16, Attempts: 1, DrainTimeout: 5 * time.Second}, slog.New(slog.DiscardHandler))
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		queue.Run(ctx)
	}()

	env := authtest.New(t, authtest.WithMailer(auth.NewMailer(queue)))
	_, _, in := env.Register(t) // 確認メールで、ワーカーは送信の途中で止まる
	unknown := "nobody-" + in.Email

	for _, email := range []string{in.Email, unknown} {
		returned := make(chan error, 1)
		go func() { returned <- env.Service.RequestPasswordReset(t.Context(), email, auth.Client{}) }()
		select {
		case err := <-returned:
			if err != nil {
				t.Fatalf("RequestPasswordReset(%q) = %v", email, err)
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("RequestPasswordReset(%q) waited for the mail to be sent", email)
		}
	}

	// 止めていた送信を再開し、止めてから数える（積まれた分は送り切ってから Run が戻る）。
	close(sender.release)
	cancel()
	<-done
	if got := sender.to(in.Email); len(got) != 2 || got[1].Kind != "password_reset" {
		t.Fatalf("mails to the registered address = %+v, want verification and reset", got)
	}
	if got := sender.to(unknown); len(got) != 0 {
		t.Fatalf("mail was sent to an unknown address: %+v", got)
	}
}
