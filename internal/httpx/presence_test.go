package httpx_test

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// 離席とカスタムステータスの API（ロードマップ Phase 6.8 / ADR 0049）。

type statusBody struct {
	Emoji     string  `json:"emoji"`
	Text      string  `json:"text"`
	ExpiresAt *string `json:"expires_at"`
}

type presenceMemberBody struct {
	User struct {
		ID string `json:"id"`
	} `json:"user"`
	Presence string      `json:"presence"`
	Away     bool        `json:"away"`
	Status   *statusBody `json:"status"`
}

type presenceMemberListBody struct {
	Members []presenceMemberBody `json:"members"`
}

// memberIn はワークスペースのメンバー一覧から 1 人を取る。
func memberIn(t *testing.T, c *apiClient, viewer apiUser, workspaceID, userID string) presenceMemberBody {
	t.Helper()
	r := c.as(viewer, http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/members", nil)
	expectStatus(t, r, http.StatusOK)
	for _, m := range decode[presenceMemberListBody](t, r).Members {
		if m.User.ID == userID {
			return m
		}
	}
	t.Fatalf("%s はメンバー一覧に居ない", userID)
	return presenceMemberBody{}
}

func TestPresenceAndStatusAPI(t *testing.T) {
	c := newAPI(t)
	owner, alice := c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)

	t.Run("既定は presence offline / away false / status null", func(t *testing.T) {
		m := memberIn(t, c, owner, ws.ID, alice.id)
		if m.Presence != "offline" || m.Away || m.Status != nil {
			t.Errorf("member = %+v, want offline / away false / status null", m)
		}
	})

	t.Run("手動の離席を設定・解除できる（冪等）", func(t *testing.T) {
		r := c.as(alice, http.MethodPut, "/api/v1/users/me/presence", map[string]bool{"away": true})
		expectStatus(t, r, http.StatusOK)
		if got := decode[struct {
			Away bool `json:"away"`
		}](t, r); !got.Away {
			t.Errorf("away = false, want true")
		}
		if m := memberIn(t, c, owner, ws.ID, alice.id); !m.Away {
			t.Errorf("メンバー一覧の away = false, want true")
		}
		// 自動の presence は別の事実のまま（接続していないので offline）
		if m := memberIn(t, c, owner, ws.ID, alice.id); m.Presence != "offline" {
			t.Errorf("presence = %s, want offline", m.Presence)
		}

		expectStatus(t, c.as(alice, http.MethodPut, "/api/v1/users/me/presence", map[string]bool{"away": false}), http.StatusOK)
		expectStatus(t, c.as(alice, http.MethodPut, "/api/v1/users/me/presence", map[string]bool{"away": false}), http.StatusOK)
		if m := memberIn(t, c, owner, ws.ID, alice.id); m.Away {
			t.Errorf("解除後の away = true, want false")
		}
	})

	t.Run("カスタムステータスを設定・解除できる", func(t *testing.T) {
		expires := c.env.Clock.Now().Add(time.Hour).UTC().Format(time.RFC3339)
		r := c.as(alice, http.MethodPut, "/api/v1/workspaces/"+ws.ID+"/me/status",
			map[string]any{"emoji": "🍵", "text": " 休憩中 ", "expires_at": expires})
		expectStatus(t, r, http.StatusOK)
		if got := decode[statusBody](t, r); got.Emoji != "🍵" || got.Text != "休憩中" || got.ExpiresAt == nil {
			// 文言の前後の空白は落とす
			t.Errorf("status = %+v, want 🍵 休憩中（期限つき）", got)
		}
		m := memberIn(t, c, owner, ws.ID, alice.id)
		if m.Status == nil || m.Status.Emoji != "🍵" || m.Status.Text != "休憩中" {
			t.Errorf("メンバー一覧の status = %+v, want 🍵 休憩中", m.Status)
		}

		expectStatus(t, c.as(alice, http.MethodDelete, "/api/v1/workspaces/"+ws.ID+"/me/status", nil), http.StatusNoContent)
		// 設定していなくても 204（冪等）
		expectStatus(t, c.as(alice, http.MethodDelete, "/api/v1/workspaces/"+ws.ID+"/me/status", nil), http.StatusNoContent)
		if m := memberIn(t, c, owner, ws.ID, alice.id); m.Status != nil {
			t.Errorf("解除後の status = %+v, want null", m.Status)
		}
	})

	t.Run("ステータスはワークスペースごと", func(t *testing.T) {
		r := c.as(alice, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "個人メモ"})
		expectStatus(t, r, http.StatusCreated)
		other := decode[workspaceBody](t, r)

		expectStatus(t, c.as(alice, http.MethodPut, "/api/v1/workspaces/"+ws.ID+"/me/status",
			map[string]any{"emoji": "🌴", "text": "休暇中"}), http.StatusOK)

		if m := memberIn(t, c, alice, other.ID, alice.id); m.Status != nil {
			t.Errorf("別のワークスペースの status = %+v, want null", m.Status)
		}
	})

	t.Run("受け付けない値は 422", func(t *testing.T) {
		past := c.env.Clock.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
		for name, body := range map[string]map[string]any{
			"絵文字なし":   {"text": "休憩中"},
			"絵文字でない":  {"emoji": "a"},
			"文言が長すぎる": {"emoji": "🍵", "text": strings.Repeat("あ", 101)},
			"過ぎた期限":   {"emoji": "🍵", "expires_at": past},
		} {
			t.Run(name, func(t *testing.T) {
				r := c.as(alice, http.MethodPut, "/api/v1/workspaces/"+ws.ID+"/me/status", body)
				expectStatus(t, r, http.StatusUnprocessableEntity)
			})
		}
	})

	t.Run("メンバーでないワークスペースには設定できない（404）", func(t *testing.T) {
		outsider := c.registerUser()
		expectStatus(t, c.as(outsider, http.MethodPut, "/api/v1/workspaces/"+ws.ID+"/me/status",
			map[string]any{"emoji": "🍵"}), http.StatusNotFound)
		expectStatus(t, c.as(outsider, http.MethodDelete, "/api/v1/workspaces/"+ws.ID+"/me/status", nil), http.StatusNotFound)
	})

	t.Run("ログインしていなければ 401", func(t *testing.T) {
		expectStatus(t, c.do(request{method: http.MethodPut, path: "/api/v1/users/me/presence", body: map[string]bool{"away": true}}), http.StatusUnauthorized)
	})
}
