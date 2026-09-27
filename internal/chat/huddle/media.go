package huddle

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/platform/sfu"
	"github.com/shun2218-dev/hibari/internal/platform/turn"
)

// Media は Cloudflare Realtime の SFU と TURN で chat.HuddleMedia を満たす（ADR 0066 決定 2・14・15）。
// Cloudflare の型とエラーは、ここで chat の型に変える（chat に Cloudflare の語彙を漏らさない）。
type Media struct {
	SFU  *sfu.Client
	TURN *turn.Client
	// RelayOnly が true なら、発行した ICE サーバーを TURN の中継だけで使わせる（開発で TURN の経路を確かめるため）。
	RelayOnly bool
}

var _ chat.HuddleMedia = Media{}

// ICEServers は TURN の認証情報を発行する。
func (m Media) ICEServers(ctx context.Context, ttl time.Duration, now time.Time) (chat.ICECredentials, error) {
	creds, err := m.TURN.Generate(ctx, ttl, now)
	if err != nil {
		return chat.ICECredentials{}, err
	}
	out := chat.ICECredentials{Username: creds.Username, ExpiresAt: creds.ExpiresAt, RelayOnly: m.RelayOnly}
	for _, s := range creds.ICEServers {
		out.Servers = append(out.Servers, chat.ICEServer{URLs: s.URLs, Username: s.Username, Credential: s.Credential})
	}
	return out, nil
}

// RevokeICE は TURN の認証情報を取り消す。
func (m Media) RevokeICE(ctx context.Context, username string) error {
	return m.TURN.Revoke(ctx, username)
}

// Publish はセッションを作り、自分の音声を送る設定をする。
func (m Media) Publish(ctx context.Context, offer chat.SessionDescription, mid, trackName string) (string, chat.SessionDescription, error) {
	sessionID, err := m.SFU.NewSession(ctx)
	if err != nil {
		return "", chat.SessionDescription{}, mapErr(err)
	}
	answer, tracks, err := m.SFU.PushTracks(ctx, sessionID,
		sfu.SessionDescription{Type: offer.Type, SDP: offer.SDP},
		[]sfu.LocalTrack{{Mid: mid, TrackName: trackName}})
	if err != nil {
		return "", chat.SessionDescription{}, mapErr(err)
	}
	for _, t := range tracks {
		if t.Err != nil {
			return "", chat.SessionDescription{}, fmt.Errorf("push track %s: %w", t.TrackName, t.Err)
		}
	}
	return sessionID, chat.SessionDescription{Type: answer.Type, SDP: answer.SDP}, nil
}

// Subscribe はほかのセッションのトラックを受ける。
func (m Media) Subscribe(ctx context.Context, sessionID string, remotes []chat.RemoteTrack) (chat.SubscribeResult, error) {
	req := make([]sfu.RemoteTrack, len(remotes))
	for i, r := range remotes {
		req[i] = sfu.RemoteTrack{SessionID: r.SessionID, TrackName: r.TrackName}
	}
	res, err := m.SFU.PullTracks(ctx, sessionID, req)
	if err != nil {
		return chat.SubscribeResult{}, mapErr(err)
	}
	out := chat.SubscribeResult{}
	if res.Offer != nil && res.RequiresImmediateRenegotiation {
		out.Offer = &chat.SessionDescription{Type: res.Offer.Type, SDP: res.Offer.SDP}
	}
	for _, t := range res.Tracks {
		out.Tracks = append(out.Tracks, chat.SubscribedTrack{SessionID: t.SessionID, Mid: t.Mid, OK: t.Err == nil})
	}
	return out, nil
}

// Renegotiate はブラウザの answer を渡す。
func (m Media) Renegotiate(ctx context.Context, sessionID string, answer chat.SessionDescription) error {
	return mapErr(m.SFU.Renegotiate(ctx, sessionID, sfu.SessionDescription{Type: answer.Type, SDP: answer.SDP}))
}

// Close はトラックを閉じる。mids が空なら、セッションの一覧を読んで全部を閉じる。
// セッションがもうなければ（接続が切れて 30 秒たった）、閉じるものもないので成功にする。
func (m Media) Close(ctx context.Context, sessionID string, mids []string) error {
	if len(mids) == 0 {
		tracks, err := m.SFU.Tracks(ctx, sessionID)
		if errors.Is(err, sfu.ErrSessionGone) {
			return nil
		}
		if err != nil {
			return err
		}
		for _, t := range tracks {
			if t.Mid != "" {
				mids = append(mids, t.Mid)
			}
		}
	}
	if err := m.SFU.CloseTracks(ctx, sessionID, mids); err != nil && !errors.Is(err, sfu.ErrSessionGone) {
		return err
	}
	return nil
}

func mapErr(err error) error {
	if errors.Is(err, sfu.ErrConflict) {
		return fmt.Errorf("%w: %w", chat.ErrHuddleNegotiationConflict, err)
	}
	return err
}
