package authn

import (
	"context"
	"encoding/base64"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"
)

// WSTicketTTL は ws-ticket の寿命（ADR 0007）。発行してすぐに接続する前提なので短くする。
const WSTicketTTL = 30 * time.Second

// wsTicketBytes は ws-ticket の乱数のバイト数。base64url で 43 文字になる。
const wsTicketBytes = 32

// ErrInvalidWSTicket は ws-ticket が形式違い・存在しない・期限切れ・使用済みのどれかであることを表す。
// 理由はクライアントに区別して返さない。
var ErrInvalidWSTicket = errors.New("authn: invalid ws ticket")

// WSTickets は ws-ticket の発行と消費（ADR 0007）。
//
// ws-ticket は「URL に載せられる、使い捨ての、短命なトークン」。ブラウザの WebSocket はヘッダを付けられないので、
// Access Token の代わりにこれをクエリ文字列で渡す。chat（WS のハンドラ）はキーの形を知らず、ここから Identity を受け取るだけ。
type WSTickets struct {
	rdb    *goredis.Client
	random io.Reader
}

// NewWSTickets は WSTickets を返す。
func NewWSTickets(rdb *goredis.Client, random io.Reader) *WSTickets {
	return &WSTickets{rdb: rdb, random: random}
}

func wsTicketKey(ticket string) string {
	return "authn:wsticket:" + ticket
}

// wsTicketValue は Redis に保存する値。
type wsTicketValue struct {
	UserID        ulid.ULID `json:"user_id"`
	SessionID     ulid.ULID `json:"sid"`
	EmailVerified bool      `json:"email_verified,omitzero"`
}

// Issue は id の ws-ticket を発行する。
func (t *WSTickets) Issue(ctx context.Context, id Identity) (string, error) {
	b := make([]byte, wsTicketBytes)
	if _, err := io.ReadFull(t.random, b); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	ticket := base64.RawURLEncoding.EncodeToString(b)
	value, err := json.Marshal(wsTicketValue(id))
	if err != nil {
		return "", fmt.Errorf("marshal ws ticket: %w", err)
	}
	if err := t.rdb.Set(ctx, wsTicketKey(ticket), value, WSTicketTTL).Err(); err != nil {
		return "", fmt.Errorf("save ws ticket: %w", err)
	}
	return ticket, nil
}

// Consume は ticket を消費して Identity を返す。GETDEL の 1 コマンドで読むと同時に消すので、
// 同じ ticket で同時に接続しても成功するのは 1 本だけ。
//
// セッションが失効していないかは確かめない。呼び出し側が SessionChecker で確かめる。
func (t *WSTickets) Consume(ctx context.Context, ticket string) (Identity, error) {
	// 形式の違う値で Redis に問い合わせない。任意の長さの文字列をキーに使わせないため。
	if b, err := base64.RawURLEncoding.DecodeString(ticket); err != nil || len(b) != wsTicketBytes {
		return Identity{}, ErrInvalidWSTicket
	}
	raw, err := t.rdb.GetDel(ctx, wsTicketKey(ticket)).Bytes()
	if errors.Is(err, goredis.Nil) {
		return Identity{}, ErrInvalidWSTicket
	}
	if err != nil {
		return Identity{}, fmt.Errorf("consume ws ticket: %w", err)
	}
	var v wsTicketValue
	if err := json.Unmarshal(raw, &v); err != nil {
		return Identity{}, fmt.Errorf("%w: %w", ErrInvalidWSTicket, err)
	}
	return Identity(v), nil
}

// SessionChecker はセッション（sid）がまだ有効かを答える。
//
// Access JWT の検証はローカルで完結させて DB を読まない（ADR 0007）が、長くつながる WebSocket では、
// 接続時（ws-ticket の消費時）と接続中の定期的な再検証でセッションの失効を確かめる（ADR 0015）。
// 実装は auth（refresh_tokens を持つ側）で、main で配線する。authn も chat も auth を import しない（ADR 0001）。
type SessionChecker interface {
	SessionActive(ctx context.Context, userID, sessionID ulid.ULID) (bool, error)
}
