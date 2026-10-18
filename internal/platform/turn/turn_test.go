package turn_test

import (
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/turn"
)

type recorded struct {
	path, auth string
	body       map[string]any
}

func fakeCloudflare(t *testing.T, status int, response string) (*turn.Client, *recorded) {
	t.Helper()
	got := &recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		got.path, got.auth = r.URL.EscapedPath(), r.Header.Get("Authorization")
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			_ = json.Unmarshal(b, &got.body)
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, response)
	}))
	t.Cleanup(srv.Close)
	c, err := turn.New(turn.Config{KeyID: "key-1", APIToken: "token-1", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	return c, got
}

// Cloudflare のドキュメントにある応答の形。ポート 53 の URL が混ざっている。
const generated = `{"iceServers":[
	{"urls":["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]},
	{"urls":[
		"turn:turn.cloudflare.com:3478?transport=udp",
		"turn:turn.cloudflare.com:53?transport=udp",
		"turn:turn.cloudflare.com:3478?transport=tcp",
		"turns:turn.cloudflare.com:5349?transport=tcp",
		"turns:turn.cloudflare.com:443?transport=tcp"
	],"username":"user-1","credential":"cred-1"}
]}`

func TestGenerate(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusCreated, generated)
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)

	creds, err := c.Generate(context.Background(), 12*time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.path != "/turn/keys/key-1/credentials/generate-ice-servers" || got.auth != "Bearer token-1" {
		t.Errorf("request = %s (%s)", got.path, got.auth)
	}
	if got.body["ttl"] != float64(12*60*60) {
		t.Errorf("ttl = %v", got.body["ttl"])
	}
	// ポート 53 の URL は、ブラウザが弾くので取り除く
	want := []turn.ICEServer{
		{URLs: []string{"stun:stun.cloudflare.com:3478"}},
		{URLs: []string{
			"turn:turn.cloudflare.com:3478?transport=udp",
			"turn:turn.cloudflare.com:3478?transport=tcp",
			"turns:turn.cloudflare.com:5349?transport=tcp",
			"turns:turn.cloudflare.com:443?transport=tcp",
		}, Username: "user-1", Credential: "cred-1"},
	}
	if !reflect.DeepEqual(creds.ICEServers, want) {
		t.Errorf("ice servers = %+v", creds.ICEServers)
	}
	if creds.Username != "user-1" || !creds.ExpiresAt.Equal(now.Add(12*time.Hour)) {
		t.Errorf("creds = %+v", creds)
	}
}

func TestGenerateRejectsTTL(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusCreated, generated)

	for _, ttl := range []time.Duration{0, -time.Second, turn.MaxTTL + time.Second} {
		if _, err := c.Generate(context.Background(), ttl, time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)); err == nil {
			t.Errorf("ttl %s was accepted", ttl)
		}
	}
	if got.path != "" {
		t.Errorf("sent a request: %s", got.path)
	}
}

func TestGenerateFailure(t *testing.T) {
	c, _ := fakeCloudflare(t, http.StatusUnauthorized, `{"error":"unauthorized"}`)

	_, err := c.Generate(context.Background(), time.Hour, time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC))
	var status *turn.StatusError
	if !errors.As(err, &status) || status.Code != http.StatusUnauthorized {
		t.Errorf("err = %v", err)
	}
}

func TestRevoke(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusNoContent, ``)

	if err := c.Revoke(context.Background(), "user-1"); err != nil {
		t.Fatal(err)
	}
	if got.path != "/turn/keys/key-1/credentials/user-1/revoke" {
		t.Errorf("path = %s", got.path)
	}
}

func TestRevokeWithoutUsernameDoesNothing(t *testing.T) {
	c, got := fakeCloudflare(t, http.StatusNoContent, ``)

	if err := c.Revoke(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	if got.path != "" {
		t.Errorf("sent a request: %s", got.path)
	}
}
