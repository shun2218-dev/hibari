package realtime_test

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"maps"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/presence"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// Hub の単体テスト。接続・authz・presence・セッション・Redis Pub/Sub を偽物にして、ネットワークと DB なしで振る舞いを確かめる。
// 偽物の Publisher は publish したイベントをその場で DeliverLocal に戻す（1 台だけの Redis Pub/Sub の代わり）。
// 実物の Redis を通した確認は redis_test.go、WebSocket と DB を通した確認は internal/httpx の統合テストで行う。

var ids = id.NewGenerator(clock.NewFake(time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)), rand.Reader)

// fakeConn は送られたイベントと閉じた理由を記録する。
type fakeConn struct {
	mu     sync.Mutex
	events []chat.Event
	closed []realtime.CloseReason
	full   bool // true なら Send が送信キューの満杯を返す
}

func (c *fakeConn) Send(ev chat.Event) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.full {
		return false
	}
	c.events = append(c.events, ev)
	return true
}

func (c *fakeConn) Close(reason realtime.CloseReason) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = append(c.closed, reason)
}

// take は届いたイベントの種類を返して、記録を空にする。
func (c *fakeConn) take() []chat.EventType {
	c.mu.Lock()
	defer c.mu.Unlock()
	types := make([]chat.EventType, len(c.events))
	for i, ev := range c.events {
		types[i] = ev.Type
	}
	c.events = nil
	return types
}

func (c *fakeConn) takeEvents() []chat.Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	evs := c.events
	c.events = nil
	return evs
}

func (c *fakeConn) closeReasons() []realtime.CloseReason {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.closed)
}

// fakeAuth は「誰がどのルーム / ワークスペースを読めるか」を表で持つ authz。
type fakeAuth struct {
	mu         sync.Mutex
	rooms      map[ulid.ULID]ulid.ULID // roomID → workspaceID
	readable   map[[2]ulid.ULID]bool   // {userID, roomID or workspaceID}
	writable   map[[2]ulid.ULID]bool   // {userID, roomID}
	workspaces map[ulid.ULID][]ulid.ULID
	allowedErr error
	// beforeAuthorizeRoom は AuthorizeRoom が表を読んだ後、結果を返す前に呼ばれる（競合の再現用）。
	beforeAuthorizeRoom func()
}

func newFakeAuth() *fakeAuth {
	return &fakeAuth{
		rooms:      map[ulid.ULID]ulid.ULID{},
		readable:   map[[2]ulid.ULID]bool{},
		writable:   map[[2]ulid.ULID]bool{},
		workspaces: map[ulid.ULID][]ulid.ULID{},
	}
}

func (a *fakeAuth) grant(userID, target ulid.ULID) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.readable[[2]ulid.ULID{userID, target}] = true
}

func (a *fakeAuth) revoke(userID, target ulid.ULID) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.readable, [2]ulid.ULID{userID, target})
	delete(a.writable, [2]ulid.ULID{userID, target})
}

func (a *fakeAuth) AuthorizeRoom(_ context.Context, userID, roomID ulid.ULID) (ulid.ULID, error) {
	a.mu.Lock()
	ok := a.readable[[2]ulid.ULID{userID, roomID}]
	ws := a.rooms[roomID]
	hook := a.beforeAuthorizeRoom
	a.mu.Unlock()
	if hook != nil {
		hook()
	}
	if !ok {
		return ulid.ULID{}, chat.ErrNotFound
	}
	return ws, nil
}

func (a *fakeAuth) AuthorizeWorkspace(_ context.Context, userID, workspaceID ulid.ULID) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.readable[[2]ulid.ULID{userID, workspaceID}] {
		return chat.ErrNotFound
	}
	return nil
}

func (a *fakeAuth) Allowed(_ context.Context, userID ulid.ULID, roomIDs, workspaceIDs []ulid.ULID) (map[ulid.ULID]bool, map[ulid.ULID]bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.allowedErr != nil {
		return nil, nil, a.allowedErr
	}
	rooms, workspaces := map[ulid.ULID]bool{}, map[ulid.ULID]bool{}
	for _, id := range roomIDs {
		if a.readable[[2]ulid.ULID{userID, id}] {
			rooms[id] = true
		}
	}
	for _, id := range workspaceIDs {
		if a.readable[[2]ulid.ULID{userID, id}] {
			workspaces[id] = true
		}
	}
	return rooms, workspaces, nil
}

func (a *fakeAuth) AuthorizeTyping(_ context.Context, userID, roomID ulid.ULID) (chat.TypingStarted, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.readable[[2]ulid.ULID{userID, roomID}] {
		return chat.TypingStarted{}, chat.ErrNotFound
	}
	if !a.writable[[2]ulid.ULID{userID, roomID}] {
		return chat.TypingStarted{}, chat.ErrForbidden
	}
	return chat.TypingStarted{WorkspaceID: a.rooms[roomID], RoomID: roomID, User: chat.UserProfile{ID: userID}}, nil
}

func (a *fakeAuth) WorkspaceIDs(_ context.Context, userID ulid.ULID) ([]ulid.ULID, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.workspaces[userID], nil
}

// fakePresence は presence と typing を記録する。typing の TTL は切れないので、2 回目以降は常に false。
// Connect / Disconnect が状態を変えたら、実物の Lua スクリプトと同じく、渡されたイベントを publish する。
type fakePresence struct {
	mu        sync.Mutex
	online    map[ulid.ULID]bool
	refreshes int
	typing    map[[2]ulid.ULID]bool
	publisher *fakePublisher
	// beforeDisconnect は Disconnect の最初に呼ばれる（後始末の途中の状態を作る）。
	beforeDisconnect func()
}

func (p *fakePresence) Connect(ctx context.Context, userID ulid.ULID, ann presence.Announcement) (bool, error) {
	p.mu.Lock()
	first := !p.online[userID]
	p.online[userID] = true
	p.mu.Unlock()
	if first {
		p.publisher.publish(ctx, ann)
	}
	return first, nil
}

func (p *fakePresence) Disconnect(ctx context.Context, userID ulid.ULID, ann presence.Announcement) (bool, error) {
	p.mu.Lock()
	hook := p.beforeDisconnect
	p.mu.Unlock()
	if hook != nil {
		hook()
	}
	p.mu.Lock()
	last := p.online[userID]
	delete(p.online, userID)
	p.mu.Unlock()
	if last {
		p.publisher.publish(ctx, ann)
	}
	return last, nil
}

func (p *fakePresence) Refresh(_ context.Context, userIDs ...ulid.ULID) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.refreshes++
	for _, id := range userIDs {
		p.online[id] = true
	}
	return nil
}

func (p *fakePresence) StartTyping(_ context.Context, roomID, userID ulid.ULID) (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	key := [2]ulid.ULID{roomID, userID}
	if p.typing[key] {
		return false, nil
	}
	p.typing[key] = true
	return true, nil
}

func (p *fakePresence) isOnline(userID ulid.ULID) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.online[userID]
}

// fakePublisher は publish したイベントを、その場で Hub の DeliverLocal に渡す。
type fakePublisher struct {
	hub     *realtime.Hub
	mu      sync.Mutex
	pending map[string]chat.Event // Announcement の payload → イベント
}

func (p *fakePublisher) Deliver(ctx context.Context, ev chat.Event) {
	p.hub.DeliverLocal(ctx, ev)
}

func (p *fakePublisher) Announcement(ev chat.Event) (presence.Announcement, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	key := ids.New().String()
	p.pending[key] = ev
	return presence.Announcement{Payload: []byte(key)}, nil
}

func (p *fakePublisher) publish(ctx context.Context, ann presence.Announcement) {
	p.mu.Lock()
	ev, ok := p.pending[string(ann.Payload)]
	delete(p.pending, string(ann.Payload))
	p.mu.Unlock()
	if ok {
		p.hub.DeliverLocal(ctx, ev)
	}
}

// fakeSubscriber はチャンネルごとの購読の数を数える。
type fakeSubscriber struct {
	mu   sync.Mutex
	refs map[string]int
	err  error // nil でなければ Acquire が失敗する
}

func (s *fakeSubscriber) Acquire(_ context.Context, channel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.refs[channel]++
	return nil
}

func (s *fakeSubscriber) Release(channel string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refs[channel]--
	if s.refs[channel] == 0 {
		delete(s.refs, channel)
	}
}

// channels は購読の数が 0 でないチャンネルと、その数を返す。
func (s *fakeSubscriber) channels() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return maps.Clone(s.refs)
}

type fakeSessions struct {
	mu      sync.Mutex
	revoked map[ulid.ULID]bool
}

func (s *fakeSessions) SessionActive(_ context.Context, _, sid ulid.ULID) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.revoked[sid], nil
}

type env struct {
	hub        *realtime.Hub
	auth       *fakeAuth
	presence   *fakePresence
	sessions   *fakeSessions
	subscriber *fakeSubscriber
}

func newEnv(t *testing.T) *env {
	t.Helper()
	publisher := &fakePublisher{pending: map[string]chat.Event{}}
	e := &env{
		auth:       newFakeAuth(),
		presence:   &fakePresence{online: map[ulid.ULID]bool{}, typing: map[[2]ulid.ULID]bool{}, publisher: publisher},
		sessions:   &fakeSessions{revoked: map[ulid.ULID]bool{}},
		subscriber: &fakeSubscriber{refs: map[string]int{}},
	}
	e.hub = realtime.NewHub(realtime.Deps{
		Authorizer: e.auth,
		Presence:   e.presence,
		Sessions:   e.sessions,
		Publisher:  publisher,
		Subscriber: e.subscriber,
		Logger:     slog.New(slog.DiscardHandler),
	})
	publisher.hub = e.hub
	return e
}

func (e *env) connect(t *testing.T, userID ulid.ULID) (*realtime.Client, *fakeConn) {
	t.Helper()
	conn := &fakeConn{}
	c, err := e.hub.Register(t.Context(), authn.Identity{UserID: userID, SessionID: ids.New()}, conn)
	if err != nil {
		t.Fatal(err)
	}
	return c, conn
}

func (e *env) subscribe(t *testing.T, c *realtime.Client, topic realtime.Topic) {
	t.Helper()
	if err := e.hub.Subscribe(t.Context(), c, topic); err != nil {
		t.Fatalf("Subscribe(%+v) error = %v", topic, err)
	}
}

// world は 1 つのワークスペースに 2 つのルームがあり、alice と bob が両方を読める状態。
type world struct {
	ws, room, other ulid.ULID
	alice, bob      ulid.ULID
}

func (e *env) world() world {
	w := world{ws: ids.New(), room: ids.New(), other: ids.New(), alice: ids.New(), bob: ids.New()}
	e.auth.rooms[w.room] = w.ws
	e.auth.rooms[w.other] = w.ws
	for _, u := range []ulid.ULID{w.alice, w.bob} {
		e.auth.grant(u, w.ws)
		e.auth.grant(u, w.room)
		e.auth.grant(u, w.other)
		e.auth.workspaces[u] = []ulid.ULID{w.ws}
	}
	return w
}

func messageTo(roomID ulid.ULID) chat.Event {
	return chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{roomID}}, Data: chat.Message{RoomID: roomID}}
}

func equalTypes(got []chat.EventType, want ...chat.EventType) bool {
	return slices.Equal(got, want)
}

func TestSubscribeAndDeliver(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	outsider := ids.New()
	alice, aliceConn := e.connect(t, w.alice)
	_, aliceTab2Conn := e.connect(t, w.alice)
	bob, bobConn := e.connect(t, w.bob)
	stranger, strangerConn := e.connect(t, outsider)
	for _, c := range []*fakeConn{aliceConn, aliceTab2Conn, bobConn, strangerConn} {
		c.take() // 接続時の presence.changed を捨てる
	}

	e.subscribe(t, alice, realtime.RoomTopic(w.room))
	e.subscribe(t, alice, realtime.RoomTopic(w.room)) // 2 回目は何もしない
	e.subscribe(t, alice, realtime.WorkspaceTopic(w.ws))
	e.subscribe(t, bob, realtime.RoomTopic(w.other))
	// 読めないルームやワークスペースは、存在の有無を明かさずに not found。
	if err := e.hub.Subscribe(t.Context(), stranger, realtime.RoomTopic(w.room)); !errors.Is(err, chat.ErrNotFound) {
		t.Fatalf("Subscribe(unreadable room) error = %v, want ErrNotFound", err)
	}
	if err := e.hub.Subscribe(t.Context(), stranger, realtime.WorkspaceTopic(w.ws)); !errors.Is(err, chat.ErrNotFound) {
		t.Fatalf("Subscribe(unreadable workspace) error = %v, want ErrNotFound", err)
	}

	for _, tt := range []struct {
		name                           string
		ev                             chat.Event
		alice, aliceTab2, bob, strange []chat.EventType
	}{
		{name: "room subscribers only", ev: messageTo(w.room), alice: []chat.EventType{chat.EventMessageCreated}},
		{name: "other room", ev: messageTo(w.other), bob: []chat.EventType{chat.EventMessageCreated}},
		{
			name:  "workspace subscribers",
			ev:    chat.Event{Type: chat.EventWorkspaceUpdated, To: chat.Audience{Workspaces: []ulid.ULID{w.ws}}},
			alice: []chat.EventType{chat.EventWorkspaceUpdated},
		},
		{
			// 本人宛ては購読の有無を問わず、そのユーザーのすべての接続に届く。
			name:      "user without subscription",
			ev:        chat.Event{Type: chat.EventRoomRead, To: chat.Audience{Users: []ulid.ULID{w.alice}}},
			alice:     []chat.EventType{chat.EventRoomRead},
			aliceTab2: []chat.EventType{chat.EventRoomRead},
		},
		{
			// ルームとワークスペースと本人の全部に当たっても、1 つの接続には 1 回だけ。
			name: "deduplicated",
			ev: chat.Event{Type: chat.EventMemberJoined, To: chat.Audience{
				Rooms: []ulid.ULID{w.room, w.other}, Workspaces: []ulid.ULID{w.ws}, Users: []ulid.ULID{w.alice, w.bob},
			}},
			alice:     []chat.EventType{chat.EventMemberJoined},
			aliceTab2: []chat.EventType{chat.EventMemberJoined},
			bob:       []chat.EventType{chat.EventMemberJoined},
		},
		{
			name: "except user",
			ev:   chat.Event{Type: chat.EventTypingStarted, To: chat.Audience{Rooms: []ulid.ULID{w.room, w.other}, ExceptUser: w.alice}},
			bob:  []chat.EventType{chat.EventTypingStarted},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e.hub.DeliverLocal(t.Context(), tt.ev)
			for name, got := range map[string]struct {
				got, want []chat.EventType
			}{
				"alice":      {aliceConn.take(), tt.alice},
				"alice tab2": {aliceTab2Conn.take(), tt.aliceTab2},
				"bob":        {bobConn.take(), tt.bob},
				"stranger":   {strangerConn.take(), tt.strange},
			} {
				if !equalTypes(got.got, got.want...) {
					t.Errorf("%s received %v, want %v", name, got.got, got.want)
				}
			}
		})
	}

	e.hub.Unsubscribe(alice, realtime.RoomTopic(w.room))
	e.hub.Unsubscribe(alice, realtime.RoomTopic(w.room)) // 購読していなくても何もしない
	e.hub.DeliverLocal(t.Context(), messageTo(w.room))
	if got := aliceConn.take(); len(got) != 0 {
		t.Errorf("after unsubscribe, alice received %v", got)
	}
}

func TestSubscriptionLimit(t *testing.T) {
	e := newEnv(t)
	userID := ids.New()
	c, _ := e.connect(t, userID)
	for range realtime.MaxSubscriptions {
		ws := ids.New()
		e.auth.grant(userID, ws)
		e.subscribe(t, c, realtime.WorkspaceTopic(ws))
	}
	ws := ids.New()
	e.auth.grant(userID, ws)
	if err := e.hub.Subscribe(t.Context(), c, realtime.WorkspaceTopic(ws)); !errors.Is(err, realtime.ErrTooManySubscriptions) {
		t.Fatalf("Subscribe() over the limit error = %v, want ErrTooManySubscriptions", err)
	}
}

// 権限の変更のイベントは、送る前に本人の購読を DB（authz）で確かめ直して外す（CLAUDE.md ルール 8）。
func TestDeliverRevalidatesAccessChanges(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	otherWS, otherRoom := ids.New(), ids.New()
	e.auth.rooms[otherRoom] = otherWS
	e.auth.grant(w.bob, otherWS)
	e.auth.grant(w.bob, otherRoom)

	bob, bobConn := e.connect(t, w.bob)
	bobTab2, bobTab2Conn := e.connect(t, w.bob)
	for _, c := range []*realtime.Client{bob, bobTab2} {
		e.subscribe(t, c, realtime.WorkspaceTopic(w.ws))
		e.subscribe(t, c, realtime.RoomTopic(w.room))
		e.subscribe(t, c, realtime.RoomTopic(w.other))
		e.subscribe(t, c, realtime.WorkspaceTopic(otherWS))
		e.subscribe(t, c, realtime.RoomTopic(otherRoom))
	}
	bobConn.take()
	bobTab2Conn.take()

	// bob が w.room から外された。ほかの購読は読めるまま。
	e.auth.revoke(w.bob, w.room)
	e.hub.DeliverLocal(t.Context(), chat.Event{
		Type:          chat.EventRoomMemberRemoved,
		To:            chat.Audience{Users: []ulid.ULID{w.bob}},
		AccessChanges: []chat.AccessChange{{UserID: w.bob, WorkspaceID: w.ws}},
	})
	for name, conn := range map[string]*fakeConn{"bob": bobConn, "bob tab2": bobTab2Conn} {
		// 通知はイベントそのものの 1 件だけ（再検証が合成した通知を重ねない）。
		if got := conn.take(); !equalTypes(got, chat.EventRoomMemberRemoved) {
			t.Errorf("%s received %v, want only room.member_removed", name, got)
		}
	}
	e.hub.DeliverLocal(t.Context(), messageTo(w.room))
	e.hub.DeliverLocal(t.Context(), messageTo(w.other))
	if got := bobConn.take(); !equalTypes(got, chat.EventMessageCreated) {
		t.Errorf("bob received %v, want only the message in the room he can still read", got)
	}

	// ワークスペースからキックされた。そのワークスペースの購読だけが外れ、別のワークスペースは残る。
	e.auth.revoke(w.bob, w.ws)
	e.auth.revoke(w.bob, w.other)
	e.hub.DeliverLocal(t.Context(), chat.Event{
		Type:          chat.EventWorkspaceMemberRemoved,
		To:            chat.Audience{Workspaces: []ulid.ULID{w.ws}, Users: []ulid.ULID{w.bob}},
		AccessChanges: []chat.AccessChange{{UserID: w.bob, WorkspaceID: w.ws}},
	})
	if got := bobConn.take(); !equalTypes(got, chat.EventWorkspaceMemberRemoved) {
		t.Errorf("bob received %v, want workspace.member_removed once", got)
	}
	e.hub.DeliverLocal(t.Context(), messageTo(w.other))
	e.hub.DeliverLocal(t.Context(), chat.Event{Type: chat.EventWorkspaceUpdated, To: chat.Audience{Workspaces: []ulid.ULID{w.ws}}})
	e.hub.DeliverLocal(t.Context(), messageTo(otherRoom))
	if got := bobConn.take(); !equalTypes(got, chat.EventMessageCreated) {
		t.Errorf("bob received %v, want only the message in the other workspace", got)
	}
}

// 購読の authz が権限の変更の前の状態を読んで通っても、その間に再検証が始まっていれば、authz をやり直して登録しない。
func TestSubscribeRetriesWhenAccessChangesConcurrently(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	bob, bobConn := e.connect(t, w.bob)
	// 再検証の対象が空だと Allowed は呼ばれないので、別の購読を持たせておく。
	e.subscribe(t, bob, realtime.RoomTopic(w.other))

	calls := 0
	e.auth.beforeAuthorizeRoom = func() {
		calls++
		if calls > 1 {
			return
		}
		// 1 回目の authz が「読める」を読んだ直後に、bob が外されて権限の変更のイベントが届く。
		e.auth.revoke(w.bob, w.room)
		e.hub.DeliverLocal(context.Background(), chat.Event{
			Type:          chat.EventRoomMemberRemoved,
			To:            chat.Audience{Users: []ulid.ULID{w.bob}},
			AccessChanges: []chat.AccessChange{{UserID: w.bob, WorkspaceID: w.ws}},
		})
	}
	if err := e.hub.Subscribe(t.Context(), bob, realtime.RoomTopic(w.room)); !errors.Is(err, chat.ErrNotFound) {
		t.Fatalf("Subscribe() error = %v, want ErrNotFound after retry", err)
	}
	if calls != 2 {
		t.Errorf("AuthorizeRoom calls = %d, want 2", calls)
	}
	bobConn.take()
	e.hub.DeliverLocal(t.Context(), messageTo(w.room))
	if got := bobConn.take(); len(got) != 0 {
		t.Errorf("bob received %v from a room he was removed from", got)
	}
}

// 権限を確かめられない（DB の障害）ときは購読を外さない。
func TestRevalidateKeepsSubscriptionsOnError(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	bob, bobConn := e.connect(t, w.bob)
	e.subscribe(t, bob, realtime.RoomTopic(w.room))
	e.auth.allowedErr = errors.New("db is down")
	e.auth.revoke(w.bob, w.room)
	e.hub.Revalidate(t.Context())
	bobConn.take()
	e.hub.DeliverLocal(t.Context(), messageTo(w.room))
	if got := bobConn.take(); !equalTypes(got, chat.EventMessageCreated) {
		t.Errorf("bob received %v, want the subscription kept", got)
	}
}

func TestSlowConsumerIsClosed(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	alice, aliceConn := e.connect(t, w.alice)
	bob, bobConn := e.connect(t, w.bob)
	e.subscribe(t, alice, realtime.RoomTopic(w.room))
	e.subscribe(t, bob, realtime.RoomTopic(w.room))
	aliceConn.take()

	bobConn.mu.Lock()
	bobConn.full = true
	bobConn.mu.Unlock()
	e.hub.DeliverLocal(t.Context(), messageTo(w.room))

	// 遅い接続は待たずに閉じさせ、ほかの接続への配信は止めない。
	if got := bobConn.closeReasons(); !slices.Equal(got, []realtime.CloseReason{realtime.CloseSlowConsumer}) {
		t.Errorf("bob close reasons = %v, want [CloseSlowConsumer]", got)
	}
	if got := aliceConn.take(); !equalTypes(got, chat.EventMessageCreated) {
		t.Errorf("alice received %v", got)
	}
}

func TestCloseSessions(t *testing.T) {
	e := newEnv(t)
	alice, bob := ids.New(), ids.New()
	sid1, sid2 := ids.New(), ids.New()
	conns := map[string]*fakeConn{}
	register := func(name string, userID, sid ulid.ULID) {
		conns[name] = &fakeConn{}
		if _, err := e.hub.Register(t.Context(), authn.Identity{UserID: userID, SessionID: sid}, conns[name]); err != nil {
			t.Fatal(err)
		}
	}
	register("alice sid1 tab1", alice, sid1)
	register("alice sid1 tab2", alice, sid1)
	register("alice sid2", alice, sid2)
	register("bob", bob, ids.New())

	closed := func() []string {
		var names []string
		for name, c := range conns {
			if len(c.closeReasons()) > 0 {
				if r := c.closeReasons()[0]; r != realtime.CloseSessionRevoked {
					t.Errorf("%s closed with %v", name, r)
				}
				names = append(names, name)
			}
		}
		slices.Sort(names)
		return names
	}

	// ログアウトはそのセッションの接続だけを切る（ADR 0007）。
	e.hub.CloseSessions(t.Context(), authn.Revocation{SessionID: sid1})
	if got := closed(); !slices.Equal(got, []string{"alice sid1 tab1", "alice sid1 tab2"}) {
		t.Errorf("closed after session revocation = %v", got)
	}
	// パスワードリセットはユーザーのすべての接続を切る。
	e.hub.CloseSessions(t.Context(), authn.Revocation{UserID: alice, All: true})
	if got := closed(); !slices.Equal(got, []string{"alice sid1 tab1", "alice sid1 tab2", "alice sid2"}) {
		t.Errorf("closed after user revocation = %v", got)
	}
}

// 定期の再検証は、取りこぼした失効と権限の変更を拾う。
func TestRevalidate(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	revokedSID := ids.New()
	aliceConn := &fakeConn{}
	if _, err := e.hub.Register(t.Context(), authn.Identity{UserID: w.alice, SessionID: revokedSID}, aliceConn); err != nil {
		t.Fatal(err)
	}
	bob, bobConn := e.connect(t, w.bob)
	e.subscribe(t, bob, realtime.WorkspaceTopic(w.ws))
	e.subscribe(t, bob, realtime.RoomTopic(w.room))
	e.subscribe(t, bob, realtime.RoomTopic(w.other))
	bobConn.take()

	e.sessions.mu.Lock()
	e.sessions.revoked[revokedSID] = true
	e.sessions.mu.Unlock()
	e.auth.revoke(w.bob, w.room)

	e.hub.Revalidate(t.Context())

	if got := aliceConn.closeReasons(); !slices.Equal(got, []realtime.CloseReason{realtime.CloseSessionRevoked}) {
		t.Errorf("alice close reasons = %v, want [CloseSessionRevoked]", got)
	}
	if got := bobConn.closeReasons(); len(got) != 0 {
		t.Errorf("bob was closed: %v", got)
	}
	// イベントを取りこぼしていた前提なので、外した購読の通知を再検証が送る。
	evs := bobConn.takeEvents()
	if len(evs) != 1 || evs[0].Type != chat.EventRoomMemberRemoved {
		t.Fatalf("bob received %v, want one room.member_removed", evs)
	}
	if d, ok := evs[0].Data.(chat.RoomMemberRemoved); !ok || d.RoomID != w.room || d.WorkspaceID != w.ws || d.Reason != chat.RemovalRemoved {
		t.Errorf("room.member_removed data = %+v", evs[0].Data)
	}
	e.hub.DeliverLocal(t.Context(), messageTo(w.room))
	e.hub.DeliverLocal(t.Context(), messageTo(w.other))
	if got := bobConn.take(); !equalTypes(got, chat.EventMessageCreated) {
		t.Errorf("bob received %v after revalidation", got)
	}

	// ワークスペースを読めなくなったら workspace.member_removed を送る。
	e.auth.revoke(w.bob, w.ws)
	e.hub.Revalidate(t.Context())
	evs = bobConn.takeEvents()
	if len(evs) != 1 || evs[0].Type != chat.EventWorkspaceMemberRemoved {
		t.Fatalf("bob received %v, want one workspace.member_removed", evs)
	}
	if d, ok := evs[0].Data.(chat.WorkspaceMemberRemoved); !ok || d.WorkspaceID != w.ws || d.UserID != w.bob {
		t.Errorf("workspace.member_removed data = %+v", evs[0].Data)
	}
}

func TestPresence(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	watcher, watcherConn := e.connect(t, w.bob)
	e.subscribe(t, watcher, realtime.WorkspaceTopic(w.ws))
	watcherConn.take()

	presenceEvents := func() []chat.PresenceChanged {
		var got []chat.PresenceChanged
		for _, ev := range watcherConn.takeEvents() {
			if ev.Type == chat.EventPresenceChanged {
				got = append(got, ev.Data.(chat.PresenceChanged))
			}
		}
		return got
	}

	// 最初の接続でオンラインになり、所属するワークスペースの購読者に知らせる。
	tab1, _ := e.connect(t, w.alice)
	if got := presenceEvents(); !slices.Equal(got, []chat.PresenceChanged{{UserID: w.alice, Online: true}}) {
		t.Errorf("after first connection: %v", got)
	}
	if !e.presence.isOnline(w.alice) {
		t.Error("alice is not online in the presence store")
	}
	// 2 本目の接続・1 本目の切断では変化がないので知らせない。
	tab2, _ := e.connect(t, w.alice)
	e.hub.Unregister(t.Context(), tab1)
	e.hub.Unregister(t.Context(), tab1) // 2 回呼んでも何もしない
	if got := presenceEvents(); len(got) != 0 {
		t.Errorf("while still connected: %v", got)
	}
	// 最後の接続が切れたらオフライン。
	e.hub.Unregister(t.Context(), tab2)
	if got := presenceEvents(); !slices.Equal(got, []chat.PresenceChanged{{UserID: w.alice, Online: false}}) {
		t.Errorf("after last disconnection: %v", got)
	}
	if e.presence.isOnline(w.alice) {
		t.Error("alice is still online in the presence store")
	}

	// 接続中のユーザーの TTL を延ばす。
	e.presence.mu.Lock()
	before := e.presence.refreshes
	e.presence.online = map[ulid.ULID]bool{} // TTL で消えた状態
	e.presence.mu.Unlock()
	e.hub.RefreshPresence(t.Context())
	if !e.presence.isOnline(w.bob) || e.presence.isOnline(w.alice) {
		t.Errorf("after refresh: bob online = %v, alice online = %v", e.presence.isOnline(w.bob), e.presence.isOnline(w.alice))
	}
	e.presence.mu.Lock()
	if e.presence.refreshes != before+1 {
		t.Errorf("Refresh calls = %d, want 1 batched call", e.presence.refreshes-before)
	}
	e.presence.mu.Unlock()
}

// 同じユーザーの接続と切断が並行しても、最後に接続が残っていればオンラインのまま。
func TestPresenceConcurrentConnectDisconnect(t *testing.T) {
	e := newEnv(t)
	userID := ids.New()
	keep, _ := e.connect(t, userID)
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			c, err := e.hub.Register(context.Background(), authn.Identity{UserID: userID, SessionID: ids.New()}, &fakeConn{})
			if err != nil {
				t.Error(err)
				return
			}
			e.hub.Unregister(context.Background(), c)
		})
	}
	wg.Wait()
	if !e.presence.isOnline(userID) {
		t.Fatal("user is offline although a connection remains")
	}
	e.hub.Unregister(t.Context(), keep)
	if e.presence.isOnline(userID) {
		t.Fatal("user is online after all connections closed")
	}
}

func TestTyping(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	e.auth.writable[[2]ulid.ULID{w.alice, w.room}] = true
	alice, aliceConn := e.connect(t, w.alice)
	aliceTab2, aliceTab2Conn := e.connect(t, w.alice)
	bob, bobConn := e.connect(t, w.bob)
	for _, c := range []*realtime.Client{alice, aliceTab2, bob} {
		e.subscribe(t, c, realtime.RoomTopic(w.room))
	}
	aliceConn.take()
	aliceTab2Conn.take()
	bobConn.take()

	// 購読していないルームには送れない。
	if err := e.hub.Typing(t.Context(), alice, w.other); !errors.Is(err, realtime.ErrNotSubscribed) {
		t.Fatalf("Typing(unsubscribed room) error = %v, want ErrNotSubscribed", err)
	}

	if err := e.hub.Typing(t.Context(), alice, w.room); err != nil {
		t.Fatal(err)
	}
	// 入力した本人の接続（別のタブを含む）には返さない。
	evs := bobConn.takeEvents()
	if len(evs) != 1 || evs[0].Type != chat.EventTypingStarted || evs[0].Data.(chat.TypingStarted).User.ID != w.alice {
		t.Fatalf("bob received %v, want one typing.started from alice", evs)
	}
	if got := append(aliceConn.take(), aliceTab2Conn.take()...); len(got) != 0 {
		t.Errorf("alice's connections received %v", got)
	}

	// TTL の間は配信し直さない。
	if err := e.hub.Typing(t.Context(), aliceTab2, w.room); err != nil {
		t.Fatal(err)
	}
	if got := bobConn.take(); len(got) != 0 {
		t.Errorf("bob received %v within the typing TTL", got)
	}

	// 読めるが投稿できない人（参加していない public）は forbidden。
	if err := e.hub.Typing(t.Context(), bob, w.room); !errors.Is(err, chat.ErrForbidden) {
		t.Fatalf("Typing(read-only) error = %v, want ErrForbidden", err)
	}
	if got := aliceConn.take(); len(got) != 0 {
		t.Errorf("alice received %v from a user who cannot post", got)
	}
}

func TestShutdown(t *testing.T) {
	e := newEnv(t)
	c1, conn1 := e.connect(t, ids.New())
	c2, conn2 := e.connect(t, ids.New())

	done := make(chan error, 1)
	go func() { done <- e.hub.Shutdown(context.Background()) }()

	// 実装（httpx）は Close を受けて読み取りを終え、Unregister する。それまで Shutdown は戻らない。
	waitFor(t, func() bool { return len(conn1.closeReasons()) > 0 && len(conn2.closeReasons()) > 0 })
	select {
	case err := <-done:
		t.Fatalf("Shutdown returned before connections unregistered: %v", err)
	default:
	}
	if got := conn1.closeReasons(); !slices.Equal(got, []realtime.CloseReason{realtime.CloseServerShutdown}) {
		t.Errorf("close reasons = %v, want [CloseServerShutdown]", got)
	}
	e.hub.Unregister(t.Context(), c1)
	e.hub.Unregister(t.Context(), c2)
	if err := <-done; err != nil {
		t.Fatalf("Shutdown() = %v", err)
	}
	if _, err := e.hub.Register(t.Context(), authn.Identity{UserID: ids.New(), SessionID: ids.New()}, &fakeConn{}); !errors.Is(err, realtime.ErrShuttingDown) {
		t.Fatalf("Register() after shutdown error = %v, want ErrShuttingDown", err)
	}
	// 接続がなければすぐに戻る。
	if err := newEnv(t).hub.Shutdown(t.Context()); err != nil {
		t.Fatalf("Shutdown() without connections = %v", err)
	}
}

func TestShutdownTimeout(t *testing.T) {
	e := newEnv(t)
	e.connect(t, ids.New())
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := e.hub.Shutdown(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Shutdown() with a stuck connection = %v, want context.Canceled", err)
	}
}

func TestRunStopsOnCancel(t *testing.T) {
	e := newEnv(t)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		e.hub.Run(ctx, time.Millisecond, time.Millisecond)
	}()
	// ticker が何度か回ってから止める。
	waitFor(t, func() bool {
		e.presence.mu.Lock()
		defer e.presence.mu.Unlock()
		return e.presence.refreshes >= 2
	})
	cancel()
	<-done
}

// waitFor は cond が true になるまで待つ。time.Sleep を使わず、ticker で確かめる。
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	timeout := time.After(5 * time.Second)
	for !cond() {
		select {
		case <-ticker.C:
		case <-timeout:
			t.Fatal("condition not met within 5s")
		}
	}
}

// 接続・購読・再検証・切断のどの経路で購読が外れても、Redis のチャンネルの購読の数は釣り合う（購読し続けるチャンネルを残さない）。
func TestSubscriberRefsBalance(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	alice, _ := e.connect(t, w.alice)
	aliceTab2, _ := e.connect(t, w.alice)
	bob, _ := e.connect(t, w.bob)
	for _, c := range []*realtime.Client{alice, aliceTab2, bob} {
		e.subscribe(t, c, realtime.WorkspaceTopic(w.ws))
		e.subscribe(t, c, realtime.RoomTopic(w.room))
	}
	e.subscribe(t, alice, realtime.RoomTopic(w.room)) // 2 回目は数えない
	e.subscribe(t, bob, realtime.RoomTopic(w.other))

	want := map[string]int{
		"user:" + w.alice.String(): 2, "user:" + w.bob.String(): 1,
		"workspace:" + w.ws.String(): 3, "room:" + w.room.String(): 3, "room:" + w.other.String(): 1,
	}
	if got := e.subscriber.channels(); !maps.Equal(got, want) {
		t.Fatalf("channels = %v, want %v", got, want)
	}

	e.hub.Unsubscribe(aliceTab2, realtime.RoomTopic(w.room))
	e.hub.Unsubscribe(aliceTab2, realtime.RoomTopic(w.room))
	// 権限の変更で外れた購読も数から引く。
	e.auth.revoke(w.bob, w.other)
	e.hub.DeliverLocal(t.Context(), chat.Event{
		Type:          chat.EventRoomMemberRemoved,
		To:            chat.Audience{Users: []ulid.ULID{w.bob}},
		AccessChanges: []chat.AccessChange{{UserID: w.bob, WorkspaceID: w.ws}},
	})
	if got := e.subscriber.channels()["room:"+w.other.String()]; got != 0 {
		t.Errorf("room:other refs after removal = %d, want 0", got)
	}
	for _, c := range []*realtime.Client{alice, aliceTab2, bob} {
		e.hub.Unregister(t.Context(), c)
	}
	if got := e.subscriber.channels(); len(got) != 0 {
		t.Fatalf("channels after all connections closed = %v, want none", got)
	}
}

// 本人宛てのチャンネルを購読できなければ（Redis の障害）、イベントが届かない接続を登録しない。
func TestRegisterFailsWithoutUserChannel(t *testing.T) {
	e := newEnv(t)
	e.subscriber.err = errors.New("redis is down")
	if _, err := e.hub.Register(t.Context(), authn.Identity{UserID: ids.New(), SessionID: ids.New()}, &fakeConn{}); err == nil {
		t.Fatal("Register() error = nil, want error")
	}

	e.subscriber.mu.Lock()
	e.subscriber.err = nil
	e.subscriber.mu.Unlock()
	w := e.world()
	alice, _ := e.connect(t, w.alice)
	e.subscriber.mu.Lock()
	e.subscriber.err = errors.New("redis is down")
	e.subscriber.mu.Unlock()
	if err := e.hub.Subscribe(t.Context(), alice, realtime.RoomTopic(w.room)); err == nil {
		t.Fatal("Subscribe() error = nil, want error")
	}
	e.hub.DeliverLocal(t.Context(), messageTo(w.room))
}

// Redis Pub/Sub の接続が張り直されたら、すべての接続を閉じさせて再同期させる。
func TestResyncClosesAllConnections(t *testing.T) {
	e := newEnv(t)
	_, conn1 := e.connect(t, ids.New())
	_, conn2 := e.connect(t, ids.New())
	e.hub.Resync(t.Context())
	for _, c := range []*fakeConn{conn1, conn2} {
		if got := c.closeReasons(); !slices.Equal(got, []realtime.CloseReason{realtime.CloseResync}) {
			t.Errorf("close reasons = %v, want [CloseResync]", got)
		}
	}
}

// Shutdown は、登録を外した後の後始末（presence の更新）が終わるまで戻らない。
// 先に戻ると、main が Redis のクライアントを閉じてから presence を更新しようとして失敗する。
func TestShutdownWaitsForUnregisterCleanup(t *testing.T) {
	e := newEnv(t)
	w := e.world()
	c, _ := e.connect(t, w.alice)

	block := make(chan struct{})
	entered := make(chan struct{})
	e.presence.mu.Lock()
	e.presence.beforeDisconnect = func() {
		close(entered)
		<-block
	}
	e.presence.mu.Unlock()

	unregistered := make(chan struct{})
	go func() {
		defer close(unregistered)
		e.hub.Unregister(context.Background(), c)
	}()
	<-entered // Unregister は登録を外し、presence の更新の途中で止まっている

	done := make(chan error, 1)
	go func() { done <- e.hub.Shutdown(context.Background()) }()
	select {
	case err := <-done:
		t.Fatalf("Shutdown returned before presence was updated: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(block)
	<-unregistered
	if err := <-done; err != nil {
		t.Fatalf("Shutdown() = %v", err)
	}
	if e.presence.isOnline(w.alice) {
		t.Error("alice is still online after shutdown")
	}
}
