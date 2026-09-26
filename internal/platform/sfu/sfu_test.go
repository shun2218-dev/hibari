package sfu_test

import (
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shun2218-dev/hibari/internal/platform/sfu"
)

// recorded は偽の Cloudflare が受け取った要求。
type recorded struct {
	method, path, auth, contentType string
	body                            map[string]any
}

// fakeCloudflare は、決まった応答を返し、受け取った要求を記録する偽の SFU の API。
func fakeCloudflare(t *testing.T, status int, response string) (*sfu.Client, *recorded) {
	t.Helper()
	got := &recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method, got.path = r.Method, r.URL.EscapedPath()
		got.auth, got.contentType = r.Header.Get("Authorization"), r.Header.Get("Content-Type")
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			if err := json.Unmarshal(b, &got.body); err != nil {
				t.Errorf("request body is not JSON: %v", err)
			}
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, response)
	}))
	t.Cleanup(srv.Close)
	c, err := sfu.New(sfu.Config{AppID: "app-1", AppSecret: "secret-1", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	return c, got
}

func TestNewRequiresCredentials(t *testing.T) {
	for _, cfg := range []sfu.Config{{AppID: "a"}, {AppSecret: "s"}} {
		if _, err := sfu.New(cfg); err == nil {
			t.Errorf("New(%+v) succeeded", cfg)
		}
	}
}

func TestNewSession(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusCreated, `{"sessionId":"s-1"}`)

	id, err := c.NewSession(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if id != "s-1" {
		t.Errorf("session id = %q", id)
	}
	if got.method != http.MethodPost || got.path != "/apps/app-1/sessions/new" {
		t.Errorf("request = %s %s", got.method, got.path)
	}
	// アプリの秘密は Bearer で送る（ADR 0066 決定 2）
	if got.auth != "Bearer secret-1" {
		t.Errorf("Authorization = %q", got.auth)
	}
}

func TestPushTracks(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusOK, `{
		"requiresImmediateRenegotiation": false,
		"tracks": [{"trackName": "audio", "mid": "0"}],
		"sessionDescription": {"type": "answer", "sdp": "v=0 answer"}
	}`)

	answer, tracks, err := c.PushTracks(context.Background(), "s-1",
		sfu.SessionDescription{Type: "offer", SDP: "v=0 offer"},
		[]sfu.LocalTrack{{Mid: "0", TrackName: "audio"}})
	if err != nil {
		t.Fatal(err)
	}
	if answer != (sfu.SessionDescription{Type: "answer", SDP: "v=0 answer"}) {
		t.Errorf("answer = %+v", answer)
	}
	if len(tracks) != 1 || tracks[0].TrackName != "audio" || tracks[0].Mid != "0" || tracks[0].Err != nil {
		t.Errorf("tracks = %+v", tracks)
	}
	if got.path != "/apps/app-1/sessions/s-1/tracks/new" || got.contentType != "application/json" {
		t.Errorf("request = %s (%s)", got.path, got.contentType)
	}
	want := map[string]any{
		"sessionDescription": map[string]any{"type": "offer", "sdp": "v=0 offer"},
		"tracks":             []any{map[string]any{"location": "local", "mid": "0", "trackName": "audio"}},
	}
	assertJSON(t, got.body, want)
}

func TestPullTracks(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusOK, `{
		"requiresImmediateRenegotiation": true,
		"tracks": [
			{"trackName": "audio", "sessionId": "s-2", "mid": "1"},
			{"trackName": "audio", "sessionId": "s-3", "errorCode": "not_found", "errorDescription": "track not found"}
		],
		"sessionDescription": {"type": "offer", "sdp": "v=0 pull"}
	}`)

	res, err := c.PullTracks(context.Background(), "s-1", []sfu.RemoteTrack{
		{SessionID: "s-2", TrackName: "audio"},
		{SessionID: "s-3", TrackName: "audio"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.RequiresImmediateRenegotiation || res.Offer == nil || res.Offer.SDP != "v=0 pull" {
		t.Errorf("result = %+v", res)
	}
	// 200 の中のトラックごとの失敗は、そのトラックの Err にだけ入る（ADR 0066 決定 9）
	if len(res.Tracks) != 2 || res.Tracks[0].Err != nil || res.Tracks[0].Mid != "1" || res.Tracks[0].SessionID != "s-2" {
		t.Errorf("track 0 = %+v", res.Tracks)
	}
	var apiErr *sfu.APIError
	if !errors.As(res.Tracks[1].Err, &apiErr) || apiErr.Code != "not_found" {
		t.Errorf("track 1 err = %v", res.Tracks[1].Err)
	}
	want := map[string]any{"tracks": []any{
		map[string]any{"location": "remote", "sessionId": "s-2", "trackName": "audio"},
		map[string]any{"location": "remote", "sessionId": "s-3", "trackName": "audio"},
	}}
	assertJSON(t, got.body, want)
}

func TestRenegotiate(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusOK, `{}`)

	if err := c.Renegotiate(context.Background(), "s-1", sfu.SessionDescription{Type: "answer", SDP: "v=0 a"}); err != nil {
		t.Fatal(err)
	}
	if got.method != http.MethodPut || got.path != "/apps/app-1/sessions/s-1/renegotiate" {
		t.Errorf("request = %s %s", got.method, got.path)
	}
	assertJSON(t, got.body, map[string]any{"sessionDescription": map[string]any{"type": "answer", "sdp": "v=0 a"}})
}

func TestCloseTracksForces(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusOK, `{"tracks":[{"mid":"0"},{"mid":"1"}]}`)

	if err := c.CloseTracks(context.Background(), "s-1", []string{"0", "1"}); err != nil {
		t.Fatal(err)
	}
	if got.method != http.MethodPut || got.path != "/apps/app-1/sessions/s-1/tracks/close" {
		t.Errorf("request = %s %s", got.method, got.path)
	}
	// サーバーの側から閉じるので、ブラウザの SDP を待たない（force）
	assertJSON(t, got.body, map[string]any{"force": true, "tracks": []any{map[string]any{"mid": "0"}, map[string]any{"mid": "1"}}})
}

func TestTracks(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusOK, `{"tracks":[{"location":"local","mid":"0","trackName":"audio","status":"active"},{"location":"remote","mid":"1","trackName":"audio","sessionId":"s-2","status":"active"}]}`)

	tracks, err := c.Tracks(context.Background(), "s-1")
	if err != nil {
		t.Fatal(err)
	}
	if got.method != http.MethodGet || got.path != "/apps/app-1/sessions/s-1" {
		t.Errorf("request = %s %s", got.method, got.path)
	}
	if len(tracks) != 2 || tracks[0].Mid != "0" || tracks[1].Mid != "1" {
		t.Errorf("tracks = %+v", tracks)
	}
}

func TestCloseNoTracksDoesNothing(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusOK, `{}`)

	if err := c.CloseTracks(context.Background(), "s-1", nil); err != nil {
		t.Fatal(err)
	}
	if got.method != "" {
		t.Errorf("sent a request: %s %s", got.method, got.path)
	}
}

func TestErrors(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		response string
		check    func(error) bool
	}{
		{"406 は重なった変更", http.StatusNotAcceptable, `{}`, func(err error) bool { return errors.Is(err, sfu.ErrConflict) }},
		{"410 は消えたセッション", http.StatusGone, `{"errorCode":"session_error"}`, func(err error) bool { return errors.Is(err, sfu.ErrSessionGone) }},
		{"ほかの失敗は errorCode を持つ", http.StatusBadRequest, `{"errorCode":"invalid_request","errorDescription":"bad sdp"}`, func(err error) bool {
			var e *sfu.APIError
			return errors.As(err, &e) && e.Status == http.StatusBadRequest && e.Code == "invalid_request"
		}},
		{"本文が JSON でなくても失敗にする", http.StatusBadGateway, `<html>`, func(err error) bool {
			var e *sfu.APIError
			return errors.As(err, &e) && e.Status == http.StatusBadGateway
		}},
		{"200 でも最上位の errorCode は失敗", http.StatusOK, `{"errorCode":"internal_error"}`, func(err error) bool {
			var e *sfu.APIError
			return errors.As(err, &e) && e.Code == "internal_error"
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := fakeCloudflare(t, tt.status, tt.response)

			err := c.Renegotiate(context.Background(), "s-1", sfu.SessionDescription{Type: "answer"})
			if err == nil || !tt.check(err) {
				t.Errorf("err = %v", err)
			}
		})
	}
}

// Error の文言に Cloudflare の説明（SDP の断片が入ることがある）を載せない（ADR 0066 決定 16）。
func TestAPIErrorMessageOmitsDescription(t *testing.T) {
	err := &sfu.APIError{Status: 400, Code: "invalid_request", Description: "a=candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host"}
	if got := err.Error(); got != "sfu: status 400 (invalid_request)" {
		t.Errorf("Error() = %q", got)
	}
}

func assertJSON(t *testing.T, got, want map[string]any) {
	t.Helper()
	g, _ := json.Marshal(got, json.Deterministic(true))
	w, _ := json.Marshal(want, json.Deterministic(true))
	if string(g) != string(w) {
		t.Errorf("request body = %s, want %s", g, w)
	}
}
