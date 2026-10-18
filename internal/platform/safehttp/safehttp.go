// Package safehttp は、利用者が書いた URL をサーバーが取りに行くための HTTP クライアント（ADR 0065 決定 8）。
//
// いちばんの目的は、サーバーを内部のネットワークへの踏み台にさせないこと（SSRF の対策）。
// 名前を引いて検査してから接続する形は、2 回の名前解決の間に DNS の答えを変えられる（DNS rebinding）と破られるので、
// **実際に接続する直前の IP を net.Dialer.Control で検査する**。リダイレクトの先にも、同じ検査が接続のたびにかかる。
//
// チャットの知識（OGP、メッセージ）は持たない。取るのは「URL の GET と、上限までの本文」だけ。
package safehttp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"syscall"
	"time"
)

// ErrBlocked は、接続先のアドレス・スキーム・ポートが許されていないことを表す。
var ErrBlocked = errors.New("safehttp: destination is not allowed")

// StatusError は 2xx 以外の応答。
type StatusError struct{ Code int }

func (e *StatusError) Error() string { return fmt.Sprintf("safehttp: unexpected status %d", e.Code) }

// Options はクライアントの設定。本番では既定値のまま使う。
//
// AllowAddr と Ports はテストで httptest のサーバー（ループバック・任意のポート）を取りに行くためだけにある。
// **検査を外す環境変数は作らない**（ADR 0065 決定 8）ので、コードから渡すしかない。
type Options struct {
	// UserAgent は正直に名乗る（ほかのクローラーの名前を騙らない）。
	UserAgent string
	// DialTimeout は TCP の接続の上限。既定は 3 秒。
	DialTimeout time.Duration
	// MaxRedirects はリダイレクトを辿る回数の上限。既定は 3。
	MaxRedirects int
	// AllowAddr は接続してよいアドレスか。nil なら PublicAddr。
	AllowAddr func(netip.Addr) bool
	// Ports は接続してよいポート。nil なら 80 と 443。
	Ports []uint16
}

// Client は検査つきの HTTP クライアント。複数の goroutine から使える。
type Client struct {
	http      *http.Client
	userAgent string
	ports     map[uint16]bool
}

// New は Client を返す。
func New(opts Options) *Client {
	if opts.DialTimeout == 0 {
		opts.DialTimeout = 3 * time.Second
	}
	if opts.MaxRedirects == 0 {
		opts.MaxRedirects = 3
	}
	if opts.AllowAddr == nil {
		opts.AllowAddr = PublicAddr
	}
	if opts.Ports == nil {
		opts.Ports = []uint16{80, 443}
	}
	c := &Client{userAgent: opts.UserAgent, ports: make(map[uint16]bool, len(opts.Ports))}
	for _, p := range opts.Ports {
		c.ports[p] = true
	}

	dialer := &net.Dialer{
		Timeout: opts.DialTimeout,
		// 名前解決の後、実際に接続するアドレスを見る。IPv4 と IPv6 の両方を試すときも、試すたびに呼ばれる。
		Control: func(_, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil {
				return fmt.Errorf("%w: %w", ErrBlocked, err)
			}
			if !c.ports[ap.Port()] || !opts.AllowAddr(ap.Addr()) {
				return ErrBlocked
			}
			return nil
		},
	}
	transport := &http.Transport{
		// 環境変数のプロキシを使わない。プロキシを通すと、検査するのはプロキシのアドレスになってしまう。
		Proxy:                  nil,
		DialContext:            dialer.DialContext,
		ForceAttemptHTTP2:      true,
		TLSHandshakeTimeout:    3 * time.Second,
		ResponseHeaderTimeout:  5 * time.Second,
		MaxResponseHeaderBytes: 64 << 10,
		MaxIdleConns:           16,
		IdleConnTimeout:        30 * time.Second,
	}
	c.http = &http.Client{
		Transport: transport,
		// Cookie を持たない（Jar を設定しない）。取りに行った先のセッションを覚えない。
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > opts.MaxRedirects {
				return fmt.Errorf("safehttp: stopped after %d redirects", opts.MaxRedirects)
			}
			// IP は接続のときに Control が見る。ここではスキーム・ユーザー情報・ポートを見る。
			return c.checkURL(req.URL)
		},
	}
	return c
}

// Response は取れた応答。Body は上限までで切ってある。
type Response struct {
	// URL はリダイレクトを辿った後の URL。相対 URL（og:image など）を解決するのに使う。
	URL *url.URL
	// ContentType はパラメータを除いた小文字の type/subtype。
	ContentType string
	// Charset は Content-Type の charset パラメータ（なければ空）。
	Charset string
	Body    []byte
	// Truncated は、本文が上限を超えて途中で切ったか。HTML は先頭だけで足りるが、画像は壊れているので捨てる。
	Truncated bool
}

// Get は rawURL を GET し、本文を maxBytes まで読む。2xx でなければ *StatusError。
// 時間の上限は ctx で渡す（1 つのプレビューで、ページ・画像・アイコンを合わせた上限を持つため）。
func (c *Client) Get(ctx context.Context, rawURL, accept string, maxBytes int64) (*Response, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrBlocked, err)
	}
	if err := c.checkURL(u); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrBlocked, err)
	}
	if c.userAgent != "" {
		req.Header.Set("User-Agent", c.userAgent)
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	// 日本語のサイトが言語ごとにタイトルを出し分けるときに、日本語を選ばせる
	req.Header.Set("Accept-Language", "ja,en;q=0.8")

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("safehttp: get: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, &StatusError{Code: res.StatusCode}
	}

	out := &Response{URL: res.Request.URL}
	if mt, params, err := mime.ParseMediaType(res.Header.Get("Content-Type")); err == nil {
		out.ContentType = mt
		out.Charset = params["charset"]
	}
	// 上限より 1 バイト多く読めたら、超えていたと分かる
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("safehttp: read body: %w", err)
	}
	if int64(len(body)) > maxBytes {
		out.Body, out.Truncated = body[:maxBytes], true
	} else {
		out.Body = body
	}
	return out, nil
}

// checkURL は、接続する前に分かる条件（スキーム・ユーザー情報・ポート）を見る。
func (c *Client) checkURL(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%w: scheme %q", ErrBlocked, u.Scheme)
	}
	// user:pass@host は、見た目のホストと違う所へ誘導するのに使われる。正当な使い道もないので拒否する
	if u.User != nil || u.Hostname() == "" {
		return fmt.Errorf("%w: userinfo or empty host", ErrBlocked)
	}
	port := u.Port()
	if port == "" {
		port = map[string]string{"http": "80", "https": "443"}[u.Scheme]
	}
	p, err := strconv.ParseUint(port, 10, 16)
	if err != nil || !c.ports[uint16(p)] {
		return fmt.Errorf("%w: port %q", ErrBlocked, port)
	}
	return nil
}

// deniedPrefixes は、グローバルなユニキャストに見えても接続させない範囲。
// ループバック・プライベート・リンクローカル・マルチキャスト・未指定は PublicAddr が netip の判定で落とす。
var deniedPrefixes = func() []netip.Prefix {
	var ps []netip.Prefix
	for _, s := range []string{
		"0.0.0.0/8",       // 「この」ネットワーク
		"100.64.0.0/10",   // CGNAT（キャリアの内側）
		"192.0.0.0/24",    // IETF の予約
		"192.0.2.0/24",    // 文書用
		"198.18.0.0/15",   // ベンチマーク用
		"198.51.100.0/24", // 文書用
		"203.0.113.0/24",  // 文書用
		"240.0.0.0/4",     // 予約（255.255.255.255 を含む）
		"::/96",           // IPv4 互換（廃止）
		"100::/64",        // 捨てる用
		"2001::/32",       // Teredo。埋め込んだ IPv4 の取り出し方が複雑なので、まとめて拒否する
		"2001:db8::/32",   // 文書用
		"2002::/16",       // 6to4。同上
		"64:ff9b:1::/48",  // ローカル用の NAT64
		"fec0::/10",       // サイトローカル（廃止）
	} {
		ps = append(ps, netip.MustParsePrefix(s))
	}
	return ps
}()

// nat64 はよく知られた NAT64 の範囲。下位 32 ビットが IPv4 なので、取り出して同じ検査をする。
var nat64 = netip.MustParsePrefix("64:ff9b::/96")

// PublicAddr は、インターネットの向こう側にあるアドレスか（ADR 0065 決定 8）。
//
// プライベート（ユニークローカル fc00::/7 を含むので、Fly の内部ネットワーク fdaa::/16 も落ちる）、
// ループバック、リンクローカル（169.254.169.254 のメタデータを含む）、マルチキャスト、未指定、
// CGNAT などの予約済みの範囲を拒否する。IPv4 を埋め込んだ IPv6 は、埋め込まれた IPv4 で判定する。
func PublicAddr(a netip.Addr) bool {
	a = a.Unmap() // ::ffff:127.0.0.1 は 127.0.0.1 として見る
	if a.Is6() && nat64.Contains(a) {
		b := a.As16()
		return PublicAddr(netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]}))
	}
	if !a.IsGlobalUnicast() || a.IsPrivate() {
		return false
	}
	for _, p := range deniedPrefixes {
		if p.Contains(a) {
			return false
		}
	}
	return true
}
