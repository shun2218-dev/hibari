package httpx_test

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// プッシュ通知の設定と購読の API（ADR 0069 決定 4）。

type pushConfigBody struct {
	Enabled        bool    `json:"enabled"`
	VAPIDPublicKey *string `json:"vapid_public_key"`
}

type pushSubscriptionBody struct {
	ID        string `json:"id"`
	UserAgent string `json:"user_agent"`
	IsCurrent bool   `json:"is_current"`
	CreatedAt string `json:"created_at"`
}

type pushSubscriptionsBody struct {
	Subscriptions []pushSubscriptionBody `json:"subscriptions"`
}

// pushSubscriptionJSON はブラウザの PushSubscription.toJSON() と同じ形の本文（expirationTime も付ける。読まずに捨てる）。
func pushSubscriptionJSON(t *testing.T) map[string]any {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	return map[string]any{
		"endpoint":       "https://updates.push.services.mozilla.com/wpush/v2/" + ulid.Make().String(),
		"expirationTime": nil,
		"keys": map[string]string{
			"p256dh": base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
			"auth":   base64.RawURLEncoding.EncodeToString(auth),
		},
	}
}

func TestPushConfigAPI(t *testing.T) {
	t.Run("鍵があれば公開鍵を返す", func(t *testing.T) {
		c := newAPI(t)
		r := c.as(c.registerUser(), http.MethodGet, "/api/v1/push/config", nil)
		expectStatus(t, r, http.StatusOK)
		got := decode[pushConfigBody](t, r)
		if !got.Enabled || got.VAPIDPublicKey == nil || *got.VAPIDPublicKey != chattest.VAPIDPublicKey {
			t.Errorf("body = %s", r.body)
		}
	})

	t.Run("鍵がなければ enabled: false だけ。購読の登録は 503", func(t *testing.T) {
		c := newAPI(t, withoutPush())
		u := c.registerUser()
		r := c.as(u, http.MethodGet, "/api/v1/push/config", nil)
		expectStatus(t, r, http.StatusOK)
		if got := strings.TrimSpace(string(r.body)); got != `{"enabled":false}` {
			t.Errorf("body = %s", got)
		}
		expectStatus(t, c.as(u, http.MethodPut, "/api/v1/me/push-subscription", pushSubscriptionJSON(t)), http.StatusServiceUnavailable)
	})
}

func TestPushSubscriptionAPI(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg, headers: map[string]string{"User-Agent": "Chrome"}})
	expectStatus(t, r, http.StatusCreated)
	laptop := bearer(decode[tokenBody](t, r).AccessToken)
	phone := bearer(login(t, c, reg, "Safari").AccessToken)
	other := c.registerUser()

	put := func(h map[string]string, b any) response {
		return c.do(request{method: http.MethodPut, path: "/api/v1/me/push-subscription", body: b, headers: h})
	}
	list := func(h map[string]string) pushSubscriptionsBody {
		t.Helper()
		r := c.do(request{method: http.MethodGet, path: "/api/v1/me/push-subscriptions", headers: h})
		expectStatus(t, r, http.StatusOK)
		return decode[pushSubscriptionsBody](t, r)
	}

	// User-Agent はログインのときのものではなく、登録のリクエストのものを残す
	laptopHeaders := map[string]string{"Authorization": laptop["Authorization"], "User-Agent": "Chrome on macOS"}
	r = put(laptopHeaders, pushSubscriptionJSON(t))
	expectStatus(t, r, http.StatusOK)
	mine := decode[pushSubscriptionBody](t, r)
	if !mine.IsCurrent || mine.UserAgent != "Chrome on macOS" || mine.ID == "" {
		t.Fatalf("PUT = %s", r.body)
	}
	// 応答に endpoint と鍵を含めない（endpoint はそれだけで送れる宛先）
	if strings.Contains(string(r.body), "endpoint") || strings.Contains(string(r.body), "p256dh") {
		t.Errorf("PUT の応答に endpoint か鍵がある: %s", r.body)
	}

	r = put(phone, pushSubscriptionJSON(t))
	expectStatus(t, r, http.StatusOK)
	phoneSub := decode[pushSubscriptionBody](t, r)

	t.Run("一覧は自分の購読だけで、いまのセッションに印が付く", func(t *testing.T) {
		got := list(laptop)
		if len(got.Subscriptions) != 2 {
			t.Fatalf("subscriptions = %+v", got.Subscriptions)
		}
		for _, s := range got.Subscriptions {
			if s.IsCurrent != (s.ID == mine.ID) {
				t.Errorf("%+v: is_current が違う", s)
			}
		}
		if n := len(list(bearer(other.token)).Subscriptions); n != 0 {
			t.Errorf("ほかの人の一覧 = %d 件, want 0", n)
		}
	})

	t.Run("入力の誤りは 422 で、項目を返す", func(t *testing.T) {
		b := pushSubscriptionJSON(t)
		b["endpoint"] = "https://example.com/push"
		r := put(laptop, b)
		expectStatus(t, r, http.StatusUnprocessableEntity)
		if !strings.Contains(string(r.body), `"field":"endpoint"`) {
			t.Errorf("body = %s", r.body)
		}
		b = pushSubscriptionJSON(t)
		b["keys"] = map[string]string{"p256dh": "", "auth": "x"}
		r = put(laptop, b)
		expectStatus(t, r, http.StatusUnprocessableEntity)
		if !strings.Contains(string(r.body), `"field":"keys.p256dh"`) || !strings.Contains(string(r.body), `"field":"keys.auth"`) {
			t.Errorf("body = %s", r.body)
		}
	})

	t.Run("ほかの人の購読の ID と、読めない ID は 404", func(t *testing.T) {
		expectStatus(t, c.as(other, http.MethodDelete, "/api/v1/me/push-subscriptions/"+phoneSub.ID, nil), http.StatusNotFound)
		expectStatus(t, c.as(other, http.MethodDelete, "/api/v1/me/push-subscriptions/not-an-id", nil), http.StatusNotFound)
		if n := len(list(laptop).Subscriptions); n != 2 {
			t.Errorf("subscriptions = %d, want 2（消えていない）", n)
		}
	})

	t.Run("ほかの端末の購読を止める。ログインのセッションは残る", func(t *testing.T) {
		r := c.do(request{method: http.MethodDelete, path: "/api/v1/me/push-subscriptions/" + phoneSub.ID, headers: laptop})
		expectStatus(t, r, http.StatusNoContent)
		got := list(phone)
		if len(got.Subscriptions) != 1 || got.Subscriptions[0].ID != mine.ID {
			t.Errorf("subscriptions = %+v, want laptop だけ", got.Subscriptions)
		}
	})

	t.Run("いまのセッションの購読を消す。なくても 204", func(t *testing.T) {
		for range 2 {
			r := c.do(request{method: http.MethodDelete, path: "/api/v1/me/push-subscription", headers: laptop})
			expectStatus(t, r, http.StatusNoContent)
		}
		if n := len(list(laptop).Subscriptions); n != 0 {
			t.Errorf("subscriptions = %d, want 0", n)
		}
	})

	t.Run("認証がなければ 401", func(t *testing.T) {
		expectStatus(t, c.do(request{method: http.MethodGet, path: "/api/v1/me/push-subscriptions"}), http.StatusUnauthorized)
		expectStatus(t, c.do(request{method: http.MethodPut, path: "/api/v1/me/push-subscription", body: pushSubscriptionJSON(t)}), http.StatusUnauthorized)
	})
}
