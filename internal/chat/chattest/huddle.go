package chattest

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// Media は Cloudflare に出ない chat.HuddleMedia（ADR 0066）。作ったセッションと、閉じた・取り消したものを記録する。
//
// SDP の中身は見ない。answer と offer は、どの呼び出しから返ったかが分かる文字列にする。
type Media struct {
	mu       sync.Mutex
	sessions int
	// Closed は Close を呼ばれたセッション（全部を閉じた場合は mids が空）。
	closed []string
	// Revoked は取り消した TURN の認証情報のユーザー名。
	revoked []string
	// FailPublish が true なら Publish が失敗する（Cloudflare につながらない）。
	FailPublish bool
}

// ICEServers は決まった形の認証情報を返す。ユーザー名は呼ぶたびに変える。
func (m *Media) ICEServers(_ context.Context, ttl time.Duration, now time.Time) (chat.ICECredentials, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions++
	name := fmt.Sprintf("turn-user-%d", m.sessions)
	return chat.ICECredentials{
		Servers: []chat.ICEServer{
			{URLs: []string{"stun:stun.example.test:3478"}},
			{URLs: []string{"turn:turn.example.test:3478?transport=udp"}, Username: name, Credential: "secret"},
		},
		Username:  name,
		ExpiresAt: now.Add(ttl),
	}, nil
}

// RevokeICE は取り消したユーザー名を記録する。
func (m *Media) RevokeICE(_ context.Context, username string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.revoked = append(m.revoked, username)
	return nil
}

// Publish は新しいセッションを作ったことにする。
func (m *Media) Publish(_ context.Context, _ chat.SessionDescription, mid, _ string) (string, chat.SessionDescription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.FailPublish {
		return "", chat.SessionDescription{}, fmt.Errorf("cloudflare is unreachable")
	}
	m.sessions++
	id := fmt.Sprintf("sfu-session-%d", m.sessions)
	return id, chat.SessionDescription{Type: "answer", SDP: "v=0 answer for " + id + " mid " + mid}, nil
}

// Subscribe は、頼まれたトラックを順に mid "1", "2", ... で受けたことにする。
func (m *Media) Subscribe(_ context.Context, sessionID string, remotes []chat.RemoteTrack) (chat.SubscribeResult, error) {
	res := chat.SubscribeResult{Offer: &chat.SessionDescription{Type: "offer", SDP: "v=0 pull for " + sessionID}}
	for i, r := range remotes {
		res.Tracks = append(res.Tracks, chat.SubscribedTrack{SessionID: r.SessionID, Mid: fmt.Sprint(i + 1), OK: true})
	}
	return res, nil
}

// Renegotiate は何もしない。
func (m *Media) Renegotiate(context.Context, string, chat.SessionDescription) error { return nil }

// Close は閉じたセッションを記録する。
func (m *Media) Close(_ context.Context, sessionID string, _ []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = append(m.closed, sessionID)
	return nil
}

// Closed は Close を呼ばれたセッション。
func (m *Media) Closed() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.closed)
}

// Revoked は取り消した TURN の認証情報のユーザー名。
func (m *Media) Revoked() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.revoked)
}

// Offer はテストで使うブラウザの offer。
var Offer = chat.SessionDescription{Type: "offer", SDP: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}

// Answer はテストで使うブラウザの answer。
var Answer = chat.SessionDescription{Type: "answer", SDP: "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n"}
