// Package webpush は Web Push（RFC 8030）でプッシュのサービスに通知を 1 件送る（ADR 0069 決定 9）。
//
// ペイロードの暗号化（RFC 8291）と VAPID の署名（RFC 8292）を自分で持つ。Go の Web Push のライブラリは別の JWT の
// ライブラリを連れてくるが、hibari は jwx に統一している。暗号化は RFC の付録 A のテストベクタで正しさを機械で確かめられる。
//
// チャットの知識（メッセージ、通知の規則、購読の行）は持たない。受けるのは endpoint・鍵・バイト列・TTL・urgency だけで、
// 誰に何を送るか、消えた購読をどうするかは呼ぶ側が決める（platform/storage と同じ位置）。
//
// endpoint は利用者のブラウザが渡す URL で、サーバーはそこへ POST する。SSRF の踏み台にしないよう、
// 既知のプッシュのサービスのホストだけを受け（CheckEndpoint）、接続の直前の IP の検査は safehttp に任せる（ADR 0069 決定 4）。
//
// ログには endpoint・鍵・本文を出さない（CLAUDE.md「ログ」）。endpoint はそれだけで購読者に送れる宛先なので、トークンと同じ扱い。
// このパッケージはログを書かず、エラーにも endpoint を含めない。
package webpush

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/safehttp"
)

// ErrGone は、プッシュのサービスが 404 か 410 を返した（購読が消えた・期限が切れた）ことを表す。
// 呼ぶ側は購読の行を消す（ADR 0069 決定 8）。送り直しても届かない。
var ErrGone = errors.New("webpush: subscription is gone")

// ErrEndpointNotAllowed は、endpoint が既知のプッシュのサービスの https の URL でないことを表す。
var ErrEndpointNotAllowed = errors.New("webpush: endpoint is not an allowed push service")

// maxEndpointLen は endpoint の長さの上限。FCM・Mozilla・Apple・Windows の endpoint は数百バイトに収まる。
// 購読の登録（ADR 0069 決定 4）で DB に入れる前に、際限のない文字列を止める。
const maxEndpointLen = 2048

// pushServiceHosts は endpoint として受けるホスト。完全一致のものと、サブドメインを受けるもの（先頭が "."）。
//
// ブラウザごとのプッシュのサービス: Chrome / Edge（Chromium 版の一部）は FCM、Firefox は Mozilla の autopush、
// Safari は Apple（web.push.apple.com）、旧 Edge と Windows の一部は WNS（地域ごとのサブドメイン）。
// ここにないブラウザ（ほかのプッシュのサービスを使う派生のブラウザなど）は、購読の登録で断られる。必要になったら足す。
var pushServiceHosts = []string{
	"fcm.googleapis.com",
	"updates.push.services.mozilla.com",
	".push.apple.com",
	".notify.windows.com",
}

// CheckEndpoint は、raw が受けてよい endpoint か（https で、既知のプッシュのサービスのホスト・既定のポート・ユーザー情報なし）を返す。
// 受けないときは ErrEndpointNotAllowed を包んだエラー。購読の登録（ADR 0069 決定 4）と送信の両方で使う。
//
// ここでは名前だけを見る。名前が内部の IP を指すように DNS を変えられても、接続の直前の検査（safehttp）が止める。
func CheckEndpoint(raw string) error {
	if len(raw) > maxEndpointLen {
		return fmt.Errorf("%w: too long", ErrEndpointNotAllowed)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrEndpointNotAllowed, err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("%w: scheme must be https", ErrEndpointNotAllowed)
	}
	if u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return fmt.Errorf("%w: userinfo or non-default port", ErrEndpointNotAllowed)
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range pushServiceHosts {
		if strings.HasPrefix(h, ".") {
			// "push.apple.com" そのものは endpoint にならないので、サブドメインだけを受ける
			if strings.HasSuffix(host, h) && len(host) > len(h) {
				return nil
			}
		} else if host == h {
			return nil
		}
	}
	return fmt.Errorf("%w: unknown host", ErrEndpointNotAllowed)
}

// Subscription はブラウザの PushSubscription（Push API）のうち、送るのに要るもの。
type Subscription struct {
	Endpoint string
	// P256dh は受け手の公開鍵（P-256 の非圧縮の点、65 バイト）。
	P256dh []byte
	// Auth は受け手と共有する秘密（16 バイト）。
	Auth []byte
}

// Urgency はプッシュのサービスに渡す緊急度（RFC 8030 の 5.3）。端末が省電力のときに、届ける時機を決めるのに使われる。
type Urgency string

// RFC 8030 の 5.3 の値。空なら Urgency のヘッダを付けない（プッシュのサービスは normal として扱う）。
const (
	UrgencyVeryLow Urgency = "very-low"
	UrgencyLow     Urgency = "low"
	UrgencyNormal  Urgency = "normal"
	UrgencyHigh    Urgency = "high"
)

// Message は送る通知 1 件。
type Message struct {
	// Payload は暗号化する前の本文。MaxPayload まで。
	Payload []byte
	// TTL はプッシュのサービスが届けられないときに保持する時間（秒に切り捨てる）。0 なら、いま届けられなければ捨てられる。
	TTL time.Duration
	// Urgency は空でもよい。
	Urgency Urgency
	// Topic は、同じ Topic のまだ届いていない通知を置き換えさせる（RFC 8030 の 5.4）。空なら付けない。
	// base64url の文字で 32 文字まで。
	Topic string
}

// Options は Sender の設定。
type Options struct {
	// Key は VAPID の秘密鍵（P-256）。ParseVAPIDKeyPEM で読む。
	Key *ecdsa.PrivateKey
	// Subject は VAPID の sub。プッシュのサービスが問題のある送り手に連絡するための mailto: か https: の URI（RFC 8292 の 2.1）。
	Subject string
	Clock   clock.Clock
	// HTTP はプッシュのサービスへの POST に使う。nil なら safehttp の既定（公開のアドレスの 443 だけ）。
	HTTP *safehttp.Client
	// CheckEndpoint は endpoint の検査。nil なら CheckEndpoint。
	// テストで httptest のサーバー（http・ループバック）に送るためだけにある。safehttp と同じく、検査を外す環境変数は作らない。
	CheckEndpoint func(string) error
}

// Sender は通知を送る。複数の goroutine から使える。
type Sender struct {
	key           *ecdsa.PrivateKey
	publicKey     []byte
	subject       string
	clock         clock.Clock
	http          *safehttp.Client
	checkEndpoint func(string) error
}

// New は Sender を返す。
func New(opts Options) (*Sender, error) {
	if opts.Key == nil || opts.Clock == nil {
		return nil, errors.New("webpush: key and clock are required")
	}
	if !strings.HasPrefix(opts.Subject, "mailto:") && !strings.HasPrefix(opts.Subject, "https://") {
		return nil, errors.New("webpush: subject must be a mailto: or https: URI")
	}
	pub, err := publicKeyBytes(opts.Key)
	if err != nil {
		return nil, err
	}
	s := &Sender{
		key:           opts.Key,
		publicKey:     pub,
		subject:       opts.Subject,
		clock:         opts.Clock,
		http:          opts.HTTP,
		checkEndpoint: opts.CheckEndpoint,
	}
	if s.http == nil {
		s.http = safehttp.New(safehttp.Options{UserAgent: "hibari-push"})
	}
	if s.checkEndpoint == nil {
		s.checkEndpoint = CheckEndpoint
	}
	return s, nil
}

// PublicKey は VAPID の公開鍵を base64url（詰め物なし）で返す。ブラウザの pushManager.subscribe の applicationServerKey に渡す。
func (s *Sender) PublicKey() string {
	return b64.EncodeToString(s.publicKey)
}

// maxResponseBody は応答の本文を読む上限。中身は使わない（成否はステータスで分かる）が、読み切ると接続を使い回せる。
const maxResponseBody = 4 << 10

// Send は msg を暗号化して sub の endpoint に POST する。
//
// 2xx は成功。404 / 410 は ErrGone。それ以外（429 や 5xx を含む）はエラーを返すだけで、送り直さない
// （ネットワークの向こうで溜めない。次の通知で届く。ADR 0069 決定 8）。時間の上限は ctx で渡す。
func (s *Sender) Send(ctx context.Context, sub Subscription, msg Message) error {
	if err := s.checkEndpoint(sub.Endpoint); err != nil {
		return err
	}
	if !validTopic(msg.Topic) {
		return errors.New("webpush: topic must be at most 32 base64url characters")
	}
	if msg.TTL < 0 {
		return errors.New("webpush: ttl must not be negative")
	}
	u, err := url.Parse(sub.Endpoint)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrEndpointNotAllowed, err)
	}

	body, err := encrypt(sub.P256dh, sub.Auth, msg.Payload)
	if err != nil {
		return err
	}
	token, err := vapidToken(s.key, u, s.subject, s.clock.Now())
	if err != nil {
		return err
	}

	h := http.Header{}
	h.Set("Content-Type", "application/octet-stream")
	h.Set("Content-Encoding", "aes128gcm")
	h.Set("TTL", strconv.FormatInt(int64(msg.TTL/time.Second), 10))
	h.Set("Authorization", "vapid t="+token+", k="+s.PublicKey())
	if msg.Urgency != "" {
		h.Set("Urgency", string(msg.Urgency))
	}
	if msg.Topic != "" {
		h.Set("Topic", msg.Topic)
	}

	_, err = s.http.Post(ctx, sub.Endpoint, h, body, maxResponseBody)
	if err == nil {
		return nil
	}
	var se *safehttp.StatusError
	if errors.As(err, &se) {
		if se.Code == http.StatusNotFound || se.Code == http.StatusGone {
			return ErrGone
		}
		return fmt.Errorf("webpush: push service: %w", se)
	}
	// safehttp のエラーは URL を含みうる（*url.Error）。endpoint をログに出さないため、URL を落として包む。
	var ue *url.Error
	if errors.As(err, &ue) {
		return fmt.Errorf("webpush: send: %w", ue.Err)
	}
	return fmt.Errorf("webpush: send: %w", err)
}

// validTopic は RFC 8030 の 5.4（base64url の文字で 32 文字まで）。
func validTopic(t string) bool {
	if len(t) > 32 {
		return false
	}
	// 両端から base64url の文字を削って空になれば、base64url の文字だけでできている
	return strings.Trim(t, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_") == ""
}
