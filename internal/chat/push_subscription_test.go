package chat_test

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// プッシュ通知の購読（ADR 0069 決定 3・4）。

// newPushInput は、ブラウザの PushSubscription.toJSON() と同じ形の、正しい購読の入力を返す。
// endpoint は実行ごとに一意にする（テスト用 DB はパッケージをまたいで共有し、endpoint は UNIQUE）。
func newPushInput(t *testing.T) chat.PushSubscriptionInput {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	return chat.PushSubscriptionInput{
		Endpoint:  "https://fcm.googleapis.com/fcm/send/" + ulid.Make().String(),
		P256dh:    base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		Auth:      base64.RawURLEncoding.EncodeToString(auth),
		UserAgent: "Mozilla/5.0 (Macintosh) Chrome/130.0",
	}
}

// pushRow は DB の行（API は endpoint を返さないので、DB を直接読んで確かめる）。
type pushRow struct {
	userID, sid ulid.ULID
	endpoint    string
}

func pushRowsByEndpoint(t *testing.T, env *chattest.Env, endpoint string) []pushRow {
	t.Helper()
	rows, err := env.Pool.Query(t.Context(), `SELECT user_id, sid, endpoint FROM push_subscriptions WHERE endpoint = $1`, endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []pushRow
	for rows.Next() {
		var r pushRow
		if err := rows.Scan(&r.userID, &r.sid, &r.endpoint); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func pushRowBySID(t *testing.T, env *chattest.Env, sid ulid.ULID) (pushRow, bool) {
	t.Helper()
	var r pushRow
	err := env.Pool.QueryRow(t.Context(), `SELECT user_id, sid, endpoint FROM push_subscriptions WHERE sid = $1`, sid).Scan(&r.userID, &r.sid, &r.endpoint)
	if err != nil {
		return pushRow{}, false
	}
	return r, true
}

func TestPushConfig(t *testing.T) {
	if got := chattest.New(t).Service.PushConfig(); !got.Enabled || got.VAPIDPublicKey != chattest.VAPIDPublicKey {
		t.Errorf("有効なとき = %+v", got)
	}
	if got := chattest.New(t, chattest.WithoutPush()).Service.PushConfig(); got.Enabled || got.VAPIDPublicKey != "" {
		t.Errorf("無効なとき = %+v, want enabled false", got)
	}
}

func TestRegisterPushSubscription(t *testing.T) {
	env := chattest.New(t)
	alice, bob := env.CreateUser(t), env.CreateUser(t)

	t.Run("登録して、同じ内容の PUT し直しでは ID が変わらない", func(t *testing.T) {
		sid := env.IDs.New()
		in := newPushInput(t)
		first, err := env.Service.RegisterPushSubscription(t.Context(), alice, sid, in)
		if err != nil {
			t.Fatal(err)
		}
		if !first.Current || first.UserAgent != in.UserAgent || !first.CreatedAt.Equal(env.Clock.Now()) {
			t.Errorf("first = %+v", first)
		}
		again, err := env.Service.RegisterPushSubscription(t.Context(), alice, sid, in)
		if err != nil {
			t.Fatal(err)
		}
		if again.ID != first.ID || !again.CreatedAt.Equal(first.CreatedAt) {
			t.Errorf("again = %+v, want the same row as %+v", again, first)
		}
	})

	t.Run("同じセッションで別の endpoint なら置き換える（セッションに 1 つ）", func(t *testing.T) {
		sid := env.IDs.New()
		old, next := newPushInput(t), newPushInput(t)
		first, err := env.Service.RegisterPushSubscription(t.Context(), alice, sid, old)
		if err != nil {
			t.Fatal(err)
		}
		second, err := env.Service.RegisterPushSubscription(t.Context(), alice, sid, next)
		if err != nil {
			t.Fatal(err)
		}
		if second.ID != first.ID {
			t.Errorf("ID = %s, want %s（同じセッションの行を書き換える）", second.ID, first.ID)
		}
		if rows := pushRowsByEndpoint(t, env, old.Endpoint); len(rows) != 0 {
			t.Errorf("古い endpoint の行 = %+v, want なし", rows)
		}
		if r, ok := pushRowBySID(t, env, sid); !ok || r.endpoint != next.Endpoint {
			t.Errorf("sid の行 = %+v, %v; want 新しい endpoint", r, ok)
		}
	})

	t.Run("同じ endpoint を別の人が登録したら、その人のセッションに移す", func(t *testing.T) {
		aliceSID, bobSID := env.IDs.New(), env.IDs.New()
		in := newPushInput(t)
		if _, err := env.Service.RegisterPushSubscription(t.Context(), alice, aliceSID, in); err != nil {
			t.Fatal(err)
		}
		// 同じブラウザで alice がログアウトせずに bob がログインし直した
		if _, err := env.Service.RegisterPushSubscription(t.Context(), bob, bobSID, in); err != nil {
			t.Fatal(err)
		}
		rows := pushRowsByEndpoint(t, env, in.Endpoint)
		if len(rows) != 1 || rows[0].userID != bob || rows[0].sid != bobSID {
			t.Fatalf("rows = %+v, want bob のセッションの 1 行だけ", rows)
		}
		if _, ok := pushRowBySID(t, env, aliceSID); ok {
			t.Error("alice のセッションの行が残っている（前の人に届き続ける）")
		}
	})

	t.Run("endpoint を移すとき、移った先のセッションが持っていた別の endpoint は置き換わる", func(t *testing.T) {
		sidA, sidB := env.IDs.New(), env.IDs.New()
		shared, own := newPushInput(t), newPushInput(t)
		if _, err := env.Service.RegisterPushSubscription(t.Context(), alice, sidA, shared); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.RegisterPushSubscription(t.Context(), alice, sidB, own); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.RegisterPushSubscription(t.Context(), alice, sidB, shared); err != nil {
			t.Fatal(err)
		}
		if rows := pushRowsByEndpoint(t, env, shared.Endpoint); len(rows) != 1 || rows[0].sid != sidB {
			t.Errorf("shared の行 = %+v, want sidB の 1 行", rows)
		}
		if rows := pushRowsByEndpoint(t, env, own.Endpoint); len(rows) != 0 {
			t.Errorf("own の行 = %+v, want なし", rows)
		}
		if _, ok := pushRowBySID(t, env, sidA); ok {
			t.Error("sidA の行が残っている")
		}
	})

	t.Run("User-Agent がなければ空、長すぎれば切り詰める", func(t *testing.T) {
		in := newPushInput(t)
		in.UserAgent = ""
		got, err := env.Service.RegisterPushSubscription(t.Context(), alice, env.IDs.New(), in)
		if err != nil || got.UserAgent != "" {
			t.Errorf("空 = %+v, %v", got, err)
		}
		in = newPushInput(t)
		in.UserAgent = strings.Repeat("あ", 300) // 900 バイト
		got, err = env.Service.RegisterPushSubscription(t.Context(), alice, env.IDs.New(), in)
		if err != nil || len(got.UserAgent) > 512 || !strings.HasPrefix(in.UserAgent, got.UserAgent) {
			t.Errorf("長い = %d バイト, %v", len(got.UserAgent), err)
		}
	})

	t.Run("鍵は詰め物のある base64url でも受ける", func(t *testing.T) {
		in := newPushInput(t)
		in.Auth += "=="
		in.P256dh += "="
		if _, err := env.Service.RegisterPushSubscription(t.Context(), alice, env.IDs.New(), in); err != nil {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("無効なら ErrPushUnavailable", func(t *testing.T) {
		disabled := chattest.New(t, chattest.WithoutPush())
		_, err := disabled.Service.RegisterPushSubscription(t.Context(), disabled.CreateUser(t), disabled.IDs.New(), newPushInput(t))
		if !errors.Is(err, chat.ErrPushUnavailable) {
			t.Errorf("err = %v, want ErrPushUnavailable", err)
		}
	})
}

func TestRegisterPushSubscriptionValidation(t *testing.T) {
	env := chattest.New(t)
	user := env.CreateUser(t)
	b64 := base64.RawURLEncoding.EncodeToString

	tests := []struct {
		name   string
		modify func(*chat.PushSubscriptionInput)
		field  string
		reason string
	}{
		{"endpoint がない", func(in *chat.PushSubscriptionInput) { in.Endpoint = "" }, "endpoint", chat.ReasonRequired},
		{"http の endpoint", func(in *chat.PushSubscriptionInput) { in.Endpoint = "http://fcm.googleapis.com/fcm/send/x" }, "endpoint", chat.ReasonInvalidValue},
		// サーバーが POST する宛先なので、プッシュのサービスでないホストは SSRF の踏み台になる（ADR 0069 決定 4）
		{"知らないホスト", func(in *chat.PushSubscriptionInput) { in.Endpoint = "https://169.254.169.254/latest" }, "endpoint", chat.ReasonInvalidValue},
		{"p256dh がない", func(in *chat.PushSubscriptionInput) { in.P256dh = "" }, "keys.p256dh", chat.ReasonRequired},
		{"p256dh が base64url でない", func(in *chat.PushSubscriptionInput) { in.P256dh = "not base64!" }, "keys.p256dh", chat.ReasonInvalidFormat},
		{"p256dh の長さが違う", func(in *chat.PushSubscriptionInput) { in.P256dh = b64(make([]byte, 33)) }, "keys.p256dh", chat.ReasonInvalidFormat},
		{"p256dh が曲線の上の点でない", func(in *chat.PushSubscriptionInput) {
			bad := make([]byte, 65)
			bad[0] = 4
			in.P256dh = b64(bad)
		}, "keys.p256dh", chat.ReasonInvalidFormat},
		{"auth がない", func(in *chat.PushSubscriptionInput) { in.Auth = "" }, "keys.auth", chat.ReasonRequired},
		{"auth の長さが違う", func(in *chat.PushSubscriptionInput) { in.Auth = b64(make([]byte, 15)) }, "keys.auth", chat.ReasonInvalidFormat},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := newPushInput(t)
			tt.modify(&in)
			_, err := env.Service.RegisterPushSubscription(t.Context(), user, env.IDs.New(), in)
			var ve *chat.ValidationError
			if !errors.As(err, &ve) || len(ve.Fields) != 1 || ve.Fields[0].Field != tt.field || ve.Fields[0].Reason != tt.reason {
				t.Fatalf("err = %v, want %s: %s", err, tt.field, tt.reason)
			}
			if rows := pushRowsByEndpoint(t, env, in.Endpoint); len(rows) != 0 {
				t.Errorf("rows = %+v, want 保存しない", rows)
			}
		})
	}
}

func TestListAndRemovePushSubscriptions(t *testing.T) {
	env := chattest.New(t)
	alice, bob := env.CreateUser(t), env.CreateUser(t)
	laptop, phone, bobSID := env.IDs.New(), env.IDs.New(), env.IDs.New()
	mine, err := env.Service.RegisterPushSubscription(t.Context(), alice, laptop, newPushInput(t))
	if err != nil {
		t.Fatal(err)
	}
	other, err := env.Service.RegisterPushSubscription(t.Context(), alice, phone, newPushInput(t))
	if err != nil {
		t.Fatal(err)
	}
	bobs, err := env.Service.RegisterPushSubscription(t.Context(), bob, bobSID, newPushInput(t))
	if err != nil {
		t.Fatal(err)
	}

	t.Run("自分の購読だけを新しい順に、いまのセッションに印を付けて返す", func(t *testing.T) {
		got, err := env.Service.ListPushSubscriptions(t.Context(), alice, laptop)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 2 || got[0].ID != other.ID || got[1].ID != mine.ID {
			t.Fatalf("list = %+v, want [phone, laptop]", got)
		}
		if got[0].Current || !got[1].Current {
			t.Errorf("current = %v, %v; want laptop だけ", got[0].Current, got[1].Current)
		}
	})

	t.Run("ほかの人の購読は ID を知っていても消せない（404）", func(t *testing.T) {
		if err := env.Service.RemovePushSubscription(t.Context(), alice, bobs.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
		if _, ok := pushRowBySID(t, env, bobSID); !ok {
			t.Error("bob の購読が消えた")
		}
	})

	t.Run("ほかの端末の購読を ID で止める", func(t *testing.T) {
		if err := env.Service.RemovePushSubscription(t.Context(), alice, other.ID); err != nil {
			t.Fatal(err)
		}
		if _, ok := pushRowBySID(t, env, phone); ok {
			t.Error("phone の購読が残っている")
		}
		if err := env.Service.RemovePushSubscription(t.Context(), alice, other.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("2 回目 = %v, want ErrNotFound", err)
		}
	})

	t.Run("いまのセッションの購読を消す。なくてもエラーにしない", func(t *testing.T) {
		for range 2 {
			if err := env.Service.RemoveCurrentPushSubscription(t.Context(), alice, laptop); err != nil {
				t.Fatal(err)
			}
		}
		if _, ok := pushRowBySID(t, env, laptop); ok {
			t.Error("laptop の購読が残っている")
		}
	})

	t.Run("ほかの人の sid を指定しても消えない", func(t *testing.T) {
		if err := env.Service.RemoveCurrentPushSubscription(t.Context(), alice, bobSID); err != nil {
			t.Fatal(err)
		}
		if _, ok := pushRowBySID(t, env, bobSID); !ok {
			t.Error("bob の購読が消えた")
		}
	})
}

// ログアウトした端末にメッセージの本文が届き続けないよう、失効のイベントで購読を消す（ADR 0069 決定 3）。
func TestRemoveRevokedPushSubscriptions(t *testing.T) {
	env := chattest.New(t)
	alice, bob := env.CreateUser(t), env.CreateUser(t)
	register := func(user, sid ulid.ULID) {
		t.Helper()
		if _, err := env.Service.RegisterPushSubscription(t.Context(), user, sid, newPushInput(t)); err != nil {
			t.Fatal(err)
		}
	}
	a1, a2, b1 := env.IDs.New(), env.IDs.New(), env.IDs.New()
	register(alice, a1)
	register(alice, a2)
	register(bob, b1)

	// 1 セッションの失効のイベントには sid しか入っていない（ADR 0007）
	env.Service.RemoveRevokedPushSubscriptions(t.Context(), ulid.ULID{}, a1, false)
	if _, ok := pushRowBySID(t, env, a1); ok {
		t.Error("失効した a1 の購読が残っている")
	}
	if _, ok := pushRowBySID(t, env, a2); !ok {
		t.Error("a2 の購読まで消えた")
	}

	// 全セッションの失効（パスワードの再設定）
	env.Service.RemoveRevokedPushSubscriptions(t.Context(), alice, ulid.ULID{}, true)
	if _, ok := pushRowBySID(t, env, a2); ok {
		t.Error("全セッションの失効の後も a2 の購読が残っている")
	}
	if _, ok := pushRowBySID(t, env, b1); !ok {
		t.Error("ほかの人の購読まで消えた")
	}
}

// 同じブラウザ（endpoint）を、いくつものセッションが同時に登録しても、行は 1 つだけになる。
// 制約が endpoint と sid の 2 つあり、INSERT ... ON CONFLICT は片方しか受けられないので、endpoint の鍵で 1 つずつにしている。
func TestRegisterPushSubscriptionConcurrentSameEndpoint(t *testing.T) {
	env := chattest.New(t)
	in := newPushInput(t)
	const n = 20
	users := env.CreateUsers(t, n)
	sids := make([]ulid.ULID, n)
	for i := range sids {
		sids[i] = env.IDs.New()
	}

	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Go(func() {
			_, errs[i] = env.Service.RegisterPushSubscription(t.Context(), users[i], sids[i], in)
		})
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: %v", i, err)
		}
	}
	rows := pushRowsByEndpoint(t, env, in.Endpoint)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	// 残るのは最後に登録した人の行。その人以外のセッションには行がない
	for i, sid := range sids {
		if _, ok := pushRowBySID(t, env, sid); ok != (sid == rows[0].sid) {
			t.Errorf("session %d: has row = %v", i, ok)
		}
	}
}

// 同じセッションが別々の endpoint を同時に登録しても（購読を作り直した直後のタブが 2 つ）、セッションの行は 1 つ。
func TestRegisterPushSubscriptionConcurrentSameSession(t *testing.T) {
	env := chattest.New(t)
	user, sid := env.CreateUser(t), env.IDs.New()
	const n = 20
	inputs := make([]chat.PushSubscriptionInput, n)
	for i := range inputs {
		inputs[i] = newPushInput(t)
	}

	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Go(func() {
			_, errs[i] = env.Service.RegisterPushSubscription(t.Context(), user, sid, inputs[i])
		})
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: %v", i, err)
		}
	}
	var count int
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM push_subscriptions WHERE sid = $1`, sid).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("rows for sid = %d, want 1", count)
	}
}
