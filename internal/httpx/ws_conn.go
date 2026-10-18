package httpx

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
)

// 1 本の接続への書き込み（ADR 0015）。同じ接続に複数の goroutine から書き込まないため、
// 送信は待ち行列に積み、書き込みの goroutine だけが実際に書く（CLAUDE.md「やってはいけないこと」）。

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
		b, err = marshalJSON(f.ack)
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
