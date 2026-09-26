package chat

import (
	"context"
	"errors"
	"time"

	"github.com/oklog/ulid/v2"
)

// ハドルに「いま入っている人」の置き場所（ADR 0066 決定 3・5・6）。
//
// 自動で変わる状態なので Redis に置く（CLAUDE.md ルール 5）。chat は Redis を知らず、この interface だけを使う
// （presence の PresenceReader と同じ。実装は internal/chat/huddle）。

// ErrHuddleFull は、ハドルが上限の人数に達していることを表す（決定 7）。
var ErrHuddleFull = errors.New("chat: huddle is full")

// HuddleParticipant は「この端末のこの参加」（決定 4）。同じ人が別の端末から入り直すと、別の参加になる。
type HuddleParticipant struct {
	ID       ulid.ULID
	HuddleID ulid.ULID
	UserID   ulid.ULID
	// AuthSessionID は入ったときのログインのセッション（sid）。失効したら、その参加を外す（決定 8）。
	AuthSessionID ulid.ULID
	// SFUSessionID は Cloudflare のセッション。クライアントには見せない（決定 2）。
	SFUSessionID string
	// TrackName は送っている音声のトラックの名前。ほかの人が受けるときに使う（決定 9）。
	TrackName string
	Muted     bool
	JoinedAt  time.Time
}

// HuddleSnapshot は、あるハドルのいまの状態。
type HuddleSnapshot struct {
	HuddleID ulid.ULID
	// Version は状態の版。変わるたびに増える（huddle.updated の順序を決める。決定 13）。
	Version int64
	// Participants はいま入っている人（入った順）。
	Participants []HuddleParticipant
	// JoiningSoon は「もうすぐ参加する」を押して、まだ入っていない人（決定 11）。
	JoiningSoon []ulid.ULID
}

// RemovedParticipant は外した参加と、外した後のハドルの版と残りの人数。
type RemovedParticipant struct {
	Participant HuddleParticipant
	Version     int64
	Remaining   int
}

// HuddleJoinResult は HuddleStates.Join の結果。
type HuddleJoinResult struct {
	Version int64
	// Evicted は、同じ人の前の参加（別のハドル、または同じハドルの別の端末。決定 6）。なければ nil。
	Evicted *RemovedParticipant
}

// HuddleStates は、ハドルにいま入っている人の読み書き。時刻はすべて呼び出し側が Clock から渡す。
type HuddleStates interface {
	// Join は参加を書く。同じ人の前の参加は外して返す。上限に達していれば ErrHuddleFull。
	Join(ctx context.Context, p HuddleParticipant, deadline time.Time, limit int) (HuddleJoinResult, error)
	// Heartbeat は心拍の期限を延ばす。参加がもうなければ false。
	Heartbeat(ctx context.Context, userID, huddleID, participantID ulid.ULID, deadline time.Time) (bool, error)
	// Remove は参加を外す。もう外れていれば nil。
	Remove(ctx context.Context, huddleID, participantID ulid.ULID) (*RemovedParticipant, error)
	// Sweep は心拍の期限が now を過ぎた参加を最大 max 件外す。
	Sweep(ctx context.Context, now time.Time, max int) ([]RemovedParticipant, error)
	// SetMuted はミュートを書き換えて新しい版を返す。参加がなければ ok は false。
	SetMuted(ctx context.Context, huddleID, participantID ulid.ULID, muted bool) (version int64, ok bool, err error)
	// JoiningSoon は「もうすぐ参加する」を until まで残し、新しい版を返す。
	JoiningSoon(ctx context.Context, huddleID, userID ulid.ULID, until, now time.Time) (int64, error)
	// Clear はハドルの全員を外し、ハドルの状態を消す。外した参加を返す。
	Clear(ctx context.Context, huddleID ulid.ULID) ([]HuddleParticipant, error)
	// Participant は参加を 1 つ読む。なければ nil。
	Participant(ctx context.Context, huddleID, participantID ulid.ULID) (*HuddleParticipant, error)
	// Current は、その人がいま入っている参加を返す。入っていなければ ok は false。
	Current(ctx context.Context, userID ulid.ULID) (huddleID, participantID ulid.ULID, ok bool, err error)
	// Snapshots は複数のハドルのいまの状態を読む。
	Snapshots(ctx context.Context, huddleIDs []ulid.ULID, now time.Time) (map[ulid.ULID]HuddleSnapshot, error)
	// RecordICEUsername は、その人に発行した TURN の認証情報を expiresAt まで覚える（決定 8・14）。
	// 取り消すために、発行したものをサーバーの側で覚える（クライアントから受け取った名前を信じると、他人の分を取り消させられる）。
	RecordICEUsername(ctx context.Context, userID ulid.ULID, username string, expiresAt, now time.Time) error
	// TakeICEUsernames は、その人に発行してまだ期限の切れていない TURN の認証情報を返して忘れる。
	TakeICEUsernames(ctx context.Context, userID ulid.ULID, now time.Time) ([]string, error)
}

// ---- Cloudflare（SFU と TURN）----

// SessionDescription は SDP（RTCSessionDescription と同じ形）。
type SessionDescription struct {
	Type string
	SDP  string
}

// ICEServer は RTCIceServer と同じ形。ブラウザにそのまま渡す。
type ICEServer struct {
	URLs       []string
	Username   string
	Credential string
}

// ICECredentials は発行した ICE サーバーの一覧。Username は取り消すときに使う。
type ICECredentials struct {
	Servers   []ICEServer
	Username  string
	ExpiresAt time.Time
}

// RemoteTrack は受けに行く相手のトラック。
type RemoteTrack struct {
	SessionID string
	TrackName string
}

// SubscribedTrack は受けた結果。OK が false なら、そのトラックだけ受けられなかった（相手が抜けた直後など）。
type SubscribedTrack struct {
	SessionID string
	Mid       string
	OK        bool
}

// SubscribeResult は Subscribe の結果。Offer はブラウザの answer を Renegotiate で返す。受けるものが増えなければ nil。
type SubscribeResult struct {
	Offer  *SessionDescription
	Tracks []SubscribedTrack
}

// ErrHuddleNegotiationConflict は、同じ Cloudflare のセッションへの変更が重なったことを表す（決定 4）。クライアントはやり直す。
var ErrHuddleNegotiationConflict = errors.New("chat: huddle negotiation conflict")

// HuddleMedia は音声の中継（Cloudflare Realtime の SFU と TURN。決定 2・14・15）。
// chat は Cloudflare の JSON・URL・エラーの形を知らない（実装は internal/chat/huddle の Media）。
type HuddleMedia interface {
	// ICEServers は有効期間 ttl の TURN の認証情報を発行する。
	ICEServers(ctx context.Context, ttl time.Duration, now time.Time) (ICECredentials, error)
	// RevokeICE は発行した認証情報を取り消す。
	RevokeICE(ctx context.Context, username string) error
	// Publish はセッションを作り、ブラウザの offer で mid の音声を trackName として送る設定をし、answer を返す。
	Publish(ctx context.Context, offer SessionDescription, mid, trackName string) (sessionID string, answer SessionDescription, err error)
	// Subscribe は sessionID のセッションで、ほかのセッションのトラックを受ける。
	Subscribe(ctx context.Context, sessionID string, remotes []RemoteTrack) (SubscribeResult, error)
	// Renegotiate は Subscribe の offer に対するブラウザの answer を渡す。
	Renegotiate(ctx context.Context, sessionID string, answer SessionDescription) error
	// Close はセッションのトラックを閉じる。mids が空なら、そのセッションのすべてのトラックを閉じる。
	Close(ctx context.Context, sessionID string, mids []string) error
}
