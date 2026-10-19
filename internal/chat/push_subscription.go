package chat

import (
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/webpush"
)

// プッシュ通知の購読（ADR 0069 決定 3・4）。
//
// 購読はログインのセッション（sid）に結び付ける。ブラウザがログインを持つ単位と、プッシュを受ける単位がどちらもブラウザなので、
// 新しい「端末」の概念を作らずに、失効の仕組み（auth:revoked。ADR 0007）でログアウトした端末への配信を止められる。
// sid は authn が検証した Access Token から受け取るだけで、chat は auth を import しない（ADR 0001）。

// ErrPushUnavailable は、VAPID の鍵が設定されていなくてプッシュ通知が無効になっていることを表す（ADR 0069 決定 9）。
var ErrPushUnavailable = errors.New("chat: push notifications are unavailable")

// PushDeps はプッシュ通知の依存。VAPIDPublicKey が空ならプッシュ通知は無効。
type PushDeps struct {
	// VAPIDPublicKey は VAPID の公開鍵（base64url、詰め物なし）。ブラウザの pushManager.subscribe の applicationServerKey に渡す。
	VAPIDPublicKey string
	// Sender は通知を送る（*webpush.Sender）。nil なら購読の API だけが動き、送らない（購読の API のテスト）。
	Sender PushSender
	// Sessions は、送る直前に購読のセッション（sid）がまだ有効かを確かめる（決定 3）。
	// chat は auth を import しないので、authn のインターフェースとして main で配線する（ADR 0001）。
	Sessions authn.SessionChecker
}

// PushConfig はブラウザが購読を作るのに要る設定（GET /api/v1/push/config）。
type PushConfig struct {
	Enabled        bool
	VAPIDPublicKey string
}

// PushSubscriptionInput はブラウザの PushSubscription.toJSON() のうち、送るのに要るもの。
type PushSubscriptionInput struct {
	Endpoint string
	// P256dh と Auth は base64url（ブラウザの toJSON() の形）。
	P256dh string
	Auth   string
	// UserAgent はリクエストの User-Agent。設定の「通知を受け取る端末」の名前を作るのに使う。
	UserAgent string
}

// PushSubscription は購読の 1 行。endpoint と鍵は返さない。endpoint はそれだけで購読者に送れる宛先なので、トークンと同じ扱いにする。
type PushSubscription struct {
	ID ulid.ULID
	// UserAgent は登録したときの User-Agent。空ならなし。「Chrome · macOS」のような表示はクライアントが作る（ADR 0019 と同じ）。
	UserAgent string
	// Current は、いまのセッションの購読であること。
	Current   bool
	CreatedAt time.Time
}

// pushKindWebPush は push_subscriptions.kind の値。APNs / FCM を足すときに値を足す（ADR 0069 決定 1）。
const pushKindWebPush = "webpush"

// pushUserAgentMaxBytes は保存する User-Agent の上限。ブラウザの User-Agent は数百バイトに収まる。
// refresh_tokens.user_agent と同じく、際限のない文字列を DB に入れない。
const pushUserAgentMaxBytes = 512

const (
	// p256dhLen は受け手の公開鍵（P-256 の非圧縮の点）の長さ（RFC 8291 の 3.1）。
	p256dhLen = 65
	// pushAuthLen は受け手と共有する秘密の長さ（RFC 8291 の 3.2）。
	pushAuthLen = 16
)

func (s *Service) pushEnabled() bool { return s.push.VAPIDPublicKey != "" }

// PushConfig はプッシュ通知の設定を返す。無効なら Enabled が false で、画面はスイッチを出さない（ADR 0069 決定 9）。
func (s *Service) PushConfig() PushConfig {
	return PushConfig{Enabled: s.pushEnabled(), VAPIDPublicKey: s.push.VAPIDPublicKey}
}

// RegisterPushSubscription は sid のセッションの購読を登録する（冪等）。
//
// ブラウザは endpoint を変えることがあり、Service Worker はトークンを持たないので API を呼べない。
// そのため Web はページを開くたびにいまの購読を PUT し直す（ADR 0069 決定 4）。同じ内容なら何も変わらない。
func (s *Service) RegisterPushSubscription(ctx context.Context, actor, sid ulid.ULID, in PushSubscriptionInput) (PushSubscription, error) {
	if !s.pushEnabled() {
		return PushSubscription{}, ErrPushUnavailable
	}
	p256dh, auth, err := validatePushSubscription(in)
	if err != nil {
		return PushSubscription{}, err
	}
	var row store.UpsertPushSubscriptionRow
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := q.LockPushEndpoint(ctx, in.Endpoint); err != nil {
			return fmt.Errorf("lock push endpoint: %w", err)
		}
		// 同じ endpoint を別のセッションが持っていたら、その行を消してこのセッションに移す。
		// 同じブラウザで別の人がログインし直したとき、前の人に届き続けないようにするため（ADR 0069 決定 3）。
		if err := q.DeletePushSubscriptionsForEndpointElsewhere(ctx, store.DeletePushSubscriptionsForEndpointElsewhereParams{
			Endpoint: in.Endpoint, Sid: sid,
		}); err != nil {
			return fmt.Errorf("delete push subscription for endpoint: %w", err)
		}
		row, err = q.UpsertPushSubscription(ctx, store.UpsertPushSubscriptionParams{
			ID:        s.ids.New(),
			UserID:    actor,
			Sid:       sid,
			Kind:      pushKindWebPush,
			Endpoint:  in.Endpoint,
			P256dh:    p256dh,
			Auth:      auth,
			UserAgent: pushUserAgent(in.UserAgent),
			CreatedAt: s.clock.Now(),
		})
		if err != nil {
			return fmt.Errorf("upsert push subscription: %w", err)
		}
		return nil
	})
	if err != nil {
		return PushSubscription{}, err
	}
	return PushSubscription{ID: row.ID, UserAgent: derefString(row.UserAgent), Current: true, CreatedAt: row.CreatedAt}, nil
}

// validatePushSubscription は購読の入力を確かめ、鍵をバイト列にして返す。
//
// endpoint はサーバーが POST する宛先なので、既知のプッシュのサービスの https の URL だけを受ける（SSRF の踏み台にしない。ADR 0069 決定 4）。
// 鍵は、送るときになって暗号化に失敗する購読を残さないよう、登録のときに形を確かめる。
func validatePushSubscription(in PushSubscriptionInput) (p256dh, auth []byte, err error) {
	var errs fieldErrors
	switch {
	case in.Endpoint == "":
		errs.add("endpoint", ReasonRequired)
	case webpush.CheckEndpoint(in.Endpoint) != nil:
		errs.add("endpoint", ReasonInvalidValue)
	}
	if in.P256dh == "" {
		errs.add("keys.p256dh", ReasonRequired)
	} else {
		p256dh = decodeBase64URL(in.P256dh)
		// 長さだけでなく、曲線の上の点であることまで確かめる（でたらめな 65 バイトでは鍵の合意ができない）
		if len(p256dh) != p256dhLen {
			errs.add("keys.p256dh", ReasonInvalidFormat)
		} else if _, err := ecdh.P256().NewPublicKey(p256dh); err != nil {
			errs.add("keys.p256dh", ReasonInvalidFormat)
		}
	}
	if in.Auth == "" {
		errs.add("keys.auth", ReasonRequired)
	} else if auth = decodeBase64URL(in.Auth); len(auth) != pushAuthLen {
		errs.add("keys.auth", ReasonInvalidFormat)
	}
	if err := errs.err(); err != nil {
		return nil, nil, err
	}
	return p256dh, auth, nil
}

// decodeBase64URL は base64url を読む。読めなければ nil。
// ブラウザの toJSON() は詰め物なしで返すが、詰め物を付けて送るクライアントもありうるので、どちらも受ける。
func decodeBase64URL(s string) []byte {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	if err != nil {
		return nil
	}
	return b
}

// pushUserAgent は保存する User-Agent。空なら NULL にする。
func pushUserAgent(ua string) *string {
	if ua == "" {
		return nil
	}
	if len(ua) > pushUserAgentMaxBytes {
		// バイト単位で切ると UTF-8 の途中で切れうるので、壊れた末尾を取り除く。
		ua = strings.ToValidUTF8(ua[:pushUserAgentMaxBytes], "")
	}
	return &ua
}

// RemoveCurrentPushSubscription は sid のセッションの購読を消す（設定のスイッチをオフにしたとき）。なくてもエラーにしない。
func (s *Service) RemoveCurrentPushSubscription(ctx context.Context, actor, sid ulid.ULID) error {
	if err := store.New(s.db).DeletePushSubscriptionBySID(ctx, store.DeletePushSubscriptionBySIDParams{UserID: actor, Sid: sid}); err != nil {
		return fmt.Errorf("delete push subscription: %w", err)
	}
	return nil
}

// ListPushSubscriptions は actor の購読の一覧を返す（設定の「通知を受け取る端末」）。sid の行に Current を付ける。
func (s *Service) ListPushSubscriptions(ctx context.Context, actor, sid ulid.ULID) ([]PushSubscription, error) {
	rows, err := store.New(s.db).ListPushSubscriptions(ctx, actor)
	if err != nil {
		return nil, fmt.Errorf("list push subscriptions: %w", err)
	}
	out := make([]PushSubscription, len(rows))
	for i, r := range rows {
		out[i] = PushSubscription{ID: r.ID, UserAgent: derefString(r.UserAgent), Current: r.Sid == sid, CreatedAt: r.CreatedAt}
	}
	return out, nil
}

// RemovePushSubscription は actor の購読を ID で消す（ほかの端末への通知を止める）。
// ほかの人の購読の ID なら ErrNotFound（ほかの人の購読があるかどうかを明かさない）。
//
// ログインのセッションは残る。通知だけを止めたいときに、その端末からログアウトさせずに済むようにするため。
func (s *Service) RemovePushSubscription(ctx context.Context, actor, subscriptionID ulid.ULID) error {
	n, err := store.New(s.db).DeletePushSubscriptionByID(ctx, store.DeletePushSubscriptionByIDParams{UserID: actor, ID: subscriptionID})
	if err != nil {
		return fmt.Errorf("delete push subscription: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// RemoveRevokedPushSubscriptions は、失効したセッションの購読を消す（auth:revoked。ADR 0069 決定 3）。
// all ならその人のすべての購読（パスワードの再設定）、そうでなければ sessionID の購読。
//
// 失敗してもログに残すだけにする。Redis Pub/Sub の取りこぼしと同じく、送る直前のセッションの確認で止まる（二段構え）。
func (s *Service) RemoveRevokedPushSubscriptions(ctx context.Context, userID, sessionID ulid.ULID, all bool) {
	q := store.New(s.db)
	var err error
	if all {
		err = q.DeletePushSubscriptionsByUser(ctx, userID)
	} else {
		err = q.DeletePushSubscriptionsForSession(ctx, sessionID)
	}
	if err != nil {
		s.logger.WarnContext(ctx, "remove revoked push subscriptions failed", slog.Any("error", err))
	}
}
