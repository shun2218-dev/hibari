package httpx

import (
	"context"
	"encoding/json/v2"
	"errors"
	"log/slog"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
)

// クライアントから来るメッセージと、返す ack（docs/events.md「クライアントからのメッセージ」）。
// 購読の宛先の解決は Hub（internal/chat/realtime）が行い、ここは形の検証と ack への変換だけを持つ。

// clientMessage はクライアントからのメッセージ（docs/events.md「クライアント → サーバー」）。
type clientMessage struct {
	Type clientMessageType `json:"type"`
	ID   *string           `json:"id,omitzero"`
	// RoomID と WorkspaceID は、subscribe / unsubscribe ではどちらか 1 つ、typing では room_id だけを使う。
	RoomID      string `json:"room_id,omitempty"`
	WorkspaceID string `json:"workspace_id,omitempty"`
	// ThreadRootID は typing でだけ使う。スレッドで入力しているときの親（ADR 0036）。
	ThreadRootID string `json:"thread_root_id,omitempty"`
	// Active は activity でだけ使う。この接続が画面を見ているか（ADR 0049 決定 3）。
	Active bool `json:"active,omitempty"`
}

// clientMessageType はクライアントからのメッセージの type。
type clientMessageType string

const (
	clientSubscribe   clientMessageType = "subscribe"
	clientUnsubscribe clientMessageType = "unsubscribe"
	clientTyping      clientMessageType = "typing"
	clientActivity    clientMessageType = "activity"
	clientPing        clientMessageType = "ping"
)

// ackType は ack の type。サーバーからのフレームは、イベントか ack のどちらか。
const ackType = "ack"

type ackMessage struct {
	Type  string   `json:"type"`
	ID    *string  `json:"id,omitzero"`
	Error ackError `json:"error,omitempty"`
}

// ackError は ack の error の値（docs/events.md）。
type ackError string

const (
	ackInvalidMessage       ackError = "invalid_message"
	ackNotFound             ackError = "not_found"
	ackNotSubscribed        ackError = "not_subscribed"
	ackForbidden            ackError = "forbidden"
	ackTooManySubscriptions ackError = "too_many_subscriptions"
	ackInternal             ackError = "internal"
)

// handleMessage は 1 件のメッセージを処理し、返す ack を返す。id がなく成功したら nil（返さない）。
func (h *wsHandlers) handleMessage(ctx context.Context, client *realtime.Client, data []byte) *ackMessage {
	var m clientMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return &ackMessage{Type: ackType, Error: ackInvalidMessage}
	}
	if m.ID != nil && len(*m.ID) > wsMaxMessageID {
		return &ackMessage{Type: ackType, Error: ackInvalidMessage}
	}
	reply := func(err error) *ackMessage {
		if err == nil && m.ID == nil {
			return nil
		}
		ack := &ackMessage{Type: ackType, ID: m.ID}
		if err != nil {
			ack.Error = h.ackError(ctx, client, m.Type, err)
		}
		return ack
	}

	switch m.Type {
	case clientSubscribe, clientUnsubscribe:
		t, err := parseTopic(m)
		if err != nil {
			return reply(err)
		}
		if m.Type == clientUnsubscribe {
			h.hub.Unsubscribe(client, t)
			return reply(nil)
		}
		return reply(h.hub.Subscribe(ctx, client, t))
	case clientTyping:
		roomID, err := ulid.ParseStrict(m.RoomID)
		if err != nil || m.WorkspaceID != "" {
			return reply(errInvalidMessage)
		}
		var threadRootID *ulid.ULID
		if m.ThreadRootID != "" {
			id, err := ulid.ParseStrict(m.ThreadRootID)
			if err != nil {
				return reply(errInvalidMessage)
			}
			threadRootID = &id
		}
		return reply(h.hub.Typing(ctx, client, roomID, threadRootID))
	case clientActivity:
		// 接続そのものの属性なので、購読しているルームは関係ない（ADR 0049 決定 3）。
		// 接続は「見ていない」から始まり、クライアントがつないだ直後に今の値を送る。
		if m.RoomID != "" || m.WorkspaceID != "" {
			return reply(errInvalidMessage)
		}
		h.hub.SetActivity(ctx, client, m.Active)
		return reply(nil)
	case clientPing:
		// ブラウザは WebSocket の ping フレームを送れないので、アプリケーションの ping には id がなくても ack を返す。
		return &ackMessage{Type: ackType, ID: m.ID}
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
func (h *wsHandlers) ackError(ctx context.Context, client *realtime.Client, typ clientMessageType, err error) ackError {
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
			slog.String("user_id", client.Identity().UserID.String()), slog.String("type", string(typ)), slog.Any("error", err))
		return ackInternal
	}
}
