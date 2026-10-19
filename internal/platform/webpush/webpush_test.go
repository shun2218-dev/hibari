package webpush

import (
	"context"
	"crypto/ecdh"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/safehttp"
)

func TestCheckEndpoint(t *testing.T) {
	tests := []struct {
		endpoint string
		ok       bool
	}{
		{"https://fcm.googleapis.com/fcm/send/abc:APA91b", true},
		{"https://updates.push.services.mozilla.com/wpush/v2/gAAAAA", true},
		{"https://web.push.apple.com/QGuQyavXutnMH8", true},
		{"https://wns2-par02p.notify.windows.com/w/?token=BQYAAA", true},
		{"https://FCM.googleapis.com/fcm/send/abc", true}, // ホスト名は大文字小文字を区別しない
		{"https://fcm.googleapis.com:443/fcm/send/abc", true},

		{"http://fcm.googleapis.com/fcm/send/abc", false},            // https だけ
		{"https://fcm.googleapis.com:8443/fcm/send/abc", false},      // 既定のポートだけ
		{"https://user:pass@fcm.googleapis.com/fcm/send/abc", false}, // ユーザー情報で見た目をごまかさない
		{"https://push.apple.com/abc", false},                        // サブドメインだけを受ける
		{"https://evilpush.apple.com.example.com/abc", false},
		{"https://fcm.googleapis.com.example.com/abc", false},
		{"https://example.com/push", false},
		{"https://127.0.0.1/push", false},
		{"https://[::1]/push", false},
		{"https://169.254.169.254/latest/meta-data", false},
		{"ftp://fcm.googleapis.com/abc", false},
		{"fcm.googleapis.com/abc", false},
		{"", false},
		{"https://fcm.googleapis.com/" + strings.Repeat("a", maxEndpointLen), false},
	}
	for _, tt := range tests {
		t.Run(tt.endpoint, func(t *testing.T) {
			err := CheckEndpoint(tt.endpoint)
			if tt.ok && err != nil {
				t.Errorf("err = %v, want nil", err)
			}
			if !tt.ok && !errors.Is(err, ErrEndpointNotAllowed) {
				t.Errorf("err = %v, want ErrEndpointNotAllowed", err)
			}
		})
	}
}

// pushServer は httptest のプッシュのサービス。受けたリクエストを覚え、決めたステータスを返す。
type pushServer struct {
	*httptest.Server
	status int

	mu      sync.Mutex
	header  http.Header
	body    []byte
	path    string
	reached bool
}

func newPushServer(t *testing.T, status int) *pushServer {
	t.Helper()
	ps := &pushServer{status: status}
	ps.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		ps.mu.Lock()
		ps.header, ps.body, ps.path, ps.reached = r.Header.Clone(), b, r.URL.Path, true
		ps.mu.Unlock()
		w.WriteHeader(ps.status)
		_, _ = w.Write([]byte(strings.Repeat("x", 64<<10))) // 上限より長い本文でも詰まらない
	}))
	t.Cleanup(ps.Close)
	return ps
}

func (ps *pushServer) port(t *testing.T) uint16 {
	t.Helper()
	u, err := url.Parse(ps.URL)
	if err != nil {
		t.Fatal(err)
	}
	p, err := strconv.ParseUint(u.Port(), 10, 16)
	if err != nil {
		t.Fatal(err)
	}
	return uint16(p)
}

var testNow = time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)

// loopbackSender は httptest のサーバーへ送れる Sender。endpoint の名前の検査と、接続先の IP の検査の両方を、テストのためだけに緩める。
func loopbackSender(t *testing.T, ps *pushServer) (*Sender, Options) {
	t.Helper()
	opts := Options{
		Key:           newP256Key(t),
		Subject:       "mailto:ops@example.com",
		Clock:         clock.NewFake(testNow),
		HTTP:          safehttp.New(safehttp.Options{AllowAddr: func(a netip.Addr) bool { return a.IsLoopback() }, Ports: []uint16{ps.port(t)}}),
		CheckEndpoint: func(string) error { return nil },
	}
	s, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	return s, opts
}

func testSubscription(t *testing.T, endpoint string) (Subscription, *ecdh.PrivateKey) {
	t.Helper()
	ua, err := ecdh.P256().NewPrivateKey(mustB64(t, rfcUAPrivate))
	if err != nil {
		t.Fatal(err)
	}
	return Subscription{Endpoint: endpoint, P256dh: ua.PublicKey().Bytes(), Auth: mustB64(t, rfcAuth)}, ua
}

func TestSendRequestShape(t *testing.T) {
	ps := newPushServer(t, http.StatusCreated)
	s, opts := loopbackSender(t, ps)
	sub, ua := testSubscription(t, ps.URL+"/wpush/v2/token")

	msg := Message{Payload: []byte(`{"title":"hibari"}`), TTL: 60*time.Second + 900*time.Millisecond, Urgency: UrgencyHigh, Topic: "room_01J"}
	if err := s.Send(context.Background(), sub, msg); err != nil {
		t.Fatal(err)
	}

	ps.mu.Lock()
	defer ps.mu.Unlock()
	if ps.path != "/wpush/v2/token" {
		t.Errorf("path = %q", ps.path)
	}
	for name, want := range map[string]string{
		"Content-Encoding": "aes128gcm",
		"Content-Type":     "application/octet-stream",
		"Ttl":              "60", // 秒に切り捨てる
		"Urgency":          "high",
		"Topic":            "room_01J",
	} {
		if got := ps.header.Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	// 本文は受け手の鍵で復号できる
	if got := decrypt(t, ua, sub.Auth, ps.body); string(got) != string(msg.Payload) {
		t.Errorf("payload = %q", got)
	}

	// Authorization: vapid t=<JWT>, k=<公開鍵>。k の鍵で t を検証でき、aud は endpoint のオリジン
	auth := ps.header.Get("Authorization")
	tokPart, keyPart, ok := strings.Cut(strings.TrimPrefix(auth, "vapid "), ", ")
	if !strings.HasPrefix(auth, "vapid t=") || !ok || !strings.HasPrefix(keyPart, "k=") {
		t.Fatalf("authorization = %q", auth)
	}
	k := strings.TrimPrefix(keyPart, "k=")
	if k != s.PublicKey() {
		t.Errorf("k = %q, want the sender's public key", k)
	}
	pub, err := ecdh.P256().NewPublicKey(mustB64(t, k))
	if err != nil {
		t.Fatal(err)
	}
	jk, err := jwk.Import(&opts.Key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	if ek, _ := opts.Key.PublicKey.ECDH(); !ek.Equal(pub) {
		t.Error("k is not the VAPID public key")
	}
	tok, err := jwt.ParseString(strings.TrimPrefix(tokPart, "t="), jwt.WithKey(jwa.ES256(), jk),
		jwt.WithClock(jwt.ClockFunc(func() time.Time { return testNow })))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if aud, _ := tok.Audience(); len(aud) != 1 || aud[0] != strings.TrimSuffix(ps.URL, "/") {
		t.Errorf("aud = %v, want %s", aud, ps.URL)
	}
	if exp, _ := tok.Expiration(); !exp.Equal(testNow.Add(VAPIDTokenTTL)) {
		t.Errorf("exp = %v", exp)
	}
}

func TestSendOmitsOptionalHeaders(t *testing.T) {
	ps := newPushServer(t, http.StatusCreated)
	s, _ := loopbackSender(t, ps)
	sub, _ := testSubscription(t, ps.URL)

	if err := s.Send(context.Background(), sub, Message{Payload: []byte("x")}); err != nil {
		t.Fatal(err)
	}
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if _, ok := ps.header["Urgency"]; ok {
		t.Error("Urgency was sent")
	}
	if _, ok := ps.header["Topic"]; ok {
		t.Error("Topic was sent")
	}
	// TTL は RFC 8030 で必須。0 でも付ける
	if got := ps.header.Get("TTL"); got != "0" {
		t.Errorf("TTL = %q, want 0", got)
	}
}

func TestSendStatus(t *testing.T) {
	tests := []struct {
		status   int
		wantErr  bool
		wantGone bool
	}{
		{http.StatusCreated, false, false},
		{http.StatusOK, false, false},
		{http.StatusAccepted, false, false},
		{http.StatusNotFound, true, true},
		{http.StatusGone, true, true},
		{http.StatusTooManyRequests, true, false},
		{http.StatusInternalServerError, true, false},
		{http.StatusServiceUnavailable, true, false},
		{http.StatusBadRequest, true, false},
		{http.StatusForbidden, true, false}, // VAPID の鍵が購読のときと違う
		{http.StatusRequestEntityTooLarge, true, false},
		{http.StatusTemporaryRedirect, true, false}, // POST はリダイレクトを辿らない
	}
	for _, tt := range tests {
		t.Run(strconv.Itoa(tt.status), func(t *testing.T) {
			ps := newPushServer(t, tt.status)
			s, _ := loopbackSender(t, ps)
			sub, _ := testSubscription(t, ps.URL+"/secret-token")

			err := s.Send(context.Background(), sub, Message{Payload: []byte("x"), TTL: time.Minute})
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if errors.Is(err, ErrGone) != tt.wantGone {
				t.Errorf("errors.Is(err, ErrGone) = %v, want %v", errors.Is(err, ErrGone), tt.wantGone)
			}
			// 再送しない（1 回だけ届く）。endpoint はエラーの文字列に出さない
			if err != nil && strings.Contains(err.Error(), "secret-token") {
				t.Errorf("error contains the endpoint: %v", err)
			}
		})
	}
}

func TestSendRejectsDestinations(t *testing.T) {
	ps := newPushServer(t, http.StatusCreated)
	sub, _ := testSubscription(t, "")

	t.Run("既定の検査では endpoint の名前で止める", func(t *testing.T) {
		s, err := New(Options{Key: newP256Key(t), Subject: "mailto:ops@example.com", Clock: clock.NewFake(testNow)})
		if err != nil {
			t.Fatal(err)
		}
		for _, endpoint := range []string{
			ps.URL,                                  // http でループバック
			"https://example.com/push",              // 知らないホスト
			"http://fcm.googleapis.com/fcm/send/ab", // http
		} {
			sub.Endpoint = endpoint
			if err := s.Send(context.Background(), sub, Message{Payload: []byte("x")}); !errors.Is(err, ErrEndpointNotAllowed) {
				t.Errorf("%s: err = %v, want ErrEndpointNotAllowed", endpoint, err)
			}
		}
	})

	t.Run("名前の検査を通っても、接続の直前に内部の IP を止める", func(t *testing.T) {
		// 名前の検査だけを緩め、safehttp は既定（公開のアドレスだけ）のまま。ポートだけ httptest に合わせる
		s, err := New(Options{
			Key:           newP256Key(t),
			Subject:       "mailto:ops@example.com",
			Clock:         clock.NewFake(testNow),
			HTTP:          safehttp.New(safehttp.Options{Ports: []uint16{ps.port(t)}}),
			CheckEndpoint: func(string) error { return nil },
		})
		if err != nil {
			t.Fatal(err)
		}
		for _, endpoint := range []string{ps.URL, strings.Replace(ps.URL, "127.0.0.1", "localhost", 1)} {
			sub.Endpoint = endpoint + "/secret-token"
			err := s.Send(context.Background(), sub, Message{Payload: []byte("x")})
			if !errors.Is(err, safehttp.ErrBlocked) {
				t.Errorf("%s: err = %v, want safehttp.ErrBlocked", endpoint, err)
			}
			if err != nil && strings.Contains(err.Error(), "secret-token") {
				t.Errorf("error contains the endpoint: %v", err)
			}
		}
	})

	ps.mu.Lock()
	defer ps.mu.Unlock()
	if ps.reached {
		t.Error("a request reached the server")
	}
}

func TestSendValidatesMessage(t *testing.T) {
	ps := newPushServer(t, http.StatusCreated)
	s, _ := loopbackSender(t, ps)
	sub, _ := testSubscription(t, ps.URL)

	tests := []struct {
		name string
		sub  Subscription
		msg  Message
		want error
	}{
		{"ペイロードが大きすぎる", sub, Message{Payload: make([]byte, MaxPayload+1)}, ErrPayloadTooLarge},
		{"鍵が壊れている", Subscription{Endpoint: ps.URL, P256dh: []byte{4}, Auth: sub.Auth}, Message{}, ErrInvalidSubscription},
		{"Topic が長すぎる", sub, Message{Topic: strings.Repeat("a", 33)}, nil},
		{"Topic に base64url でない文字", sub, Message{Topic: "room:1"}, nil},
		{"TTL が負", sub, Message{TTL: -time.Second}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := s.Send(context.Background(), tt.sub, tt.msg)
			if err == nil {
				t.Fatal("err = nil")
			}
			if tt.want != nil && !errors.Is(err, tt.want) {
				t.Errorf("err = %v, want %v", err, tt.want)
			}
		})
	}
	ps.mu.Lock()
	defer ps.mu.Unlock()
	if ps.reached {
		t.Error("an invalid message was sent")
	}
}

func TestNewValidatesOptions(t *testing.T) {
	key := newP256Key(t)
	clk := clock.NewFake(testNow)
	for name, opts := range map[string]Options{
		"鍵がない":              {Subject: "mailto:ops@example.com", Clock: clk},
		"時計がない":             {Key: key, Subject: "mailto:ops@example.com"},
		"subject がない":       {Key: key, Clock: clk},
		"subject が URI でない": {Key: key, Subject: "ops@example.com", Clock: clk},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := New(opts); err == nil {
				t.Error("err = nil")
			}
		})
	}
	s, err := New(Options{Key: key, Subject: "https://hibari.example.com", Clock: clk})
	if err != nil {
		t.Fatal(err)
	}
	// applicationServerKey は非圧縮の点（65 バイト）の base64url
	if b := mustB64(t, s.PublicKey()); len(b) != 65 || b[0] != 0x04 {
		t.Errorf("public key = %x", b)
	}
}
