package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// WebSocket の接続（ロードマップ Phase 4 / ADR 0015）。プロトコルとイベントの形の正本は docs/events.md。
//
// ここが担うのは、ws-ticket の API、アップグレード、接続ごとの読み書きの goroutine、JSON の形だけ。
// 購読の管理と宛先の解決は Hub（internal/chat/realtime）が行う。

// RealtimeHub は httpx が使う Hub の操作（realtime.Hub が実装する）。
type RealtimeHub interface {
	Register(ctx context.Context, id authn.Identity, conn realtime.Conn) (*realtime.Client, error)
	Unregister(ctx context.Context, c *realtime.Client)
	Subscribe(ctx context.Context, c *realtime.Client, t realtime.Topic) error
	Unsubscribe(c *realtime.Client, t realtime.Topic)
	Typing(ctx context.Context, c *realtime.Client, roomID ulid.ULID) error
}

// WSTicketStore は ws-ticket の発行と消費（authn.WSTickets が実装する）。
type WSTicketStore interface {
	Issue(ctx context.Context, id authn.Identity) (string, error)
	Consume(ctx context.Context, ticket string) (authn.Identity, error)
}

// WSConfig は WebSocket の接続の設定。
type WSConfig struct {
	// OriginPatterns はブラウザからの接続を許す Origin のホスト（coder/websocket の書式）。
	// Origin ヘッダのないクライアント（ネイティブアプリ）は常に許す。
	OriginPatterns []string
	// PingInterval ごとに ping を送り、PongTimeout までに pong がなければ切る。
	PingInterval time.Duration
	PongTimeout  time.Duration
	// WriteTimeout は 1 回の書き込みの上限。
	WriteTimeout time.Duration
	// SendQueue は送信キューの長さ。一杯になったら待たずに切る（Hub の CloseSlowConsumer）。
	SendQueue int
}

// DefaultWSConfig は ADR 0015 の値。
func DefaultWSConfig(originPatterns []string) WSConfig {
	return WSConfig{
		OriginPatterns: originPatterns,
		PingInterval:   30 * time.Second,
		PongTimeout:    30 * time.Second,
		WriteTimeout:   10 * time.Second,
		SendQueue:      64,
	}
}

const (
	// wsReadLimit はクライアントからの 1 フレームの上限。超えるとライブラリが 1009 で閉じる。
	wsReadLimit = 4 << 10
	// wsMaxMessageID はクライアントが付ける id の長さの上限。
	wsMaxMessageID = 64
)

// close コード（docs/events.md）。4000 番台はアプリケーションが自由に使える範囲（RFC 6455 §7.4.2）。
const (
	closeSlowConsumer   websocket.StatusCode = 4000
	closeSessionRevoked websocket.StatusCode = 4001
)

type wsHandlers struct {
	hub      RealtimeHub
	tickets  WSTicketStore
	sessions authn.SessionChecker
	cfg      WSConfig
	logger   *slog.Logger
}

func registerWSRoutes(mux *http.ServeMux, d Deps) {
	h := &wsHandlers{hub: d.Realtime, tickets: d.WSTickets, sessions: d.Sessions, cfg: d.WS, logger: d.Logger}
	mux.Handle("POST /api/v1/ws/ticket", authn.Require(d.Verifier, writeUnauthorized)(http.HandlerFunc(h.issueTicket)))
	// Access Token ではなく ws-ticket で認証する。ブラウザの WebSocket はヘッダを付けられないため（ADR 0007）。
	mux.HandleFunc("GET /api/v1/ws", h.connect)
}

type wsTicketResponse struct {
	Ticket    string `json:"ticket"`
	ExpiresIn int    `json:"expires_in"`
}

func (h *wsHandlers) issueTicket(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	ticket, err := h.tickets.Issue(r.Context(), id)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	// ticket は秘密なので、キャッシュさせない。
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, wsTicketResponse{Ticket: ticket, ExpiresIn: int(authn.WSTicketTTL / time.Second)})
}

func writeWSTicketInvalid(w http.ResponseWriter, r *http.Request) {
	writeProblem(w, r, problem{Type: "ws-ticket-invalid", Title: "The WebSocket ticket is invalid or has expired", Status: http.StatusUnauthorized})
}

// connect は ws-ticket を消費し、セッションが有効なら WebSocket にアップグレードして、切れるまで読み続ける。
func (h *wsHandlers) connect(w http.ResponseWriter, r *http.Request) {
	id, err := h.tickets.Consume(r.Context(), r.URL.Query().Get("ticket"))
	if errors.Is(err, authn.ErrInvalidWSTicket) {
		writeWSTicketInvalid(w, r)
		return
	}
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	// ticket を発行した後にログアウトしていれば、ここで拒否する（ADR 0007 の「ws-ticket の消費時の検証」）。
	active, err := h.sessions.SessionActive(r.Context(), id.UserID, id.SessionID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if !active {
		writeWSTicketInvalid(w, r)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.cfg.OriginPatterns})
	if err != nil {
		// Accept がエラーのレスポンス（Origin の拒否など）を書いている。
		h.logger.InfoContext(r.Context(), "websocket upgrade rejected",
			slog.String("request_id", RequestID(r.Context())), slog.String("client_ip", logIP(clientIPFrom(r.Context()))), slog.Any("error", err))
		return
	}
	conn.SetReadLimit(wsReadLimit)
	h.serve(r.Context(), conn, id)
}

// serve は 1 本の接続の寿命を管理する。
//
//	読み取り: この goroutine（HTTP のハンドラ）が読み続け、subscribe などを Hub に渡し、ack を送信キューに入れる
//	書き込み: writeLoop の goroutine だけが接続に書く（イベント・ack・ping・close）
//
// 読み取りが終わったら書き込みを止め、書き込みの goroutine が終わるのを待ってから Hub の登録を外す。
func (h *wsHandlers) serve(ctx context.Context, conn *websocket.Conn, id authn.Identity) {
	c := newWSConn(ctx, conn, h.cfg, h.logger)
	client, err := h.hub.Register(ctx, id, c)
	if err != nil {
		// 書き込みの goroutine はまだ起動していないので、ここで閉じる。
		if errors.Is(err, realtime.ErrShuttingDown) {
			_ = conn.Close(websocket.StatusGoingAway, "")
			return
		}
		// 本人宛てのチャンネルを購読できない（Redis の障害など）。イベントが届かない接続を残さず、再接続させる。
		h.logger.ErrorContext(ctx, "register websocket failed", slog.String("user_id", id.UserID.String()), slog.Any("error", err))
		_ = conn.Close(websocket.StatusInternalError, "")
		return
	}
	go c.writeLoop()
	defer func() {
		c.closeWith(websocket.StatusNormalClosure)
		<-c.done
		h.hub.Unregister(ctx, client)
	}()

	for {
		// Read の ctx にはキャンセルされない context を渡す。キャンセルされるとライブラリが close フレームを書かずに接続を切るので、
		// Hub から閉じるときも書き込みの goroutine に close フレームを書かせて、その結果として Read を終わらせる。
		typ, data, err := conn.Read(context.WithoutCancel(ctx))
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			c.closeWith(websocket.StatusPolicyViolation)
			return
		}
		if ack := h.handleMessage(ctx, client, data); ack != nil {
			if !c.enqueue(wsFrame{ack: ack}) {
				// ack も送れないほど詰まっているなら、イベントと同じく切る。
				c.Close(realtime.CloseSlowConsumer)
				return
			}
		}
	}
}

// clientMessage はクライアントからのメッセージ（docs/events.md「クライアント → サーバー」）。
type clientMessage struct {
	Type        string  `json:"type"`
	ID          *string `json:"id"`
	RoomID      string  `json:"room_id"`
	WorkspaceID string  `json:"workspace_id"`
}

type ackMessage struct {
	Type  string  `json:"type"`
	ID    *string `json:"id,omitempty"`
	Error string  `json:"error,omitempty"`
}

// ack の error の値（docs/events.md）。
const (
	ackInvalidMessage       = "invalid_message"
	ackNotFound             = "not_found"
	ackNotSubscribed        = "not_subscribed"
	ackForbidden            = "forbidden"
	ackTooManySubscriptions = "too_many_subscriptions"
	ackInternal             = "internal"
)

// handleMessage は 1 件のメッセージを処理し、返す ack を返す。id がなく成功したら nil（返さない）。
func (h *wsHandlers) handleMessage(ctx context.Context, client *realtime.Client, data []byte) *ackMessage {
	var m clientMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return &ackMessage{Type: "ack", Error: ackInvalidMessage}
	}
	if m.ID != nil && len(*m.ID) > wsMaxMessageID {
		return &ackMessage{Type: "ack", Error: ackInvalidMessage}
	}
	reply := func(err error) *ackMessage {
		if err == nil && m.ID == nil {
			return nil
		}
		ack := &ackMessage{Type: "ack", ID: m.ID}
		if err != nil {
			ack.Error = h.ackError(ctx, client, m.Type, err)
		}
		return ack
	}

	switch m.Type {
	case "subscribe", "unsubscribe":
		t, err := parseTopic(m)
		if err != nil {
			return reply(err)
		}
		if m.Type == "unsubscribe" {
			h.hub.Unsubscribe(client, t)
			return reply(nil)
		}
		return reply(h.hub.Subscribe(ctx, client, t))
	case "typing":
		roomID, err := ulid.ParseStrict(m.RoomID)
		if err != nil || m.WorkspaceID != "" {
			return reply(errInvalidMessage)
		}
		return reply(h.hub.Typing(ctx, client, roomID))
	case "ping":
		// ブラウザは WebSocket の ping フレームを送れないので、アプリケーションの ping には id がなくても ack を返す。
		return &ackMessage{Type: "ack", ID: m.ID}
	default:
		return reply(errInvalidMessage)
	}
}

var errInvalidMessage = errors.New("invalid websocket message")

// parseTopic は room_id と workspace_id のどちらか一方だけを読む。
func parseTopic(m clientMessage) (realtime.Topic, error) {
	switch {
	case m.RoomID != "" && m.WorkspaceID == "":
		id, err := ulid.ParseStrict(m.RoomID)
		if err != nil {
			return realtime.Topic{}, errInvalidMessage
		}
		return realtime.RoomTopic(id), nil
	case m.WorkspaceID != "" && m.RoomID == "":
		id, err := ulid.ParseStrict(m.WorkspaceID)
		if err != nil {
			return realtime.Topic{}, errInvalidMessage
		}
		return realtime.WorkspaceTopic(id), nil
	default:
		return realtime.Topic{}, errInvalidMessage
	}
}

// ackError はエラーを ack の error の値に変換する。REST の writeError と同じく、変換はここにだけ書く。
func (h *wsHandlers) ackError(ctx context.Context, client *realtime.Client, typ string, err error) string {
	switch {
	case errors.Is(err, errInvalidMessage):
		return ackInvalidMessage
	case errors.Is(err, chat.ErrNotFound):
		return ackNotFound
	case errors.Is(err, chat.ErrForbidden):
		return ackForbidden
	case errors.Is(err, realtime.ErrNotSubscribed):
		return ackNotSubscribed
	case errors.Is(err, realtime.ErrTooManySubscriptions):
		return ackTooManySubscriptions
	default:
		h.logger.ErrorContext(ctx, "websocket message failed",
			slog.String("user_id", client.Identity().UserID.String()), slog.String("type", typ), slog.Any("error", err))
		return ackInternal
	}
}

// wsFrame は送信キューの 1 件。event と ack のどちらか一方を持つ。
type wsFrame struct {
	event *chat.Event
	ack   *ackMessage
}

// wsConn は realtime.Conn の実装。書き込みは writeLoop の goroutine だけが行う。
type wsConn struct {
	conn   *websocket.Conn
	cfg    WSConfig
	logger *slog.Logger
	send   chan wsFrame
	// ctx がキャンセルされたら、writeLoop が closeCode で close フレームを書いて終わる。
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}

	closeOnce sync.Once
	closeCode websocket.StatusCode
}

func newWSConn(parent context.Context, conn *websocket.Conn, cfg WSConfig, logger *slog.Logger) *wsConn {
	ctx, cancel := context.WithCancel(context.WithoutCancel(parent))
	return &wsConn{
		conn:   conn,
		cfg:    cfg,
		logger: logger,
		send:   make(chan wsFrame, cfg.SendQueue),
		ctx:    ctx,
		cancel: cancel,
		done:   make(chan struct{}),
	}
}

// Send はイベントを送信キューに入れる（realtime.Conn）。
func (c *wsConn) Send(ev chat.Event) bool {
	return c.enqueue(wsFrame{event: &ev})
}

func (c *wsConn) enqueue(f wsFrame) bool {
	select {
	case <-c.ctx.Done():
		return true // 閉じた後のイベントは捨てる
	default:
	}
	select {
	case c.send <- f:
		return true
	default:
		return false
	}
}

// Close は理由に対応する close コードで閉じさせる（realtime.Conn）。
func (c *wsConn) Close(reason realtime.CloseReason) {
	switch reason {
	case realtime.CloseSlowConsumer:
		c.closeWith(closeSlowConsumer)
	case realtime.CloseSessionRevoked:
		c.closeWith(closeSessionRevoked)
	case realtime.CloseResync:
		c.closeWith(websocket.StatusServiceRestart)
	default:
		c.closeWith(websocket.StatusGoingAway)
	}
}

// closeWith は最初に呼ばれたときのコードを記録して、書き込みの goroutine に閉じさせる。ブロックしない。
func (c *wsConn) closeWith(code websocket.StatusCode) {
	c.closeOnce.Do(func() {
		c.closeCode = code
		c.cancel()
	})
}

func (c *wsConn) writeLoop() {
	defer close(c.done)
	ticker := time.NewTicker(c.cfg.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.ctx.Done():
			c.writeClose()
			return
		case f := <-c.send:
			if !c.write(f) {
				return
			}
		case <-ticker.C:
			// pong を待つ間は書き込みが止まる。応答のないクライアントは、最長で PingInterval + PongTimeout で切れる（ADR 0015）。
			pingCtx, cancel := context.WithTimeout(c.ctx, c.cfg.PongTimeout)
			err := c.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				if c.ctx.Err() != nil {
					c.writeClose() // 待っている間に閉じる指示が来た
				} else {
					_ = c.conn.CloseNow()
				}
				return
			}
		}
	}
}

// write は 1 件を書く。書けなければ接続を切って false を返す。
func (c *wsConn) write(f wsFrame) bool {
	var (
		b   []byte
		err error
	)
	if f.ack != nil {
		b, err = json.Marshal(f.ack)
	} else {
		b, err = encodeEvent(*f.event)
	}
	if err != nil {
		// プログラムのバグ（未知のデータの型）。接続は切らずに、そのイベントだけ捨てる。
		c.logger.ErrorContext(c.ctx, "encode websocket frame failed", slog.Any("error", err))
		return true
	}
	// 閉じる指示（ctx のキャンセル）で書きかけのフレームを壊さないよう、キャンセルされない context に上限だけを付ける。
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(c.ctx), c.cfg.WriteTimeout)
	defer cancel()
	if err := c.conn.Write(writeCtx, websocket.MessageText, b); err != nil {
		_ = c.conn.CloseNow()
		c.cancel()
		return false
	}
	return true
}

func (c *wsConn) writeClose() {
	code := c.closeCode
	if code == 0 {
		code = websocket.StatusNormalClosure
	}
	// 相手の close フレームを待つ（最長 5 秒。ライブラリの既定）。読み取り中の Read はこれで終わる。
	_ = c.conn.Close(code, "")
}

// serverEvent はサーバーからのイベントの外側の形。
type serverEvent struct {
	Type chat.EventType `json:"type"`
	Data any            `json:"data"`
}

// encodeEvent はイベントを docs/events.md の JSON にする。メッセージは REST と同じ形（newMessageResponse）を使う。
func encodeEvent(ev chat.Event) ([]byte, error) {
	var data any
	switch d := ev.Data.(type) {
	case chat.Message:
		data = newMessageResponse(d)
	case chat.MemberJoined:
		data = struct {
			WorkspaceID string              `json:"workspace_id"`
			RoomID      string              `json:"room_id"`
			User        userProfileResponse `json:"user"`
		}{d.WorkspaceID.String(), d.RoomID.String(), newUserProfileResponse(d.User)}
	case chat.MemberLeft:
		data = struct {
			WorkspaceID string `json:"workspace_id"`
			RoomID      string `json:"room_id"`
			UserID      string `json:"user_id"`
		}{d.WorkspaceID.String(), d.RoomID.String(), d.UserID.String()}
	case chat.RoomUpdated:
		data = struct {
			WorkspaceID string `json:"workspace_id"`
			RoomID      string `json:"room_id"`
			Name        string `json:"name"`
			IsDefault   bool   `json:"is_default"`
		}{d.WorkspaceID.String(), d.RoomID.String(), d.Name, d.IsDefault}
	case chat.RoomMemberRemoved:
		data = struct {
			WorkspaceID string `json:"workspace_id"`
			RoomID      string `json:"room_id"`
			Reason      string `json:"reason"`
		}{d.WorkspaceID.String(), d.RoomID.String(), string(d.Reason)}
	case chat.RoomRead:
		data = struct {
			WorkspaceID string `json:"workspace_id"`
			RoomID      string `json:"room_id"`
			LastReadSeq int64  `json:"last_read_seq"`
			UnreadCount int64  `json:"unread_count"`
		}{d.WorkspaceID.String(), d.RoomID.String(), d.LastReadSeq, d.UnreadCount}
	case chat.WorkspaceUpdated:
		data = struct {
			WorkspaceID  string `json:"workspace_id"`
			Name         string `json:"name"`
			InvitePolicy string `json:"invite_policy"`
		}{d.WorkspaceID.String(), d.Name, string(d.InvitePolicy)}
	case chat.WorkspaceMemberRemoved:
		data = struct {
			WorkspaceID string `json:"workspace_id"`
			UserID      string `json:"user_id"`
			Reason      string `json:"reason"`
		}{d.WorkspaceID.String(), d.UserID.String(), string(d.Reason)}
	case chat.WorkspaceRoleChanged:
		data = struct {
			WorkspaceID string `json:"workspace_id"`
			UserID      string `json:"user_id"`
			Role        string `json:"role"`
		}{d.WorkspaceID.String(), d.UserID.String(), string(d.Role)}
	case chat.PresenceChanged:
		data = struct {
			UserID string `json:"user_id"`
			Online bool   `json:"online"`
		}{d.UserID.String(), d.Online}
	case chat.TypingStarted:
		data = struct {
			WorkspaceID string              `json:"workspace_id"`
			RoomID      string              `json:"room_id"`
			User        userProfileResponse `json:"user"`
		}{d.WorkspaceID.String(), d.RoomID.String(), newUserProfileResponse(d.User)}
	default:
		return nil, fmt.Errorf("unknown event data %T for %s", ev.Data, ev.Type)
	}
	return json.Marshal(serverEvent{Type: ev.Type, Data: data})
}
