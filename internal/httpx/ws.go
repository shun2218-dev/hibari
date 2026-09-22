package httpx

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// RealtimeHub は httpx が使う Hub の操作（realtime.Hub が実装する）。
type RealtimeHub interface {
	Register(ctx context.Context, id authn.Identity, conn realtime.Conn) (*realtime.Client, error)
	Unregister(ctx context.Context, c *realtime.Client)
	Subscribe(ctx context.Context, c *realtime.Client, t realtime.Topic) error
	Unsubscribe(c *realtime.Client, t realtime.Topic)
	Typing(ctx context.Context, c *realtime.Client, roomID ulid.ULID, threadRootID *ulid.ULID) error
	// SetActivity はこの接続が画面を見ているかを記録する（ADR 0049 決定 3）。
	SetActivity(ctx context.Context, c *realtime.Client, active bool)
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
	// ws-ticket を発行しなければ接続できないので、email の検証はここで止めれば WebSocket にも及ぶ（ADR 0053 決定 1）。
	mux.Handle("POST /api/v1/ws/ticket", requireChatUser(d)(http.HandlerFunc(h.issueTicket)))
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
	writeProblem(w, r, problem{Type: problemWSTicketInvalid, Title: "The WebSocket ticket is invalid or has expired", Status: http.StatusUnauthorized})
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
