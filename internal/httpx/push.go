package httpx

import (
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// プッシュ通知の設定と購読（ADR 0069 決定 4）。
//
// 購読はいまのセッション（Access Token の sid）に結び付ける。パスの me/push-subscription が単数なのは、
// 1 つのセッションに購読が 1 つだから（決定 3）。ほかの端末の購読は一覧の ID で止める。

// pushConfigResponse はブラウザが購読を作るのに要る設定。
type pushConfigResponse struct {
	// Enabled が false なら、サーバーに VAPID の鍵がない。画面はスイッチを出さない（決定 9）。
	Enabled bool `json:"enabled"`
	// VAPIDPublicKey は pushManager.subscribe の applicationServerKey（base64url、詰め物なし）。無効なら省く。
	VAPIDPublicKey string `json:"vapid_public_key,omitzero"`
}

func (h *chatHandlers) getPushConfig(w http.ResponseWriter, _ *http.Request) {
	c := h.svc.PushConfig()
	writeJSON(w, http.StatusOK, pushConfigResponse{Enabled: c.Enabled, VAPIDPublicKey: c.VAPIDPublicKey})
}

// pushSubscriptionRequest はブラウザの PushSubscription.toJSON() と同じ形。
// toJSON() にある expirationTime は読まない（主要なブラウザは null を返し、期限切れは送ったときの 404 / 410 で分かる。決定 8）。
type pushSubscriptionRequest struct {
	Endpoint string               `json:"endpoint"`
	Keys     pushSubscriptionKeys `json:"keys"`
}

// pushSubscriptionKeys は受け手の鍵。どちらも base64url。
type pushSubscriptionKeys struct {
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
}

// pushSubscriptionResponse は購読の 1 行。endpoint と鍵は返さない（endpoint はそれだけで送れる宛先なので、トークンと同じ扱い）。
// user_agent は保存したまま返し、「Chrome · macOS」のような端末の名前はクライアントが作る（ログイン中のデバイスと同じ。ADR 0019）。
type pushSubscriptionResponse struct {
	ID        string    `json:"id"`
	UserAgent string    `json:"user_agent"`
	IsCurrent bool      `json:"is_current"`
	CreatedAt time.Time `json:"created_at"`
}

type pushSubscriptionListResponse struct {
	Subscriptions []pushSubscriptionResponse `json:"subscriptions"`
}

func toPushSubscriptionResponse(s chat.PushSubscription) pushSubscriptionResponse {
	return pushSubscriptionResponse{ID: s.ID.String(), UserAgent: s.UserAgent, IsCurrent: s.Current, CreatedAt: s.CreatedAt}
}

func (h *chatHandlers) putPushSubscription(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	var req pushSubscriptionRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	sub, err := h.svc.RegisterPushSubscription(r.Context(), id.UserID, id.SessionID, chat.PushSubscriptionInput{
		Endpoint:  req.Endpoint,
		P256dh:    req.Keys.P256dh,
		Auth:      req.Keys.Auth,
		UserAgent: r.UserAgent(),
	})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toPushSubscriptionResponse(sub))
}

func (h *chatHandlers) deleteCurrentPushSubscription(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	if err := h.svc.RemoveCurrentPushSubscription(r.Context(), id.UserID, id.SessionID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *chatHandlers) listPushSubscriptions(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	subs, err := h.svc.ListPushSubscriptions(r.Context(), id.UserID, id.SessionID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	out := make([]pushSubscriptionResponse, len(subs))
	for i, s := range subs {
		out[i] = toPushSubscriptionResponse(s)
	}
	writeJSON(w, http.StatusOK, pushSubscriptionListResponse{Subscriptions: out})
}

func (h *chatHandlers) deletePushSubscription(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	// 読めない ID は、存在しない購読と同じく 404 にする（ほかの人の購読があるかどうかを明かさない）。
	subscriptionID, err := ulid.ParseStrict(r.PathValue("subscriptionID"))
	if err != nil {
		writeError(h.logger, w, r, chat.ErrNotFound)
		return
	}
	if err := h.svc.RemovePushSubscription(r.Context(), id.UserID, subscriptionID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
