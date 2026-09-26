// Package sfu は Cloudflare Realtime の SFU の HTTPS API のクライアント（ADR 0066 決定 2・15）。
//
// アプリの秘密を持つのはこのパッケージだけにする。ブラウザは SFU を直接呼ばず、Go が SDP を中継する。
// 「誰の音声を受けてよいか」を Go が決めるためで、ブラウザに秘密を渡すと、許していないトラックを勝手に受けに行ける。
//
// Cloudflare の SFU には部屋の概念がなく、あるのは「セッション（1 本の RTCPeerConnection）」と「トラック」だけ。
// チャットの知識（ハドル・ルーム・参加者）は持たない。それを組み立てるのは chat の側。
//
// 1 つのセッションへの変更は直列にしなければならない（前の要求と SDP のやり取りが終わる前に次を送ると 406）。
// 直列にするのは呼び出し側（ADR 0066 決定 4 ではクライアントが 1 本の列に並べる）で、このクライアントは 406 を ErrConflict で返すだけ。
package sfu

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// DefaultBaseURL は Cloudflare Realtime の API の起点。
const DefaultBaseURL = "https://rtc.live.cloudflare.com/v1"

var (
	// ErrConflict は、同じセッションへの変更が重なった（406）ことを表す。呼び出し側はやり直す。
	ErrConflict = errors.New("sfu: conflicting session mutation")
	// ErrSessionGone は、セッションがもう使えない（410。接続が切れてから 30 秒たった、一度もつながらずに期限が切れた）ことを表す。
	ErrSessionGone = errors.New("sfu: session is gone")
)

// APIError は、ErrConflict / ErrSessionGone 以外の失敗の応答。
// Code は Cloudflare の errorCode。ログにはこれを出す（Description に SDP の断片が入ることがあるので出さない）。
type APIError struct {
	Status      int
	Code        string
	Description string
}

func (e *APIError) Error() string { return fmt.Sprintf("sfu: status %d (%s)", e.Status, e.Code) }

// Config はクライアントの設定。
type Config struct {
	AppID string
	// AppSecret はアプリの秘密。ログに出さない。
	AppSecret string
	// BaseURL は API の起点。空なら DefaultBaseURL。テストで httptest のサーバーに向けるためにある。
	BaseURL string
}

// Client は SFU の API のクライアント。複数の goroutine から使える。
type Client struct {
	http   *http.Client
	base   string
	appID  string
	secret string
}

// New は Client を返す。
func New(cfg Config) (*Client, error) {
	if cfg.AppID == "" || cfg.AppSecret == "" {
		return nil, errors.New("sfu: app id and secret are required")
	}
	base := cfg.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	if _, err := url.Parse(base); err != nil {
		return nil, fmt.Errorf("sfu: base url: %w", err)
	}
	return &Client{
		// SDP のやり取りは利用者が「参加」を押して待っている間に起きるので、長く待たせない。
		// Cloudflare は接続を待つ操作でも 5 秒で打ち切る（公式の上限）ので、それより少し長くする。
		http:   &http.Client{Timeout: 10 * time.Second},
		base:   base,
		appID:  url.PathEscape(cfg.AppID),
		secret: cfg.AppSecret,
	}, nil
}

// SessionDescription は SDP（RTCSessionDescription と同じ形）。
type SessionDescription struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

// LocalTrack は、このセッションから送る自分のトラック。Mid はブラウザの transceiver の mid。
type LocalTrack struct {
	Mid       string
	TrackName string
}

// RemoteTrack は、ほかのセッションが送っているトラック（受けに行く相手）。
type RemoteTrack struct {
	SessionID string
	TrackName string
}

// TrackResult はトラックごとの結果。Cloudflare は 200 の中にトラックごとの失敗を返すことがある。
type TrackResult struct {
	TrackName string
	// SessionID は受けたトラックの相手のセッション（送るトラックでは空）。
	SessionID string
	Mid       string
	// Err はこのトラックだけの失敗。成功なら nil。
	Err error
}

// NewSession はセッションを作り、その ID を返す。
func (c *Client) NewSession(ctx context.Context) (string, error) {
	var res struct {
		SessionID string `json:"sessionId"`
		apiErrorBody
	}
	if err := c.do(ctx, http.MethodPost, c.appPath("/sessions/new"), nil, &res); err != nil {
		return "", fmt.Errorf("new session: %w", err)
	}
	if res.SessionID == "" {
		return "", errors.New("new session: empty session id")
	}
	return res.SessionID, nil
}

// PushTracks は、ブラウザの offer で自分のトラックを送る設定をし、answer を返す。
func (c *Client) PushTracks(ctx context.Context, sessionID string, offer SessionDescription, tracks []LocalTrack) (SessionDescription, []TrackResult, error) {
	req := tracksRequest{SessionDescription: &offer}
	for _, t := range tracks {
		req.Tracks = append(req.Tracks, trackObject{Location: "local", Mid: t.Mid, TrackName: t.TrackName})
	}
	var res tracksResponse
	if err := c.do(ctx, http.MethodPost, c.sessionPath(sessionID, "/tracks/new"), req, &res); err != nil {
		return SessionDescription{}, nil, fmt.Errorf("push tracks: %w", err)
	}
	if res.SessionDescription == nil {
		return SessionDescription{}, nil, errors.New("push tracks: no answer")
	}
	return *res.SessionDescription, res.results(), nil
}

// PullResult は PullTracks の結果。
type PullResult struct {
	// Offer は SFU からの offer。ブラウザの answer を Renegotiate で返す。
	// RequiresImmediateRenegotiation が false のとき（受けるトラックが 1 つも増えなかった）は nil のことがある。
	Offer                          *SessionDescription
	RequiresImmediateRenegotiation bool
	Tracks                         []TrackResult
}

// PullTracks は、ほかのセッションのトラックを受ける設定をする。
func (c *Client) PullTracks(ctx context.Context, sessionID string, tracks []RemoteTrack) (PullResult, error) {
	var req tracksRequest
	for _, t := range tracks {
		req.Tracks = append(req.Tracks, trackObject{Location: "remote", SessionID: t.SessionID, TrackName: t.TrackName})
	}
	var res tracksResponse
	if err := c.do(ctx, http.MethodPost, c.sessionPath(sessionID, "/tracks/new"), req, &res); err != nil {
		return PullResult{}, fmt.Errorf("pull tracks: %w", err)
	}
	return PullResult{
		Offer:                          res.SessionDescription,
		RequiresImmediateRenegotiation: res.RequiresImmediateRenegotiation,
		Tracks:                         res.results(),
	}, nil
}

// Renegotiate は、PullTracks の offer に対するブラウザの answer を渡す。
func (c *Client) Renegotiate(ctx context.Context, sessionID string, answer SessionDescription) error {
	req := struct {
		SessionDescription SessionDescription `json:"sessionDescription"`
	}{answer}
	var res apiErrorBody
	if err := c.do(ctx, http.MethodPut, c.sessionPath(sessionID, "/renegotiate"), req, &res); err != nil {
		return fmt.Errorf("renegotiate: %w", err)
	}
	return nil
}

// CloseTracks はトラックを閉じる。SDP を伴わない強制の閉じ方（force）だけを使う。
//
// サーバーの側から閉じるのは、抜けた人・外された人の送るトラックと受けるトラック（ADR 0066 決定 5・8）と、
// 抜けた相手の分の受けるトラック（決定 9）。どちらもブラウザとの SDP のやり取りを待たずに、すぐに止めたい。
// mids が空なら何もしない。
func (c *Client) CloseTracks(ctx context.Context, sessionID string, mids []string) error {
	if len(mids) == 0 {
		return nil
	}
	req := struct {
		Tracks []trackObject `json:"tracks"`
		Force  bool          `json:"force"`
	}{Force: true}
	for _, mid := range mids {
		req.Tracks = append(req.Tracks, trackObject{Mid: mid})
	}
	var res apiErrorBody
	if err := c.do(ctx, http.MethodPut, c.sessionPath(sessionID, "/tracks/close"), req, &res); err != nil {
		return fmt.Errorf("close tracks: %w", err)
	}
	return nil
}

// Tracks はセッションのトラックの一覧（GET session）。状態が active / inactive / initializing のものを返す。
// サーバーの側からセッションのトラックを全部閉じるときに、閉じる mid を知るために使う。
func (c *Client) Tracks(ctx context.Context, sessionID string) ([]TrackResult, error) {
	var res tracksResponse
	if err := c.do(ctx, http.MethodGet, c.sessionPath(sessionID, ""), nil, &res); err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return res.results(), nil
}

func (c *Client) appPath(p string) string { return c.base + "/apps/" + c.appID + p }

func (c *Client) sessionPath(sessionID, p string) string {
	return c.appPath("/sessions/" + url.PathEscape(sessionID) + p)
}

// do は要求を送り、応答を out に読む。失敗の応答は ErrConflict / ErrSessionGone / *APIError にする。
// out は apiErrorBody を埋め込んだ型で、200 でも最上位の errorCode があれば失敗として扱う。
func (c *Client) do(ctx context.Context, method, u string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.secret)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	// SDP を含むので小さくはないが、1MB を超える応答は来ない。上限を置いて読みすぎを防ぐ。
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	switch res.StatusCode {
	case http.StatusNotAcceptable:
		return ErrConflict
	case http.StatusGone:
		return ErrSessionGone
	}
	if res.StatusCode/100 != 2 {
		var e apiErrorBody
		_ = json.Unmarshal(raw, &e) // 本文が JSON でなくても、状態コードだけで失敗を返す
		return &APIError{Status: res.StatusCode, Code: e.ErrorCode, Description: e.ErrorDescription}
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	// json/v2 は知らない項目を既定で無視する（Cloudflare が項目を足しても壊れない）。
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	if e, ok := out.(interface{ apiError() *apiErrorBody }); ok {
		if b := e.apiError(); b.ErrorCode != "" {
			return &APIError{Status: res.StatusCode, Code: b.ErrorCode, Description: b.ErrorDescription}
		}
	}
	return nil
}

// apiErrorBody は応答の最上位の失敗。Cloudflare は 200 でもここに入れて返すことがある。
type apiErrorBody struct {
	ErrorCode        string `json:"errorCode,omitzero"`
	ErrorDescription string `json:"errorDescription,omitzero"`
}

func (b *apiErrorBody) apiError() *apiErrorBody { return b }

type trackObject struct {
	Location  string `json:"location,omitzero"`
	Mid       string `json:"mid,omitzero"`
	SessionID string `json:"sessionId,omitzero"`
	TrackName string `json:"trackName,omitzero"`
}

type tracksRequest struct {
	SessionDescription *SessionDescription `json:"sessionDescription,omitzero"`
	Tracks             []trackObject       `json:"tracks"`
}

type tracksResponse struct {
	apiErrorBody
	RequiresImmediateRenegotiation bool                `json:"requiresImmediateRenegotiation"`
	SessionDescription             *SessionDescription `json:"sessionDescription"`
	Tracks                         []struct {
		trackObject
		apiErrorBody
	} `json:"tracks"`
}

func (r *tracksResponse) results() []TrackResult {
	out := make([]TrackResult, 0, len(r.Tracks))
	for _, t := range r.Tracks {
		result := TrackResult{TrackName: t.TrackName, SessionID: t.SessionID, Mid: t.Mid}
		if t.ErrorCode != "" {
			result.Err = &APIError{Status: http.StatusOK, Code: t.ErrorCode, Description: t.ErrorDescription}
		}
		out = append(out, result)
	}
	return out
}
