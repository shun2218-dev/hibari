// Package turn は Cloudflare の TURN の短命な認証情報を発行する（ADR 0066 決定 14）。
//
// TURN は、ブラウザが Cloudflare の SFU に直接つながれない（UDP が塞がれている、など）ときの中継。
// キーの API トークンを持つのはこのパッケージだけにし、ブラウザには期限付きの認証情報だけを渡す。
package turn

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBaseURL は Cloudflare Realtime の API の起点（SFU と同じ）。
const DefaultBaseURL = "https://rtc.live.cloudflare.com/v1"

// MaxTTL は Cloudflare が受け付ける有効期間の上限（48 時間）。
const MaxTTL = 48 * time.Hour

// Config はクライアントの設定。
type Config struct {
	KeyID string
	// APIToken はキーの API トークン。ログに出さない。
	APIToken string
	// BaseURL は API の起点。空なら DefaultBaseURL。テストで httptest のサーバーに向けるためにある。
	BaseURL string
}

// ICEServer は RTCIceServer と同じ形。ブラウザにそのまま渡す。
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitzero"`
	Credential string   `json:"credential,omitzero"`
}

// Credentials は発行した ICE サーバーの一覧。Username は取り消すときに使う（TURN の認証情報にだけ入る）。
type Credentials struct {
	ICEServers []ICEServer
	Username   string
	ExpiresAt  time.Time
}

// Client は TURN のキーの API のクライアント。複数の goroutine から使える。
type Client struct {
	http  *http.Client
	base  string
	token string
}

// New は Client を返す。
func New(cfg Config) (*Client, error) {
	if cfg.KeyID == "" || cfg.APIToken == "" {
		return nil, errors.New("turn: key id and api token are required")
	}
	base := cfg.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	return &Client{
		http:  &http.Client{Timeout: 10 * time.Second},
		base:  base + "/turn/keys/" + url.PathEscape(cfg.KeyID),
		token: cfg.APIToken,
	}, nil
}

// Generate は有効期間 ttl の認証情報を発行する。now は期限の計算に使う（時刻は Clock から渡す）。
//
// 応答の URL のうち、ポート 53 のものは取り除く。ブラウザは 53 番への接続を弾くので、ICE の候補を集めるのが遅くなるだけになる
// （Cloudflare のドキュメントの注意）。
func (c *Client) Generate(ctx context.Context, ttl time.Duration, now time.Time) (Credentials, error) {
	if ttl <= 0 || ttl > MaxTTL {
		return Credentials{}, fmt.Errorf("turn: ttl must be in (0, %s], got %s", MaxTTL, ttl)
	}
	body, err := json.Marshal(struct {
		TTL int64 `json:"ttl"`
	}{int64(ttl / time.Second)})
	if err != nil {
		return Credentials{}, fmt.Errorf("turn: encode request: %w", err)
	}
	var res struct {
		ICEServers []ICEServer `json:"iceServers"`
	}
	if err := c.do(ctx, c.base+"/credentials/generate-ice-servers", body, &res); err != nil {
		return Credentials{}, fmt.Errorf("turn: generate: %w", err)
	}
	creds := Credentials{ExpiresAt: now.Add(ttl)}
	for _, s := range res.ICEServers {
		urls := make([]string, 0, len(s.URLs))
		for _, u := range s.URLs {
			if !usesPort53(u) {
				urls = append(urls, u)
			}
		}
		if len(urls) == 0 {
			continue
		}
		s.URLs = urls
		if s.Username != "" {
			creds.Username = s.Username
		}
		creds.ICEServers = append(creds.ICEServers, s)
	}
	if len(creds.ICEServers) == 0 {
		return Credentials{}, errors.New("turn: generate: no ice servers")
	}
	return creds, nil
}

// Revoke は発行した認証情報を取り消す。取り消した後、その認証情報での中継は少しの間を置いて切れる。
// 外された人（ADR 0066 決定 8）が、残っている期限の間に中継を使い続けないようにするため。
func (c *Client) Revoke(ctx context.Context, username string) error {
	if username == "" {
		return nil
	}
	if err := c.do(ctx, c.base+"/credentials/"+url.PathEscape(username)+"/revoke", nil, nil); err != nil {
		return fmt.Errorf("turn: revoke: %w", err)
	}
	return nil
}

// StatusError は 2xx 以外の応答。
type StatusError struct{ Code int }

func (e *StatusError) Error() string { return fmt.Sprintf("turn: unexpected status %d", e.Code) }

func (c *Client) do(ctx context.Context, u string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if res.StatusCode/100 != 2 {
		return &StatusError{Code: res.StatusCode}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

// usesPort53 は、stun: / turn: / turns: の URL がポート 53 を指すか。
// これらはスキームの後ろが「//」で始まらない（`turn:turn.cloudflare.com:53?transport=udp`）ので、url.Parse では取れない。
func usesPort53(raw string) bool {
	_, rest, ok := strings.Cut(raw, ":")
	if !ok {
		return false
	}
	rest, _, _ = strings.Cut(rest, "?")
	i := strings.LastIndex(rest, ":")
	return i >= 0 && rest[i+1:] == "53"
}
