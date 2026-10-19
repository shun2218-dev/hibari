package chat_test

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/safehttp"
	"github.com/shun2218-dev/hibari/internal/platform/webpush"
)

// プッシュ通知を購読ごとに送る（ADR 0069 決定 3・8）。実物の Postgres で、送り先とセッションの確認だけを偽物にする。

// fakePushSender は送った先を記録し、endpoint ごとに決めたエラーを返す PushSender。
type fakePushSender struct {
	mu   sync.Mutex
	sent map[string]webpush.Message
	fail map[string]error
}

func newFakePushSender() *fakePushSender {
	return &fakePushSender{sent: map[string]webpush.Message{}, fail: map[string]error{}}
}

func (s *fakePushSender) Send(_ context.Context, sub webpush.Subscription, msg webpush.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent[sub.Endpoint] = msg
	return s.fail[sub.Endpoint]
}

func (s *fakePushSender) failWith(endpoint string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fail[endpoint] = err
}

func (s *fakePushSender) sentTo() map[string]webpush.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]webpush.Message, len(s.sent))
	for k, v := range s.sent {
		out[k] = v
	}
	return out
}

// fakeSessions は、失効させた sid と、確かめられない sid を決められる authn.SessionChecker。ほかの sid は有効。
type fakeSessions struct {
	mu      sync.Mutex
	revoked map[ulid.ULID]bool
	broken  map[ulid.ULID]bool
}

func newFakeSessions() *fakeSessions {
	return &fakeSessions{revoked: map[ulid.ULID]bool{}, broken: map[ulid.ULID]bool{}}
}

func (f *fakeSessions) SessionActive(_ context.Context, _, sid ulid.ULID) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.broken[sid] {
		return false, errors.New("database is down")
	}
	return !f.revoked[sid], nil
}

// insertPushSubscription は購読の行を直接入れて endpoint を返す。
// 登録の API は既知のプッシュのサービスの endpoint しか受けないので、httptest のサーバーに向けるには DB に直接書く。
func insertPushSubscription(t *testing.T, env *chattest.Env, user, sid ulid.ULID, endpoint string) {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	if _, err := env.Pool.Exec(t.Context(),
		`INSERT INTO push_subscriptions (id, user_id, sid, kind, endpoint, p256dh, auth, created_at)
		 VALUES ($1, $2, $3, 'webpush', $4, $5, $6, $7)`,
		env.IDs.New(), user, sid, endpoint, key.PublicKey().Bytes(), auth, env.Clock.Now()); err != nil {
		t.Fatal(err)
	}
}

// pushEndpoints は user の購読の endpoint（DB の行）。
func pushEndpoints(t *testing.T, env *chattest.Env, user ulid.ULID) []string {
	t.Helper()
	rows, err := env.Pool.Query(t.Context(), `SELECT endpoint FROM push_subscriptions WHERE user_id = $1 ORDER BY endpoint`, user)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			t.Fatal(err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// dmPair は DM の 2 人とその DM。DM は全体の設定が none でなければ、どのメッセージでも送る相手になる（決定 5）。
func dmPair(t *testing.T, env *chattest.Env) (sender, recipient ulid.ULID, room chat.Room) {
	t.Helper()
	u := env.CreateUsers(t, 2)
	ws := env.CreateWorkspace(t, u[0])
	env.AddMember(t, ws.ID, u[1], authz.RoleMember)
	room, _ = createDM(t, env, u[0], ws.ID, u[1])
	return u[0], u[1], room
}

// 購読ごとに、セッションを確かめてから送る。
//   - 有効なセッション: 送る
//   - 404 / 410（ErrGone）: 行を消す
//   - 429・5xx などほかの失敗: 送り直さず、行も残す
//   - 失効したセッション: 送らずに行を消す（auth:revoked を取りこぼしたとき。決定 3 の二段構え）
//   - セッションを確かめられない: 送らない。行は残す（DB が戻れば次の通知で確かめ直す）
func TestSendPushesPerSubscription(t *testing.T) {
	sender := newFakePushSender()
	sessions := newFakeSessions()
	env := chattest.New(t, chattest.WithPushSender(sender, sessions))
	from, to, room := dmPair(t, env)

	base := "https://fcm.googleapis.com/fcm/send/" + ulid.Make().String()
	ok, gone, busy, revoked, broken := base+"/ok", base+"/gone", base+"/busy", base+"/revoked", base+"/broken"
	sid := map[string]ulid.ULID{}
	for _, e := range []string{ok, gone, busy, revoked, broken} {
		sid[e] = env.IDs.New()
		insertPushSubscription(t, env, to, sid[e], e)
	}
	// 送信者自身の購読には送らない
	fromEndpoint := base + "/sender"
	insertPushSubscription(t, env, from, env.IDs.New(), fromEndpoint)

	sender.failWith(gone, webpush.ErrGone)
	sender.failWith(busy, errors.New("webpush: push service: safehttp: unexpected status 429"))
	sessions.revoked[sid[revoked]] = true
	sessions.broken[sid[broken]] = true

	msg := send(t, env, from, room.ID, "こんにちは")
	env.Service.SendPushes(t.Context(), messageCreated(msg))

	got := sender.sentTo()
	var endpoints []string
	for e := range got {
		endpoints = append(endpoints, e)
	}
	slices.Sort(endpoints)
	if want := []string{busy, gone, ok}; !slices.Equal(endpoints, want) {
		t.Errorf("sent to %v, want %v", endpoints, want)
	}
	if m := got[ok]; m.TTL != chat.PushMessageTTL || m.Urgency != webpush.UrgencyNormal || len(m.Payload) == 0 {
		t.Errorf("message = TTL %v, urgency %q, %d bytes", m.TTL, m.Urgency, len(m.Payload))
	}
	if want := []string{broken, busy, ok}; !slices.Equal(pushEndpoints(t, env, to), want) {
		t.Errorf("remaining subscriptions = %v, want %v", pushEndpoints(t, env, to), want)
	}
	if len(pushEndpoints(t, env, from)) != 1 {
		t.Error("the sender's subscription was touched")
	}

	// 送り直さない: 同じイベントをもう一度処理しても、消えた購読には送らない（行がもうない）
	sender.mu.Lock()
	sender.sent = map[string]webpush.Message{}
	sender.mu.Unlock()
	env.Service.SendPushes(t.Context(), messageCreated(msg))
	if _, again := sender.sentTo()[gone]; again {
		t.Error("sent again to a gone subscription")
	}
}

// ハドルの呼び出しは TTL 60 秒・urgency high で送る（決定 6）。
func TestSendPushesHuddleRinging(t *testing.T) {
	sender := newFakePushSender()
	env := chattest.New(t, chattest.WithPushSender(sender, newFakeSessions()))
	caller, peer, room := dmPair(t, env)
	endpoint := "https://fcm.googleapis.com/fcm/send/" + ulid.Make().String()
	insertPushSubscription(t, env, peer, env.IDs.New(), endpoint)

	env.Service.SendPushes(t.Context(), chat.Event{
		Type: chat.EventHuddleRinging,
		To:   chat.Audience{Users: []ulid.ULID{peer}},
		Data: chat.HuddleRinging{RoomID: room.ID, HuddleID: env.IDs.New(), CallerID: caller},
	})
	m, ok := sender.sentTo()[endpoint]
	if !ok {
		t.Fatal("huddle ringing was not sent")
	}
	if m.TTL != chat.PushHuddleTTL || m.Urgency != webpush.UrgencyHigh {
		t.Errorf("message = TTL %v, urgency %q", m.TTL, m.Urgency)
	}
}

// 送る実装がなければ（購読の API だけのとき）、何もしない。
func TestSendPushesWithoutSender(t *testing.T) {
	env := chattest.New(t)
	from, to, room := dmPair(t, env)
	insertPushSubscription(t, env, to, env.IDs.New(), "https://fcm.googleapis.com/fcm/send/"+ulid.Make().String())
	msg := send(t, env, from, room.ID, "こんにちは")
	env.Service.SendPushes(t.Context(), messageCreated(msg)) // パニックしない
	if len(pushEndpoints(t, env, to)) != 1 {
		t.Error("subscription was removed without a sender")
	}
}

// pushService は httptest のプッシュのサービス。パスが /gone/ で始まる endpoint には 410 を返す。
type pushService struct {
	*httptest.Server
	mu       sync.Mutex
	requests []*http.Request
}

func newPushService(t *testing.T) *pushService {
	t.Helper()
	ps := &pushService{}
	ps.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ps.mu.Lock()
		ps.requests = append(ps.requests, r.Clone(context.Background()))
		ps.mu.Unlock()
		if strings.HasPrefix(r.URL.Path, "/gone/") {
			w.WriteHeader(http.StatusGone)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(ps.Close)
	return ps
}

// loopbackPushSender は httptest のサーバーへ送れる本物の webpush.Sender。endpoint の名前の検査と接続先の IP の検査を、
// テストのためだけに緩める（platform/webpush のテストと同じ。検査を外す環境変数は作らない）。
func loopbackPushSender(t *testing.T, ps *pushService) *webpush.Sender {
	t.Helper()
	u, err := url.Parse(ps.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.ParseUint(u.Port(), 10, 16)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	s, err := webpush.New(webpush.Options{
		Key:           key,
		Subject:       "mailto:ops@example.com",
		Clock:         clock.NewFake(chattest.Start),
		HTTP:          safehttp.New(safehttp.Options{AllowAddr: func(a netip.Addr) bool { return a.IsLoopback() }, Ports: []uint16{uint16(port)}}),
		CheckEndpoint: func(string) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// notifyingDispatcher は、1 件を処理し終えるたびに done に送る PushDispatcher（テストが非同期の送信の終わりを待つため）。
type notifyingDispatcher struct {
	inner chat.PushDispatcher
	done  chan struct{}
}

func (d notifyingDispatcher) SendPushes(ctx context.Context, ev chat.Event) {
	d.inner.SendPushes(ctx, ev)
	d.done <- struct{}{}
}

// 端から端まで: PushDelivery の列 → Service.SendPushes → 本物の暗号化と VAPID の署名 → httptest のプッシュのサービス。
// 410 を返した購読は消え、201 を返した購読は残る。inner の配信にもイベントが届く。
func TestPushDeliveryEndToEnd(t *testing.T) {
	ps := newPushService(t)
	env := chattest.New(t, chattest.WithPushSender(loopbackPushSender(t, ps), newFakeSessions()))
	from, to, room := dmPair(t, env)
	okEndpoint := ps.URL + "/ok/" + ulid.Make().String()
	goneEndpoint := ps.URL + "/gone/" + ulid.Make().String()
	insertPushSubscription(t, env, to, env.IDs.New(), okEndpoint)
	insertPushSubscription(t, env, to, env.IDs.New(), goneEndpoint)

	inner := &chattest.Recorder{}
	d := chat.NewPushDelivery(inner, chat.PushDeliveryOptions{QueueSize: 8, Workers: 2}, discardLogger())
	dispatcher := notifyingDispatcher{inner: env.Service, done: make(chan struct{}, 8)}
	runPushDelivery(t, d, dispatcher)

	msg := send(t, env, from, room.ID, "タブを閉じていても届く")
	d.Deliver(t.Context(), messageCreated(msg))
	select {
	case <-dispatcher.done:
	case <-time.After(10 * time.Second):
		t.Fatal("push was not processed")
	}

	if got := inner.Take(); len(got) != 1 || got[0].Type != chat.EventMessageCreated {
		t.Errorf("inner got %+v", got)
	}
	ps.mu.Lock()
	reqs := slices.Clone(ps.requests)
	ps.mu.Unlock()
	if len(reqs) != 2 {
		t.Fatalf("push service got %d requests, want 2", len(reqs))
	}
	for _, r := range reqs {
		if r.Method != http.MethodPost || r.Header.Get("Content-Encoding") != "aes128gcm" ||
			r.Header.Get("TTL") != strconv.Itoa(int(chat.PushMessageTTL/time.Second)) ||
			!strings.HasPrefix(r.Header.Get("Authorization"), "vapid t=") {
			t.Errorf("request %s %s: headers %v", r.Method, r.URL.Path, r.Header)
		}
	}
	if got := pushEndpoints(t, env, to); !slices.Equal(got, []string{okEndpoint}) {
		t.Errorf("remaining subscriptions = %v, want only the ok one", got)
	}
}
