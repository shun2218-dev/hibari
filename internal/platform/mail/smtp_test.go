package mail_test

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"mime"
	"net"
	netmail "net/mail"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/mail"
)

// fakeSMTPServer はテスト用の最小の SMTP サーバー。STARTTLS / 暗黙の TLS / AUTH PLAIN を話し、受け取ったメールを記録する。
type fakeSMTPServer struct {
	ln          net.Listener
	tlsConfig   *tls.Config
	implicitTLS bool
	// noStartTLS なら STARTTLS を広告しない（平文でしか話せないサーバー、または途中で広告を消された経路）。
	noStartTLS bool
	// rcptCode が 0 でなければ、RCPT TO にこのコードで応答する。
	rcptCode int

	mu       sync.Mutex
	received []receivedMail
	sawAuth  []string // AUTH PLAIN で受け取った "ユーザー名:パスワード"
	authTLS  []bool   // AUTH を受け取ったときに TLS だったか
	wg       sync.WaitGroup
}

type receivedMail struct {
	from, to string
	data     string
}

func newFakeSMTPServer(t *testing.T, implicitTLS bool) (*fakeSMTPServer, *tls.Config) {
	t.Helper()
	serverTLS, clientTLS := selfSignedTLS(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &fakeSMTPServer{ln: ln, tlsConfig: serverTLS, implicitTLS: implicitTLS}
	t.Cleanup(func() {
		_ = ln.Close()
		s.wg.Wait()
	})
	return s, clientTLS
}

func (s *fakeSMTPServer) start() {
	s.wg.Go(func() {
		for {
			conn, err := s.ln.Accept()
			if err != nil {
				return
			}
			s.wg.Go(func() { s.serve(conn) })
		}
	})
}

func (s *fakeSMTPServer) port() int { return s.ln.Addr().(*net.TCPAddr).Port }

func (s *fakeSMTPServer) serve(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	isTLS := false
	if s.implicitTLS {
		conn = tls.Server(conn, s.tlsConfig)
		isTLS = true
	}
	tp := textproto.NewConn(conn)
	reply := func(line string) { _ = tp.PrintfLine("%s", line) }
	reply("220 fake ESMTP")
	var from, to string
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		cmd, arg, _ := strings.Cut(line, " ")
		switch strings.ToUpper(cmd) {
		case "EHLO", "HELO":
			if !isTLS && !s.noStartTLS {
				reply("250-fake")
				reply("250-STARTTLS")
			} else {
				reply("250-fake")
			}
			reply("250 AUTH PLAIN")
		case "STARTTLS":
			reply("220 go ahead")
			tlsConn := tls.Server(conn, s.tlsConfig)
			if err := tlsConn.Handshake(); err != nil {
				return
			}
			conn, isTLS = tlsConn, true
			tp = textproto.NewConn(conn)
		case "AUTH":
			_, b64, _ := strings.Cut(arg, " ")
			raw, _ := base64.StdEncoding.DecodeString(b64)
			parts := strings.Split(string(raw), "\x00")
			s.mu.Lock()
			if len(parts) == 3 {
				s.sawAuth = append(s.sawAuth, parts[1]+":"+parts[2])
			}
			s.authTLS = append(s.authTLS, isTLS)
			s.mu.Unlock()
			reply("235 ok")
		case "MAIL":
			from = strings.Trim(strings.TrimPrefix(arg, "FROM:"), "<>")
			reply("250 ok")
		case "RCPT":
			if s.rcptCode != 0 {
				reply(strconv.Itoa(s.rcptCode) + " rejected")
				continue
			}
			to = strings.Trim(strings.TrimPrefix(arg, "TO:"), "<>")
			reply("250 ok")
		case "DATA":
			reply("354 go ahead")
			data, err := tp.ReadDotBytes()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.received = append(s.received, receivedMail{from: from, to: to, data: string(data)})
			s.mu.Unlock()
			reply("250 queued")
		case "QUIT":
			reply("221 bye")
			return
		default:
			reply("502 unknown")
		}
	}
}

func (s *fakeSMTPServer) snapshot() ([]receivedMail, []string, []bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]receivedMail(nil), s.received...), append([]string(nil), s.sawAuth...), append([]bool(nil), s.authTLS...)
}

// selfSignedTLS は 127.0.0.1 の自己署名の証明書で、サーバーの設定と、それを信頼するクライアントの設定を作る。
func selfSignedTLS(t *testing.T) (server, client *tls.Config) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "fake smtp"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		// 証明書の有効期間の判定は crypto/tls が実際の時刻で行うので、ここだけは Clock ではなく広めの固定の期間にする。
		NotBefore:   time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
		NotAfter:    time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC),
		KeyUsage:    x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	server = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}
	client = &tls.Config{RootCAs: pool, ServerName: "127.0.0.1", MinVersion: tls.VersionTLS12}
	return server, client
}

var fixedNow = time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)

func newSMTP(t *testing.T, port int, clientTLS *tls.Config) *mail.SMTP {
	t.Helper()
	return newSMTPWith(t, port, clientTLS, false)
}

func newSMTPWith(t *testing.T, port int, clientTLS *tls.Config, implicitTLS bool) *mail.SMTP {
	t.Helper()
	clk := clock.NewFake(fixedNow)
	from, err := netmail.ParseAddress("hibari <noreply@mail.example.com>")
	if err != nil {
		t.Fatal(err)
	}
	s, err := mail.NewSMTP(mail.SMTPConfig{
		Host:        "127.0.0.1",
		Port:        port,
		Username:    "resend",
		Password:    "re_secret",
		From:        from,
		ImplicitTLS: implicitTLS,
		TLSConfig:   clientTLS,
	}, clk, id.NewGenerator(clk, rand.Reader))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSMTPSendsOverSTARTTLS(t *testing.T) {
	srv, clientTLS := newFakeSMTPServer(t, false)
	srv.start()
	s := newSMTP(t, srv.port(), clientTLS)

	body := "hibari へのご登録ありがとうございます。\n次のリンクを開いてください。\n\nhttps://app.example.com/verify-email?token=abc\n"
	err := s.Send(t.Context(), mail.Message{To: "Alice <alice@example.com>", Subject: "メールアドレスの確認", Body: body, Kind: "test"})
	if err != nil {
		t.Fatalf("Send() = %v", err)
	}

	received, auths, authTLS := srv.snapshot()
	if len(received) != 1 {
		t.Fatalf("received %d mails, want 1", len(received))
	}
	got := received[0]
	if got.from != "noreply@mail.example.com" || got.to != "alice@example.com" {
		t.Errorf("envelope = %q -> %q", got.from, got.to)
	}
	// 認証情報は TLS に切り替えた後にだけ渡す。
	if len(auths) != 1 || auths[0] != "resend:re_secret" || !authTLS[0] {
		t.Errorf("auth = %v (tls %v), want resend:re_secret over TLS", auths, authTLS)
	}

	msg, err := netmail.ReadMessage(strings.NewReader(got.data))
	if err != nil {
		t.Fatalf("parse message: %v", err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if err != nil || subject != "メールアドレスの確認" {
		t.Errorf("Subject = %q (%v)", subject, err)
	}
	if d, err := msg.Header.Date(); err != nil || !d.Equal(fixedNow) {
		t.Errorf("Date = %v (%v), want the clock's time", d, err)
	}
	if mid := msg.Header.Get("Message-Id"); !strings.HasSuffix(mid, "@mail.example.com>") {
		t.Errorf("Message-ID = %q", mid)
	}
	if ct := msg.Header.Get("Content-Type"); !strings.Contains(ct, "UTF-8") {
		t.Errorf("Content-Type = %q", ct)
	}
	raw, _ := io.ReadAll(msg.Body)
	// テストのサーバーは textproto.ReadDotBytes で読むので、行の区切りは LF になっている。
	for line := range strings.SplitSeq(strings.TrimRight(string(raw), "\n"), "\n") {
		if len(line) > 76 {
			t.Errorf("body line is %d chars, want <= 76", len(line))
		}
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(string(raw), "\n", ""))
	if err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if want := strings.ReplaceAll(body, "\n", "\r\n"); string(decoded) != want {
		t.Errorf("body = %q, want %q", decoded, want)
	}
}

func TestSMTPSendsOverImplicitTLS(t *testing.T) {
	srv, clientTLS := newFakeSMTPServer(t, true)
	srv.start()
	s := newSMTPWith(t, srv.port(), clientTLS, true)

	if err := s.Send(t.Context(), mail.Message{To: "alice@example.com", Subject: "s", Body: "b", Kind: "test"}); err != nil {
		t.Fatalf("Send() = %v", err)
	}
	received, auths, authTLS := srv.snapshot()
	if len(received) != 1 || len(auths) != 1 || !authTLS[0] {
		t.Fatalf("received %d mails, auth %v (tls %v)", len(received), auths, authTLS)
	}
}

func TestImplicitTLSPort(t *testing.T) {
	for port, want := range map[int]bool{465: true, 2465: true, 25: false, 587: false, 2587: false} {
		if got := mail.ImplicitTLSPort(port); got != want {
			t.Errorf("ImplicitTLSPort(%d) = %v, want %v", port, got, want)
		}
	}
}

// STARTTLS を広告しないサーバーには、認証情報も本文も渡さない（平文に落とされる攻撃を防ぐ）。
func TestSMTPRefusesWithoutSTARTTLS(t *testing.T) {
	srv, clientTLS := newFakeSMTPServer(t, false)
	srv.noStartTLS = true
	srv.start()
	s := newSMTP(t, srv.port(), clientTLS)

	err := s.Send(t.Context(), mail.Message{To: "alice@example.com", Subject: "s", Body: "b", Kind: "test"})
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("Send() = %v, want a STARTTLS error", err)
	}
	received, auths, _ := srv.snapshot()
	if len(received) != 0 || len(auths) != 0 {
		t.Fatalf("sent %d mails and %d credentials in plaintext", len(received), len(auths))
	}
}

// 証明書を検証できないサーバーには送らない（既定の TLS の設定は Host で検証する）。
func TestSMTPVerifiesCertificate(t *testing.T) {
	srv, _ := newFakeSMTPServer(t, false)
	srv.start()
	s := newSMTP(t, srv.port(), nil) // 自己署名の証明書を信頼しない

	if err := s.Send(t.Context(), mail.Message{To: "alice@example.com", Subject: "s", Body: "b", Kind: "test"}); err == nil {
		t.Fatal("Send() = nil, want a certificate error")
	}
	if received, auths, _ := srv.snapshot(); len(received) != 0 || len(auths) != 0 {
		t.Fatal("sent to a server whose certificate could not be verified")
	}
}

func TestSMTPPermanentAndTemporaryErrors(t *testing.T) {
	for _, tt := range []struct {
		code          int
		wantPermanent bool
	}{{550, true}, {451, false}} {
		t.Run(strconv.Itoa(tt.code), func(t *testing.T) {
			srv, clientTLS := newFakeSMTPServer(t, false)
			srv.rcptCode = tt.code
			srv.start()
			s := newSMTP(t, srv.port(), clientTLS)

			err := s.Send(t.Context(), mail.Message{To: "alice@example.com", Subject: "s", Body: "b", Kind: "test"})
			if err == nil {
				t.Fatal("Send() = nil, want an error")
			}
			if got := mail.Permanent(err); got != tt.wantPermanent {
				t.Fatalf("Permanent(%v) = %v, want %v", err, got, tt.wantPermanent)
			}
		})
	}
}

// 宛先やヘッダに改行を入れて、ヘッダを足させない。
func TestSMTPRejectsHeaderInjection(t *testing.T) {
	s := newSMTP(t, 1, nil) // 接続する前に断るので、ポートは使わない
	for _, m := range []mail.Message{
		{To: "alice@example.com\r\nBcc: eve@example.com", Subject: "s", Body: "b"},
		{To: "alice@example.com", Subject: "s\r\nBcc: eve@example.com", Body: "b"},
	} {
		if err := s.Send(t.Context(), m); err == nil {
			t.Errorf("Send(%q, %q) = nil, want an error", m.To, m.Subject)
		}
	}
}

// ctx の期限が来たら、応答しないサーバーを待ち続けずに戻る（ワーカーが止まらないように）。
func TestSMTPHonorsContext(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	t.Cleanup(func() { _ = ln.Close(); wg.Wait() })
	wg.Go(func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		// 挨拶を返さずに、相手が閉じるまで待つ。
		_, _ = io.Copy(io.Discard, bufio.NewReader(conn))
		_ = conn.Close()
	})
	s := newSMTP(t, ln.Addr().(*net.TCPAddr).Port, nil)

	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	err = s.Send(ctx, mail.Message{To: "alice@example.com", Subject: "s", Body: "b"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Send() = %v, want context.DeadlineExceeded", err)
	}
}
