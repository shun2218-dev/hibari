// Package realtime は WebSocket の接続を束ねる Hub（ADR 0015）。
//
// Hub はこのインスタンスの接続だけを管理する。インスタンスをまたぐ配信は Redis Pub/Sub が担い（RedisDelivery / Broker。ADR 0016）、
// Hub は Broker から受け取ったイベントを自分の接続に届ける（DeliverLocal）。
// 接続が購読しているチャンネルは、購読の数を Broker に伝え、このインスタンスが必要なチャンネルだけを Redis で購読させる。
//
// Hub が扱うのは「誰がどの接続で何を購読しているか」と「イベントをどの接続に届けるか」だけで、
// WebSocket のフレームや JSON は知らない。接続は Conn インターフェースとして受け取り、書き込みは実装（httpx）の
// 書き込みの goroutine だけが行う（CLAUDE.md「同じ WebSocket 接続に複数の goroutine から書き込まない」）。
package realtime

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/presence"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

const (
	// MaxSubscriptions は 1 つの接続が持てる購読（ルームとワークスペースの合計）の上限。
	MaxSubscriptions = 500
	// RevalidateInterval は、接続中のセッションと購読を DB で確かめ直す間隔（ADR 0007 / 0015）。
	// Access Token の TTL（15 分）より短く、接続数 × 数本のクエリが DB の負荷として目立たない値にする。
	RevalidateInterval = 5 * time.Minute
)

var (
	// ErrTooManySubscriptions は購読が MaxSubscriptions に達したことを表す。
	ErrTooManySubscriptions = errors.New("realtime: too many subscriptions")
	// ErrNotSubscribed は購読していないルームに typing を送ったことを表す。
	ErrNotSubscribed = errors.New("realtime: not subscribed")
	// ErrShuttingDown は停止中の Hub に接続を登録しようとしたことを表す。
	ErrShuttingDown = errors.New("realtime: hub is shutting down")
)

// CloseReason は Hub が接続を閉じさせる理由。close コードへの対応は実装（httpx）が決める（docs/events.md）。
type CloseReason int

const (
	// CloseSlowConsumer は送信キューが一杯になった（クライアントの読み取りが追いつかない）。
	CloseSlowConsumer CloseReason = iota + 1
	// CloseSessionRevoked はセッションが失効した。
	CloseSessionRevoked
	// CloseServerShutdown はサーバーが停止する。
	CloseServerShutdown
	// CloseResync は、Redis との接続が張り直されてイベントを取りこぼしたかもしれない。クライアントは再接続して同期する（ADR 0016）。
	CloseResync
)

// Conn は Hub から見た 1 本の接続。
type Conn interface {
	// Send はイベントを送信キューに入れる。キューが一杯なら待たずに false を返す（Hub が接続を閉じさせる）。
	// 閉じた後に呼ばれたら、何もせずに true を返す。
	Send(ev chat.Event) bool
	// Close は理由を記録して接続を閉じさせる。ブロックせず、何度呼んでもよい。登録の解除は実装が Unregister で行う。
	Close(reason CloseReason)
}

// Authorizer は購読と typing の authz（chat.SubscriptionAuthorizer が実装する）。
type Authorizer interface {
	AuthorizeRoom(ctx context.Context, userID, roomID ulid.ULID) (workspaceID ulid.ULID, err error)
	AuthorizeWorkspace(ctx context.Context, userID, workspaceID ulid.ULID) error
	Allowed(ctx context.Context, userID ulid.ULID, roomIDs, workspaceIDs []ulid.ULID) (rooms, workspaces map[ulid.ULID]bool, err error)
	AuthorizeTyping(ctx context.Context, userID, roomID ulid.ULID, threadRootID *ulid.ULID) (chat.TypingStarted, error)
	WorkspaceIDs(ctx context.Context, userID ulid.ULID) ([]ulid.ULID, error)
}

// Presence は presence と typing の置き場所（presence.Store が実装する）。
// presence の変化のイベントは、状態の変更と同じ Lua スクリプトの中で publish させる（ADR 0016）。
type Presence interface {
	// Sync はこのインスタンスの接続の数と、そのうち画面を見ている数を記録する（ADR 0049 決定 2）。
	Sync(ctx context.Context, userID ulid.ULID, conns, active int, ann presence.Announcement) (presence.State, error)
	// Refresh はユーザーごとの「見ている接続の数」でフィールドを置き直し、TTL を延ばす。
	Refresh(ctx context.Context, counts map[ulid.ULID]int) error
	StartTyping(ctx context.Context, roomID, userID ulid.ULID, threadRootID *ulid.ULID) (bool, error)
}

// Publisher はイベントをすべてのインスタンスに向けて publish する（*RedisDelivery が実装する）。
type Publisher interface {
	chat.Delivery
	// Encode はイベントを publish する形（宛先のチャンネルと中身）にする。
	// presence は状態の変更と publish を 1 つの Lua スクリプトで行うので、Hub がこれを presence に渡す（ADR 0016）。
	Encode(ev chat.Event) (channels []string, payload []byte, err error)
}

// Subscriber は Redis Pub/Sub のチャンネルの購読を数える（*Broker が実装する）。
type Subscriber interface {
	// Acquire は購読を 1 つ増やし、Redis が反映するまで待つ。成功したら後で Release を呼ぶ。
	Acquire(ctx context.Context, channel string) error
	Release(channel string)
}

// Deps は Hub の依存。
type Deps struct {
	Authorizer Authorizer
	Presence   Presence
	Sessions   authn.SessionChecker
	Publisher  Publisher
	Subscriber Subscriber
	Logger     *slog.Logger
}

// Topic は購読の対象。RoomID と WorkspaceID のどちらか一方だけを持つ。
type Topic struct {
	RoomID      ulid.ULID
	WorkspaceID ulid.ULID
}

// RoomTopic はルームの購読の対象を返す。
func RoomTopic(roomID ulid.ULID) Topic { return Topic{RoomID: roomID} }

// WorkspaceTopic はワークスペースの購読の対象を返す。
func WorkspaceTopic(workspaceID ulid.ULID) Topic { return Topic{WorkspaceID: workspaceID} }

// Client は Hub に登録された 1 本の接続。
type Client struct {
	identity authn.Identity
	conn     Conn

	// 以下は Hub.mu で守る。
	// rooms はルームの ID → そのルームのワークスペースの ID。権限が変わったワークスペースの購読だけを再検証するのに使う。
	rooms      map[ulid.ULID]ulid.ULID
	workspaces map[ulid.ULID]struct{}
	registered bool
	// active はこの接続が画面を見ているか（ADR 0049 決定 3）。
	// **接続は「見ていない」から始まる**。つないだ直後にクライアントが今の値を送る。
	// 逆にすると、見ていないタブの再接続のたびに、そのユーザーが一瞬オンラインに見える。
	active bool
}

// Identity は接続の主体を返す。
func (c *Client) Identity() authn.Identity { return c.identity }

type clientSet map[*Client]struct{}

func (s clientSet) add(c *Client) { s[c] = struct{}{} }

// presenceStripes は presence の遷移を直列化するロックの数。同じユーザーの接続と切断は同じロックで順番に処理し、
// 別のユーザー同士はほとんど待ち合わないようにする。
const presenceStripes = 64

// Hub はこのインスタンスの接続と購読を管理し、イベントを接続に届ける。
type Hub struct {
	auth       Authorizer
	presence   Presence
	sessions   authn.SessionChecker
	publisher  Publisher
	subscriber Subscriber
	logger     *slog.Logger

	mu            sync.Mutex
	clients       clientSet
	byUser        map[ulid.ULID]clientSet
	bySession     map[ulid.ULID]clientSet
	roomSubs      map[ulid.ULID]clientSet
	workspaceSubs map[ulid.ULID]clientSet
	// epochs はユーザーごとの「購読の再検証を始めた回数」。
	// 購読の authz の前後で値が変わっていたら、authz が権限の変更の前の DB を読んだ可能性があるので、やり直す（ADR 0015）。
	epochs map[ulid.ULID]uint64
	// announced は、このインスタンスが presence に記録した数（接続の数と、そのうち見ている数）。
	// 同じ値なら Redis に書き直さない。
	announced    map[ulid.ULID]presenceCounts
	shuttingDown bool
	// unregistering は、登録を外したが後始末（Redis の購読の解除と presence の更新）が終わっていない Unregister の数。
	unregistering int
	// drained は、停止中に接続が 0 本になり、後始末もすべて終わったら閉じる。
	// 後始末を待たずに閉じると、呼び出し側（main）が Redis のクライアントを先に閉じて、presence が更新されずに残る。
	drained     chan struct{}
	drainClosed bool

	presenceLocks [presenceStripes]sync.Mutex
}

// presenceCounts はこのインスタンスの、あるユーザーの接続の数と、そのうち画面を見ている数。
type presenceCounts struct {
	conns  int
	active int
}

var _ Receiver = (*Hub)(nil)

// NewHub は Hub を返す。
func NewHub(d Deps) *Hub {
	return &Hub{
		auth:          d.Authorizer,
		presence:      d.Presence,
		sessions:      d.Sessions,
		publisher:     d.Publisher,
		subscriber:    d.Subscriber,
		logger:        d.Logger,
		clients:       clientSet{},
		byUser:        map[ulid.ULID]clientSet{},
		bySession:     map[ulid.ULID]clientSet{},
		roomSubs:      map[ulid.ULID]clientSet{},
		workspaceSubs: map[ulid.ULID]clientSet{},
		epochs:        map[ulid.ULID]uint64{},
		announced:     map[ulid.ULID]presenceCounts{},
		drained:       make(chan struct{}),
	}
}

// Register は検証済みの id の接続を登録する。そのユーザーの最初の接続なら、オンラインにして知らせる。
//
// 本人宛てのイベント（user チャンネル）の購読を Redis が反映してから登録する。戻った後に起きた本人宛てのイベントを取りこぼさないため。
func (h *Hub) Register(ctx context.Context, id authn.Identity, conn Conn) (*Client, error) {
	c := &Client{identity: id, conn: conn, rooms: map[ulid.ULID]ulid.ULID{}, workspaces: map[ulid.ULID]struct{}{}}
	h.mu.Lock()
	shuttingDown := h.shuttingDown
	h.mu.Unlock()
	if shuttingDown {
		return nil, ErrShuttingDown
	}
	if err := h.subscriber.Acquire(ctx, userChannel(id.UserID)); err != nil {
		// 停止が始まっていれば、購読が失敗した原因は Redis のクライアントが閉じたこと（main の defer）なので、
		// 内部エラーではなく「サーバーが止まる」として返す。実装（httpx）はこれを 1001 で閉じ、クライアントは再接続する。
		// 接続の受け付け（websocket.Accept）と登録の間に Shutdown が終わると、この順序になりうる。
		h.mu.Lock()
		shuttingDown := h.shuttingDown
		h.mu.Unlock()
		if shuttingDown {
			return nil, ErrShuttingDown
		}
		return nil, fmt.Errorf("subscribe user channel: %w", err)
	}
	h.mu.Lock()
	if h.shuttingDown {
		h.mu.Unlock()
		h.subscriber.Release(userChannel(id.UserID))
		return nil, ErrShuttingDown
	}
	c.registered = true
	h.clients.add(c)
	addTo(h.byUser, id.UserID, c)
	addTo(h.bySession, id.SessionID, c)
	h.mu.Unlock()

	h.syncPresence(ctx, id.UserID)
	return c, nil
}

// Unregister は接続の登録と購読をすべて外す。そのユーザーの最後の接続なら、オフラインにして知らせる。何度呼んでもよい。
func (h *Hub) Unregister(ctx context.Context, c *Client) {
	h.mu.Lock()
	if !c.registered {
		h.mu.Unlock()
		return
	}
	c.registered = false
	delete(h.clients, c)
	removeFrom(h.byUser, c.identity.UserID, c)
	removeFrom(h.bySession, c.identity.SessionID, c)
	channels := []string{userChannel(c.identity.UserID)}
	for roomID := range c.rooms {
		removeFrom(h.roomSubs, roomID, c)
		channels = append(channels, roomChannel(roomID))
	}
	for workspaceID := range c.workspaces {
		removeFrom(h.workspaceSubs, workspaceID, c)
		channels = append(channels, workspaceChannel(workspaceID))
	}
	if _, ok := h.byUser[c.identity.UserID]; !ok {
		delete(h.epochs, c.identity.UserID)
	}
	h.unregistering++
	h.mu.Unlock()

	// Redis への送信はロックの外で行う（ほかの接続への配信を止めない）。
	h.release(channels)
	// 接続が切れた後の後始末なので、呼び出し側の ctx がキャンセル済みでも presence は更新する。
	h.syncPresence(context.WithoutCancel(ctx), c.identity.UserID)

	h.mu.Lock()
	h.unregistering--
	h.closeDrainedLocked()
	h.mu.Unlock()
}

// closeDrainedLocked は、停止中で、接続も後始末中の Unregister もなくなったら drained を閉じる。
func (h *Hub) closeDrainedLocked() {
	if h.shuttingDown && !h.drainClosed && len(h.clients) == 0 && h.unregistering == 0 {
		h.drainClosed = true
		close(h.drained)
	}
}

// Subscribe は購読を始める。authz を通らなければ chat.ErrNotFound（存在を明かさない）。すでに購読していれば何もしない。
func (h *Hub) Subscribe(ctx context.Context, c *Client, t Topic) error {
	userID := c.identity.UserID
	for {
		h.mu.Lock()
		if !c.registered || c.subscribed(t) {
			h.mu.Unlock()
			return nil
		}
		if len(c.rooms)+len(c.workspaces) >= MaxSubscriptions {
			h.mu.Unlock()
			return ErrTooManySubscriptions
		}
		epoch := h.epochs[userID]
		h.mu.Unlock()

		// DB を読む間はロックを持たない（ほかの接続への配信を止めない）。
		var workspaceID ulid.ULID
		var err error
		if t.RoomID != (ulid.ULID{}) {
			workspaceID, err = h.auth.AuthorizeRoom(ctx, userID, t.RoomID)
		} else {
			err = h.auth.AuthorizeWorkspace(ctx, userID, t.WorkspaceID)
		}
		if err != nil {
			return err
		}
		// Redis が購読を反映してから ack を返す。ack の後に REST を読むクライアントが、その間のイベントを取りこぼさないため（ADR 0016）。
		if err := h.subscriber.Acquire(ctx, t.channel()); err != nil {
			return err
		}

		h.mu.Lock()
		if h.epochs[userID] != epoch {
			// authz の間にこのユーザーの権限が変わった。authz が変更の前の DB を読んで通った可能性があるので、やり直す。
			h.mu.Unlock()
			h.subscriber.Release(t.channel())
			continue
		}
		added := c.registered && !c.subscribed(t)
		if added {
			if t.RoomID != (ulid.ULID{}) {
				c.rooms[t.RoomID] = workspaceID
				addTo(h.roomSubs, t.RoomID, c)
			} else {
				c.workspaces[t.WorkspaceID] = struct{}{}
				addTo(h.workspaceSubs, t.WorkspaceID, c)
			}
		}
		h.mu.Unlock()
		if !added {
			h.subscriber.Release(t.channel())
		}
		return nil
	}
}

// Unsubscribe は購読をやめる。購読していなければ何もしない。
func (h *Hub) Unsubscribe(c *Client, t Topic) {
	h.mu.Lock()
	removed := h.unsubscribeLocked(c, t)
	h.mu.Unlock()
	if removed {
		h.subscriber.Release(t.channel())
	}
}

// unsubscribeLocked は購読を外し、外したら true を返す。呼び出し側はロックを外してから Release する。
func (h *Hub) unsubscribeLocked(c *Client, t Topic) bool {
	if t.RoomID != (ulid.ULID{}) {
		if _, ok := c.rooms[t.RoomID]; ok {
			delete(c.rooms, t.RoomID)
			removeFrom(h.roomSubs, t.RoomID, c)
			return true
		}
		return false
	}
	if _, ok := c.workspaces[t.WorkspaceID]; ok {
		delete(c.workspaces, t.WorkspaceID)
		removeFrom(h.workspaceSubs, t.WorkspaceID, c)
		return true
	}
	return false
}

func (h *Hub) release(channels []string) {
	for _, ch := range channels {
		h.subscriber.Release(ch)
	}
}

func (c *Client) subscribed(t Topic) bool {
	if t.RoomID != (ulid.ULID{}) {
		_, ok := c.rooms[t.RoomID]
		return ok
	}
	_, ok := c.workspaces[t.WorkspaceID]
	return ok
}

// Typing は、ユーザーがルームで入力中であることを、そのルームの購読者（本人の接続を除く）に知らせる。
// threadRootID を渡したら、そのスレッドで入力している（ADR 0036）。スレッドの購読はないので、宛先はルームの購読者のまま。
//
// 購読しているルームだけを受け付ける。Redis の SET NX で 5 秒に 1 回に間引き、配信するときだけ投稿できるかを DB で確かめる（ADR 0015）。
// そのため、投稿できない人の 2 回目以降は TTL の間エラーにならずに何も起きない。typing は表示の補助なので、それで困らない。
func (h *Hub) Typing(ctx context.Context, c *Client, roomID ulid.ULID, threadRootID *ulid.ULID) error {
	h.mu.Lock()
	_, ok := c.rooms[roomID]
	h.mu.Unlock()
	if !ok {
		return ErrNotSubscribed
	}
	userID := c.identity.UserID
	first, err := h.presence.StartTyping(ctx, roomID, userID, threadRootID)
	if err != nil || !first {
		return err
	}
	data, err := h.auth.AuthorizeTyping(ctx, userID, roomID, threadRootID)
	if err != nil {
		return err
	}
	h.publisher.Deliver(ctx, chat.Event{
		Type: chat.EventTypingStarted,
		To:   chat.Audience{Rooms: []ulid.ULID{roomID}, ExceptUser: userID},
		Data: data,
	})
	return nil
}

// DeliverLocal はイベントを、このインスタンスの宛先の接続に届ける（Broker が Redis から受け取ったイベントを渡す）。
// 権限が変わったユーザーの接続がこのインスタンスにあれば、先にその購読を再検証する（CLAUDE.md ルール 8）。
func (h *Hub) DeliverLocal(ctx context.Context, ev chat.Event) {
	for _, ch := range ev.AccessChanges {
		workspaceID := ch.WorkspaceID
		// 通知はイベントそのものが担うので、再検証では購読を外すだけにする。
		h.revalidateUser(ctx, ch.UserID, &workspaceID, false)
	}

	h.mu.Lock()
	targets := clientSet{}
	for _, id := range ev.To.Rooms {
		for c := range h.roomSubs[id] {
			targets.add(c)
		}
	}
	for _, id := range ev.To.Workspaces {
		for c := range h.workspaceSubs[id] {
			targets.add(c)
		}
	}
	for _, id := range ev.To.Users {
		for c := range h.byUser[id] {
			targets.add(c)
		}
	}
	if ev.To.ExceptUser != (ulid.ULID{}) {
		for c := range h.byUser[ev.To.ExceptUser] {
			delete(targets, c)
		}
	}
	h.mu.Unlock()

	// Send は待たないので、ロックの外でも配信全体が 1 本の遅い接続に引きずられない。
	for c := range targets {
		h.send(ctx, c, ev)
	}
}

func (h *Hub) send(ctx context.Context, c *Client, ev chat.Event) {
	if c.conn.Send(ev) {
		return
	}
	// 待たずに切る。クライアントは再接続して差分を取る（ADR 0004 / 0015）。
	h.logger.WarnContext(ctx, "websocket send queue is full; closing",
		slog.String("user_id", c.identity.UserID.String()), slog.String("event", string(ev.Type)))
	c.conn.Close(CloseSlowConsumer)
}

// revalidateUser は userID のすべての接続の購読（workspaceID が nil でなければ、そのワークスペースのものだけ）を DB で確かめ直し、
// 読めなくなったものを外す。notify なら、外した接続に workspace.member_removed / room.member_removed を送る。
func (h *Hub) revalidateUser(ctx context.Context, userID ulid.ULID, workspaceID *ulid.ULID, notify bool) {
	inScope := func(ws ulid.ULID) bool { return workspaceID == nil || *workspaceID == ws }

	h.mu.Lock()
	if _, ok := h.byUser[userID]; !ok {
		h.mu.Unlock()
		return
	}
	// 先に epoch を進める。これより前に authz を始めた Subscribe は、登録の直前にやり直しになる。
	h.epochs[userID]++
	roomSet, workspaceSet := map[ulid.ULID]bool{}, map[ulid.ULID]bool{}
	for c := range h.byUser[userID] {
		for roomID, ws := range c.rooms {
			if inScope(ws) {
				roomSet[roomID] = true
			}
		}
		for ws := range c.workspaces {
			if inScope(ws) {
				workspaceSet[ws] = true
			}
		}
	}
	h.mu.Unlock()
	if len(roomSet) == 0 && len(workspaceSet) == 0 {
		return
	}

	allowedRooms, allowedWorkspaces, err := h.auth.Allowed(ctx, userID, keys(roomSet), keys(workspaceSet))
	if err != nil {
		// 確かめられないときは外さない。一時的な DB の障害で「外されました」を出さないため。次の定期の再検証でやり直す。
		h.logger.ErrorContext(ctx, "revalidate subscriptions failed", slog.String("user_id", userID.String()), slog.Any("error", err))
		return
	}

	type removal struct {
		c  *Client
		ev chat.Event
	}
	var removals []removal
	var released []string
	h.mu.Lock()
	for c := range h.byUser[userID] {
		// 確かめた集合（roomSet / workspaceSet）に入っていた購読だけを外す。
		// その後に追加された購読は、進めた epoch の下で authz を通っているので、変更の後の DB を読んでいる。
		for roomID, ws := range c.rooms {
			if roomSet[roomID] && !allowedRooms[roomID] {
				h.unsubscribeLocked(c, RoomTopic(roomID))
				released = append(released, roomChannel(roomID))
				removals = append(removals, removal{c, chat.Event{
					Type: chat.EventRoomMemberRemoved,
					Data: chat.RoomMemberRemoved{WorkspaceID: ws, RoomID: roomID, Reason: chat.RemovalRemoved},
				}})
			}
		}
		for ws := range c.workspaces {
			if workspaceSet[ws] && !allowedWorkspaces[ws] {
				h.unsubscribeLocked(c, WorkspaceTopic(ws))
				released = append(released, workspaceChannel(ws))
				removals = append(removals, removal{c, chat.Event{
					Type: chat.EventWorkspaceMemberRemoved,
					Data: chat.WorkspaceMemberRemoved{WorkspaceID: ws, UserID: userID, Reason: chat.RemovalRemoved},
				}})
			}
		}
	}
	h.mu.Unlock()
	h.release(released)

	if notify {
		for _, r := range removals {
			h.send(ctx, r.c, r.ev)
		}
	}
}

// CloseSessions は失効イベントに該当する接続をすべて閉じさせる（ADR 0007）。
func (h *Hub) CloseSessions(_ context.Context, rev authn.Revocation) {
	h.mu.Lock()
	var targets []*Client
	set := h.bySession[rev.SessionID]
	if rev.All {
		set = h.byUser[rev.UserID]
	}
	for c := range set {
		targets = append(targets, c)
	}
	h.mu.Unlock()
	for _, c := range targets {
		c.conn.Close(CloseSessionRevoked)
	}
}

// Resync は、このインスタンスのすべての接続を閉じさせ、クライアントに再接続と差分の取得をさせる。
// Redis Pub/Sub の接続が張り直されたとき（その間のイベントが失われたとき）に Broker が呼ぶ（ADR 0016）。
func (h *Hub) Resync(_ context.Context) {
	for _, c := range h.allClients() {
		c.conn.Close(CloseResync)
	}
}

func (h *Hub) allClients() []*Client {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		out = append(out, c)
	}
	return out
}

// Revalidate は、すべての接続のセッションと購読を DB で確かめ直す（ADR 0015 の定期的な再検証）。
// 失効イベントや権限の変更のイベントを取りこぼしたときの保険。
func (h *Hub) Revalidate(ctx context.Context) {
	h.mu.Lock()
	sessions := map[ulid.ULID]ulid.ULID{} // sid → userID
	users := make([]ulid.ULID, 0, len(h.byUser))
	for userID := range h.byUser {
		users = append(users, userID)
	}
	for sid, set := range h.bySession {
		for c := range set {
			sessions[sid] = c.identity.UserID
			break
		}
	}
	h.mu.Unlock()

	for sid, userID := range sessions {
		active, err := h.sessions.SessionActive(ctx, userID, sid)
		if err != nil {
			h.logger.ErrorContext(ctx, "check session failed", slog.String("session_id", sid.String()), slog.Any("error", err))
			continue
		}
		if !active {
			h.CloseSessions(ctx, authn.Revocation{SessionID: sid})
		}
	}
	for _, userID := range users {
		if ctx.Err() != nil {
			return
		}
		h.revalidateUser(ctx, userID, nil, true)
	}
}

// RefreshPresence は、このインスタンスに接続しているユーザーの presence の TTL を延ばす。
// 置き直す値は「見ている接続の数」。'1' で置き直すと、見ていない接続が突然オンラインに戻る。
func (h *Hub) RefreshPresence(ctx context.Context) {
	h.mu.Lock()
	counts := make(map[ulid.ULID]int, len(h.announced))
	for userID, c := range h.announced {
		counts[userID] = c.active
	}
	h.mu.Unlock()
	if err := h.presence.Refresh(ctx, counts); err != nil {
		h.logger.ErrorContext(ctx, "refresh presence failed", slog.Any("error", err))
	}
}

// Run は ctx がキャンセルされるまで、presence の延長と定期的な再検証を繰り返す。
func (h *Hub) Run(ctx context.Context, presenceInterval, revalidateInterval time.Duration) {
	presenceTicker := time.NewTicker(presenceInterval)
	defer presenceTicker.Stop()
	revalidateTicker := time.NewTicker(revalidateInterval)
	defer revalidateTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-presenceTicker.C:
			h.RefreshPresence(ctx)
		case <-revalidateTicker.C:
			h.Revalidate(ctx)
		}
	}
}

// Shutdown は新しい接続の登録を止め、すべての接続を閉じさせて、登録が外れるまで待つ。
// http.Server.Shutdown はアップグレード済みの接続を扱わないので、サーバーの停止時にこれを呼ぶ。
func (h *Hub) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	h.shuttingDown = true
	h.closeDrainedLocked()
	h.mu.Unlock()

	for _, c := range h.allClients() {
		c.conn.Close(CloseServerShutdown)
	}
	select {
	case <-h.drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// syncPresence は、userID のこのインスタンスの接続の数と「見ている数」を presence に記録する。
// 状態（offline / idle / active）がインスタンスをまたいで変わったときだけ、Lua スクリプトが presence.changed を publish する。
//
// 同じユーザーの遷移はこのインスタンスの中でロックで直列にする。「最後の接続の切断」と「新しい接続」が並行すると、
// Redis の HDEL と HSET の順序が入れ替わり、接続しているのにフィールドが消えることがあるため。
func (h *Hub) syncPresence(ctx context.Context, userID ulid.ULID) {
	lock := &h.presenceLocks[int(userID[len(userID)-1])%presenceStripes]
	lock.Lock()
	defer lock.Unlock()

	h.mu.Lock()
	counts := h.countsLocked(userID)
	if counts == h.announced[userID] {
		h.mu.Unlock()
		return
	}
	if counts.conns > 0 {
		h.announced[userID] = counts
	} else {
		delete(h.announced, userID)
	}
	h.mu.Unlock()

	// 宛先のワークスペースを読めなくても presence は更新する（REST の presence を正しく保つ）。そのときは知らせない。
	var ann presence.Announcement
	workspaces, err := h.auth.WorkspaceIDs(ctx, userID)
	if err != nil {
		h.logger.ErrorContext(ctx, "list workspaces for presence failed", slog.String("user_id", userID.String()), slog.Any("error", err))
	} else {
		// どの状態になるかを決めるのは Lua（ほかのインスタンスのフィールドも見る）なので、状態ごとの中身を渡す。
		ann = presence.Announcement{Payloads: map[presence.State][]byte{}}
		for _, st := range []presence.State{presence.StateOffline, presence.StateIdle, presence.StateActive} {
			channels, payload, err := h.publisher.Encode(chat.Event{
				Type: chat.EventPresenceChanged,
				To:   chat.Audience{Workspaces: workspaces},
				Data: chat.PresenceChanged{UserID: userID, Presence: chat.Presence(st)},
			})
			if err != nil {
				h.logger.ErrorContext(ctx, "encode presence event failed", slog.String("user_id", userID.String()), slog.Any("error", err))
				ann = presence.Announcement{}
				break
			}
			ann.Channels = channels
			ann.Payloads[st] = payload
		}
	}
	if _, err := h.presence.Sync(ctx, userID, counts.conns, counts.active, ann); err != nil {
		// 接続中なら RefreshPresence が次の周期でフィールドを置き直す。切断なら TTL で消える。
		h.logger.ErrorContext(ctx, "update presence failed", slog.String("user_id", userID.String()), slog.Any("error", err))
	}
}

// countsLocked は、このインスタンスの userID の接続の数と、そのうち画面を見ている数を数える（h.mu を持って呼ぶ）。
func (h *Hub) countsLocked(userID ulid.ULID) presenceCounts {
	var counts presenceCounts
	for c := range h.byUser[userID] {
		counts.conns++
		if c.active {
			counts.active++
		}
	}
	return counts
}

// SetActivity は、この接続が画面を見ているかを記録する（クライアントの activity。ADR 0049 決定 3）。
// 変わったときだけ presence を書き直す。
func (h *Hub) SetActivity(ctx context.Context, c *Client, active bool) {
	h.mu.Lock()
	if !c.registered || c.active == active {
		h.mu.Unlock()
		return
	}
	c.active = active
	h.mu.Unlock()

	h.syncPresence(ctx, c.identity.UserID)
}

func addTo(m map[ulid.ULID]clientSet, key ulid.ULID, c *Client) {
	set, ok := m[key]
	if !ok {
		set = clientSet{}
		m[key] = set
	}
	set.add(c)
}

func removeFrom(m map[ulid.ULID]clientSet, key ulid.ULID, c *Client) {
	set, ok := m[key]
	if !ok {
		return
	}
	delete(set, c)
	if len(set) == 0 {
		delete(m, key)
	}
}

func keys(m map[ulid.ULID]bool) []ulid.ULID {
	out := make([]ulid.ULID, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
