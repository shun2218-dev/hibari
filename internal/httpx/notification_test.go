package httpx_test

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// 通知の設定の API（ロードマップ Phase 6.14a / ADR 0055 決定 4・5）。

type roomNotificationsBody struct {
	Level      *string    `json:"level"`
	Muted      bool       `json:"muted"`
	MutedUntil *time.Time `json:"muted_until"`
}

type roomWithNotificationsBody struct {
	ID            string                 `json:"id"`
	Notifications *roomNotificationsBody `json:"notifications"`
}

func TestNotificationLevelAPI(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	outsider := c.registerUser()
	path := "/api/v1/workspaces/" + f.ws.ID + "/me/notifications"

	t.Run("未設定なら mentions", func(t *testing.T) {
		r := c.as(f.bob, http.MethodGet, path, nil)
		expectStatus(t, r, http.StatusOK)
		if got := strings.TrimSpace(string(r.body)); got != `{"level":"mentions"}` {
			t.Errorf("body = %s", got)
		}
	})

	t.Run("PUT で変えて、GET で読める", func(t *testing.T) {
		expectStatus(t, c.as(f.bob, http.MethodPut, path, map[string]string{"level": "none"}), http.StatusOK)
		r := c.as(f.bob, http.MethodGet, path, nil)
		expectStatus(t, r, http.StatusOK)
		if got := strings.TrimSpace(string(r.body)); got != `{"level":"none"}` {
			t.Errorf("body = %s", got)
		}
	})

	t.Run("知らない値は 422", func(t *testing.T) {
		expectStatus(t, c.as(f.bob, http.MethodPut, path, map[string]string{"level": "loud"}), http.StatusUnprocessableEntity)
	})

	t.Run("メンバーでなければ 404（存在を明かさない）", func(t *testing.T) {
		expectStatus(t, c.as(outsider, http.MethodGet, path, nil), http.StatusNotFound)
		expectStatus(t, c.as(outsider, http.MethodPut, path, map[string]string{"level": "all"}), http.StatusNotFound)
	})
}

func TestRoomNotificationsAPI(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	outsider := c.registerUser()
	publicPath := "/api/v1/rooms/" + f.public.ID + "/me/notifications"
	until := c.env.Clock.Now().Add(time.Hour).UTC().Truncate(time.Second)

	t.Run("PUT で置き換え、ルームの 1 件と一覧に載る", func(t *testing.T) {
		r := c.as(f.bob, http.MethodPut, publicPath, map[string]any{"level": "all", "muted": true, "muted_until": until})
		expectStatus(t, r, http.StatusOK)
		got := decode[roomNotificationsBody](t, r)
		if got.Level == nil || *got.Level != "all" || !got.Muted || got.MutedUntil == nil || !got.MutedUntil.Equal(until) {
			t.Fatalf("body = %s", r.body)
		}

		r = c.as(f.bob, http.MethodGet, "/api/v1/rooms/"+f.public.ID, nil)
		expectStatus(t, r, http.StatusOK)
		if one := decode[roomWithNotificationsBody](t, r); one.Notifications == nil || !one.Notifications.Muted {
			t.Errorf("GET /rooms/{id} = %s", r.body)
		}
		if n := roomNotificationsIn(t, c, f.bob, f.ws.ID, f.public.ID); n == nil || !n.Muted {
			t.Errorf("一覧の notifications = %+v", n)
		}
	})

	t.Run("参加していない public ルームは notifications が null で、PUT は 403", func(t *testing.T) {
		if n := roomNotificationsIn(t, c, f.owner, f.ws.ID, f.public.ID); n != nil {
			t.Errorf("notifications = %+v, want null", n)
		}
		expectStatus(t, c.as(f.owner, http.MethodPut, publicPath, map[string]any{"muted": true}), http.StatusForbidden)
	})

	t.Run("読めないルームは 404", func(t *testing.T) {
		expectStatus(t, c.as(outsider, http.MethodPut, "/api/v1/rooms/"+f.private.ID+"/me/notifications", map[string]any{"muted": true}),
			http.StatusNotFound)
	})

	t.Run("組み合わせが合わなければ 422", func(t *testing.T) {
		past := c.env.Clock.Now().Add(-time.Minute)
		for _, body := range []map[string]any{
			{"level": "none"},
			{"muted": false, "muted_until": until},
			{"muted": true, "muted_until": past},
		} {
			expectStatus(t, c.as(f.bob, http.MethodPut, publicPath, body), http.StatusUnprocessableEntity)
		}
	})

	t.Run("DM は level を受け付けず、ミュートだけならできる", func(t *testing.T) {
		r := c.as(f.bob, http.MethodPost, "/api/v1/workspaces/"+f.ws.ID+"/rooms", map[string]string{"kind": "dm", "user_id": f.alice.id})
		expectStatus(t, r, http.StatusCreated)
		dm := decode[roomBody](t, r)
		dmPath := "/api/v1/rooms/" + dm.ID + "/me/notifications"
		expectStatus(t, c.as(f.bob, http.MethodPut, dmPath, map[string]any{"level": "all"}), http.StatusUnprocessableEntity)
		expectStatus(t, c.as(f.bob, http.MethodPut, dmPath, map[string]any{"level": nil, "muted": true}), http.StatusOK)
	})
}

// 設定は本人だけの状態なので、本人のほかの接続にだけ届く（別のタブをそろえる。ADR 0055 決定 5）。
func TestWSNotificationEvents(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	otherTab := c.dialWS(f.bob)
	otherTab.sync()
	alice := c.dialWS(f.alice)
	alice.subscribe("room_id", f.public.ID)
	alice.subscribe("workspace_id", f.ws.ID)
	alice.sync()

	expectStatus(t, c.as(f.bob, http.MethodPut, "/api/v1/workspaces/"+f.ws.ID+"/me/notifications", map[string]string{"level": "all"}),
		http.StatusOK)
	expectStatus(t, c.as(f.bob, http.MethodPut, "/api/v1/rooms/"+f.public.ID+"/me/notifications", map[string]any{"muted": true}),
		http.StatusOK)

	got := otherTab.sync()
	if ev := eventsOfType(got, "notifications.updated"); len(ev) != 1 ||
		string(ev[0].Data) != `{"workspace_id":"`+f.ws.ID+`","level":"all"}` {
		t.Errorf("notifications.updated = %v", ev)
	}
	if ev := eventsOfType(got, "room.notifications_updated"); len(ev) != 1 ||
		string(ev[0].Data) != `{"workspace_id":"`+f.ws.ID+`","room_id":"`+f.public.ID+`","level":null,"muted":true,"muted_until":null}` {
		t.Errorf("room.notifications_updated = %v", ev)
	}

	// 同じルームとワークスペースを購読していても、ほかの人には届かない
	others := alice.sync()
	if n := len(eventsOfType(others, "notifications.updated")) + len(eventsOfType(others, "room.notifications_updated")); n != 0 {
		t.Errorf("alice に %d 件届いた, want 0", n)
	}
}

// roomNotificationsIn はルームの一覧から、そのルームの notifications を取り出す。
func roomNotificationsIn(t *testing.T, c *apiClient, u apiUser, workspaceID, roomID string) *roomNotificationsBody {
	t.Helper()
	r := c.as(u, http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/rooms", nil)
	expectStatus(t, r, http.StatusOK)
	list := decode[struct {
		Rooms []roomWithNotificationsBody `json:"rooms"`
	}](t, r)
	for _, room := range list.Rooms {
		if room.ID == roomID {
			return room.Notifications
		}
	}
	t.Fatalf("room %s が一覧にない: %s", roomID, r.body)
	return nil
}
