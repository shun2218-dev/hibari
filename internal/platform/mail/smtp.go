package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net"
	netmail "net/mail"
	"net/smtp"
	"net/textproto"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// SMTPConfig は SMTP の接続先と認証情報。
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	// Password は業者の API キーなど。設定ではファイルのパス（SMTP_PASSWORD_FILE）で受け取り、起動時に読んで入れる。
	Password string
	// From は送信元。表示名を付けてよい（例: `hibari <noreply@mail.example.com>`）。
	From *netmail.Address
	// ImplicitTLS は、接続した直後から TLS を話すか（RFC 8314 の submissions）。false なら STARTTLS で TLS に切り替える。
	// 設定では SMTP_PORT から決める（ImplicitTLSPort）。
	ImplicitTLS bool
	// TLSConfig はテストで自己署名の証明書を信頼させるためだけに差し替える。nil なら Host で証明書を検証する既定の設定。
	TLSConfig *tls.Config
}

// ImplicitTLSPort は、port が暗黙の TLS で話すポートかどうかを返す。それ以外のポートは STARTTLS を使う。
// 業者ごとの差はポート番号に出るので、TLS の方式の設定は別に設けない
// （Resend は 465 / 2465 が暗黙の TLS、25 / 587 / 2587 が STARTTLS）。
func ImplicitTLSPort(port int) bool {
	return port == 465 || port == 2465
}

// SMTP は SMTP で 1 通ずつ送る Sender。送信を待つので、リクエストの処理からは Queue を通して使う。
//
// TLS なしでは送らない。STARTTLS を広告しないサーバーには、認証情報も本文も渡さずに失敗する
// （途中の経路で STARTTLS の広告を消されると、平文にされてしまう攻撃があるため）。
type SMTP struct {
	cfg   SMTPConfig
	clock clock.Clock
	ids   id.Generator
}

// NewSMTP は SMTP を返す。時刻は Date ヘッダ、ID は Message-ID に使う。
func NewSMTP(cfg SMTPConfig, clk clock.Clock, ids id.Generator) (*SMTP, error) {
	if cfg.Host == "" || cfg.Port <= 0 || cfg.From == nil {
		return nil, errors.New("smtp: host, port and from are required")
	}
	return &SMTP{cfg: cfg, clock: clk, ids: ids}, nil
}

// Send は m を送る。ctx の取り消しと期限は、接続そのものに効かせる（net/smtp は context を受け取らないため）。
func (s *SMTP) Send(ctx context.Context, m Message) error {
	// 宛先は利用者が登録した文字列なので、ヘッダに入れる前に 1 つのアドレスとして解釈できることを確かめる。
	// 改行を含む値でヘッダを足される（ヘッダインジェクション）のもここで防ぐ。
	to, err := netmail.ParseAddress(m.To)
	if err != nil {
		return fmt.Errorf("smtp: invalid recipient: %w", err)
	}
	msg, err := s.build(to, m)
	if err != nil {
		return err
	}

	addr := net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port))
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp: dial %s: %w", addr, err)
	}
	// 期限を過ぎたり取り消されたりしたら、接続を閉じて読み書きを止める。
	// 下の暗黙の TLS で conn を包み直すので、閉じるのは元の接続にする（変数を後から書き換えるのと競合しないように）。
	raw := conn
	stop := context.AfterFunc(ctx, func() { _ = raw.Close() })
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	tlsConfig := s.tlsConfig()
	if s.cfg.ImplicitTLS {
		conn = tls.Client(conn, tlsConfig)
	}
	c, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		_ = conn.Close()
		return s.wrap(ctx, "greeting", err)
	}
	defer func() { _ = c.Close() }()

	if !s.cfg.ImplicitTLS {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("smtp: server does not offer STARTTLS; refusing to send in plaintext")
		}
		if err := c.StartTLS(tlsConfig); err != nil {
			return s.wrap(ctx, "starttls", err)
		}
	}
	if s.cfg.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)); err != nil {
			return s.wrap(ctx, "auth", err)
		}
	}
	if err := c.Mail(s.cfg.From.Address); err != nil {
		return s.wrap(ctx, "mail from", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return s.wrap(ctx, "rcpt to", err)
	}
	w, err := c.Data()
	if err != nil {
		return s.wrap(ctx, "data", err)
	}
	if _, err := w.Write(msg); err != nil {
		return s.wrap(ctx, "write body", err)
	}
	if err := w.Close(); err != nil {
		return s.wrap(ctx, "end data", err)
	}
	// QUIT の応答が返らなくても、DATA が受け付けられた時点でメールは渡っている。失敗にすると再試行で二重に送る。
	_ = c.Quit()
	return nil
}

func (s *SMTP) tlsConfig() *tls.Config {
	if s.cfg.TLSConfig != nil {
		return s.cfg.TLSConfig.Clone()
	}
	return &tls.Config{ServerName: s.cfg.Host, MinVersion: tls.VersionTLS12}
}

// wrap は SMTP のやりとりの失敗に段階の名前を付ける。ctx の取り消しで接続を閉じたときは、閉じた接続のエラーではなく取り消しの理由を返す。
func (s *SMTP) wrap(ctx context.Context, stage string, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return fmt.Errorf("smtp: %s: %w", stage, ctxErr)
	}
	// 接続には ctx と同じ期限を付けているので、読み書きのタイムアウトが ctx のタイマーより一瞬早く起きることがある。
	// そのときはまだ ctx.Err() が nil なので、ctx の期限によるものとして DeadlineExceeded を返す（呼び出し側が理由を見分けられるように）。
	if _, ok := ctx.Deadline(); ok && errors.Is(err, os.ErrDeadlineExceeded) {
		return fmt.Errorf("smtp: %s: %w", stage, errors.Join(context.DeadlineExceeded, err))
	}
	return fmt.Errorf("smtp: %s: %w", stage, err)
}

// build はヘッダと本文を組み立てる。
//
// 件名と本文は日本語なので、件名は RFC 2047 の B エンコード、本文は base64 にする。
// 8BITMIME に対応しないサーバーを通っても化けないように、7bit の範囲だけで書く。
func (s *SMTP) build(to *netmail.Address, m Message) ([]byte, error) {
	if strings.ContainsAny(m.Subject, "\r\n") {
		return nil, errors.New("smtp: subject must not contain line breaks")
	}
	var b bytes.Buffer
	header := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	header("From", s.cfg.From.String())
	header("To", to.String())
	header("Subject", mime.BEncoding.Encode("UTF-8", m.Subject))
	header("Date", s.clock.Now().Format(time.RFC1123Z))
	header("Message-ID", "<"+s.ids.New().String()+"@"+domainOf(s.cfg.From.Address)+">")
	header("MIME-Version", "1.0")
	header("Content-Type", `text/plain; charset="UTF-8"`)
	header("Content-Transfer-Encoding", "base64")
	b.WriteString("\r\n")

	// base64 の行は 76 文字で折る（RFC 2045）。
	body := strings.ReplaceAll(m.Body, "\r\n", "\n")
	body = strings.ReplaceAll(body, "\n", "\r\n")
	enc := base64.StdEncoding.EncodeToString([]byte(body))
	for len(enc) > 76 {
		b.WriteString(enc[:76] + "\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc + "\r\n")
	return b.Bytes(), nil
}

func domainOf(addr string) string {
	if i := strings.LastIndexByte(addr, '@'); i >= 0 {
		return addr[i+1:]
	}
	return "localhost"
}

// Permanent は err が、送り直しても成功しない失敗（SMTP の 5xx の応答）かどうかを返す。
// 4xx（一時的な失敗）と接続の失敗は、時間をおけば通りうるので false。
func Permanent(err error) bool {
	var tpErr *textproto.Error
	return errors.As(err, &tpErr) && tpErr.Code >= 500 && tpErr.Code < 600
}
