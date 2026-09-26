package huddle_test

import (
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/huddle"
	"github.com/shun2218-dev/hibari/internal/platform/sfu"
	"github.com/shun2218-dev/hibari/internal/platform/turn"
)

// fakeCloudflare は、パスごとに決まった応答を返す偽の SFU。受け取った要求を記録する。
type fakeCloudflare struct {
	mu        sync.Mutex
	responses map[string]response
	requests  []string
	bodies    map[string]map[string]any
}

type response struct {
	status int
	body   string
}

func newMedia(t *testing.T, responses map[string]response) (huddle.Media, *fakeCloudflare) {
	t.Helper()
	f := &fakeCloudflare{responses: responses, bodies: map[string]map[string]any{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		f.mu.Lock()
		f.requests = append(f.requests, key)
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			var body map[string]any
			_ = json.Unmarshal(b, &body)
			f.bodies[key] = body
		}
		res, ok := f.responses[key]
		f.mu.Unlock()
		if !ok {
			t.Errorf("unexpected request %s", key)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(res.status)
		_, _ = io.WriteString(w, res.body)
	}))
	t.Cleanup(srv.Close)
	s, err := sfu.New(sfu.Config{AppID: "app", AppSecret: "secret", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	tr, err := turn.New(turn.Config{KeyID: "key", APIToken: "token", BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	return huddle.Media{SFU: s, TURN: tr}, f
}

func TestMediaPublish(t *testing.T) {
	m, f := newMedia(t, map[string]response{
		"POST /apps/app/sessions/new":           {http.StatusCreated, `{"sessionId":"s-1"}`},
		"POST /apps/app/sessions/s-1/tracks/new": {http.StatusOK, `{"tracks":[{"trackName":"audio","mid":"0"}],"sessionDescription":{"type":"answer","sdp":"v=0 a"}}`},
	})

	session, answer, err := m.Publish(context.Background(), chat.SessionDescription{Type: "offer", SDP: "v=0 o"}, "0", "audio")
	if err != nil {
		t.Fatal(err)
	}
	if session != "s-1" || answer != (chat.SessionDescription{Type: "answer", SDP: "v=0 a"}) {
		t.Errorf("Publish = %s, %+v", session, answer)
	}
	tracks := f.bodies["POST /apps/app/sessions/s-1/tracks/new"]["tracks"].([]any)
	if tracks[0].(map[string]any)["location"] != "local" || tracks[0].(map[string]any)["mid"] != "0" {
		t.Errorf("tracks = %v", tracks)
	}
}

// mids を渡さなければ、セッションのトラックを読んで全部を閉じる（外すとき。ADR 0066 決定 8）。
func TestMediaCloseAll(t *testing.T) {
	m, f := newMedia(t, map[string]response{
		"GET /apps/app/sessions/s-1":              {http.StatusOK, `{"tracks":[{"mid":"0","status":"active"},{"mid":"1","status":"active"}]}`},
		"PUT /apps/app/sessions/s-1/tracks/close": {http.StatusOK, `{}`},
	})

	if err := m.Close(context.Background(), "s-1", nil); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(f.requests, []string{"GET /apps/app/sessions/s-1", "PUT /apps/app/sessions/s-1/tracks/close"}) {
		t.Errorf("requests = %v", f.requests)
	}
	closed := f.bodies["PUT /apps/app/sessions/s-1/tracks/close"]["tracks"].([]any)
	if len(closed) != 2 {
		t.Errorf("closed = %v", closed)
	}
}

// 接続が切れて消えたセッションは、閉じるものもないので成功にする。
func TestMediaCloseGoneSession(t *testing.T) {
	m, _ := newMedia(t, map[string]response{
		"GET /apps/app/sessions/s-1": {http.StatusGone, `{"errorCode":"session_error"}`},
	})

	if err := m.Close(context.Background(), "s-1", nil); err != nil {
		t.Errorf("Close = %v", err)
	}
}

// 同じセッションへの変更が重なったら（406）、chat の ErrHuddleNegotiationConflict にする（決定 4）。
func TestMediaConflict(t *testing.T) {
	m, _ := newMedia(t, map[string]response{
		"PUT /apps/app/sessions/s-1/renegotiate": {http.StatusNotAcceptable, `{}`},
	})

	err := m.Renegotiate(context.Background(), "s-1", chat.SessionDescription{Type: "answer", SDP: "v=0"})
	if !errors.Is(err, chat.ErrHuddleNegotiationConflict) {
		t.Errorf("err = %v", err)
	}
}

func TestMediaSubscribe(t *testing.T) {
	m, _ := newMedia(t, map[string]response{
		"POST /apps/app/sessions/s-1/tracks/new": {http.StatusOK, `{
			"requiresImmediateRenegotiation": true,
			"tracks": [{"trackName":"audio","sessionId":"s-2","mid":"1"},{"trackName":"audio","sessionId":"s-3","errorCode":"not_found"}],
			"sessionDescription": {"type":"offer","sdp":"v=0 pull"}
		}`},
	})

	res, err := m.Subscribe(context.Background(), "s-1", []chat.RemoteTrack{{SessionID: "s-2", TrackName: "audio"}, {SessionID: "s-3", TrackName: "audio"}})
	if err != nil {
		t.Fatal(err)
	}
	want := []chat.SubscribedTrack{{SessionID: "s-2", Mid: "1", OK: true}, {SessionID: "s-3", OK: false}}
	if res.Offer == nil || res.Offer.SDP != "v=0 pull" || !slices.Equal(res.Tracks, want) {
		t.Errorf("Subscribe = %+v", res)
	}
}
