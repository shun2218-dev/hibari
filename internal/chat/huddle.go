package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
)

// 音声のハドル（ADR 0066）。
//
// 音声は Cloudflare の SFU を通り、Go は通らない（決定 1・2）。Go が持つのは、SDP の中継と「誰が入っているか」だけ。
// 履歴（始めた・終わった・一度でも入った人）は Postgres、いま入っている人は Redis（決定 3。CLAUDE.md ルール 5）。
//
// 「入る」と「最後の人が抜けて終わる」はどちらも Postgres のハドルの行をロックしてから Redis を見るので、
// 終わったハドルに入ってしまうことがない（決定 4）。Cloudflare を待つ間はトランザクションを持たない（ADR 0065 決定 10 と同じ）。

const (
	// HuddleParticipantLimit はハドルに入れる人数の上限（決定 7。オーナーの判断）。
	HuddleParticipantLimit = 20
	// HuddleHeartbeatTTL は心拍の期限（決定 5）。クライアントは 10 秒ごとに心拍を送る。
	HuddleHeartbeatTTL = 30 * time.Second
	// HuddleSweepInterval は、心拍の途絶えた参加を掃除する間隔（決定 5）。
	HuddleSweepInterval = 5 * time.Second
	// HuddleJoiningSoonTTL は「もうすぐ参加する」を出しておく長さ（決定 11。オーナーの確認）。
	HuddleJoiningSoonTTL = 5 * time.Minute
	// HuddleICETTL は TURN の認証情報の有効期間（決定 14）。長いハドルでは、クライアントが切れる前に取り直す。
	HuddleICETTL = 12 * time.Hour

	// huddleTrackName は送る音声のトラックの名前。セッションは参加ごとに分かれるので、名前は同じでよい。
	huddleTrackName = "audio"
	// huddleSweepBatch は 1 回の掃除で外す参加の上限。多ければ続けて掃除する。
	huddleSweepBatch = 100
	// maxSDPBytes は受け付ける SDP の大きさの上限。音声 1 本の SDP は数 KB に収まる。
	maxSDPBytes = 64 << 10
)

// huddleICERule は ICE サーバーを取れる回数の上限（1 人あたり）。入り直しとタブの開き直しに足りればよい。
var huddleICERule = ratelimit.Rule{Name: "huddle-ice", Limit: 30, Window: time.Minute}

var (
	// ErrHuddlesUnavailable は、Cloudflare の設定がなくてハドルが無効になっていることを表す（決定 15）。
	ErrHuddlesUnavailable = errors.New("chat: huddles are unavailable")
	// ErrHuddleParticipantGone は、参加がもうない（抜けた・外された・別の端末に移った）ことを表す（決定 4・6）。
	// 別の人の参加 ID を指定されたときも同じにする（参加 ID の有無を明かさない）。
	ErrHuddleParticipantGone = errors.New("chat: huddle participant is gone")
)

// HuddleDeps はハドルの依存。Media が nil ならハドルは無効（決定 15）。
type HuddleDeps struct {
	States  HuddleStates
	Media   HuddleMedia
	Limiter RateLimiter
}

type huddles struct {
	states  HuddleStates
	media   HuddleMedia
	limiter RateLimiter
}

func (h huddles) enabled() bool { return h.media != nil && h.states != nil }

// RoomHuddle は、ルームの進行中のハドル（決定 13）。ルームの応答と huddle.updated に載せる。
type RoomHuddle struct {
	ID        ulid.ULID
	RoomID    ulid.ULID
	MessageID ulid.ULID
	StartedAt time.Time
	// Version は状態の版。クライアントは手元より古い版を捨てる。
	Version      int64
	Participants []RoomHuddleParticipant
	// JoiningSoon は「もうすぐ参加する」を押した人（決定 11）。
	JoiningSoon []ulid.ULID
}

// RoomHuddleParticipant は、いまハドルに入っている人。同じ人は 1 人 1 回しか並ばない（決定 6）。
type RoomHuddleParticipant struct {
	UserID ulid.ULID
	Muted  bool
}

// MessageHuddle は、ハドルのメッセージに載せるハドル（決定 12）。見る人によらない値だけを持つ。
type MessageHuddle struct {
	ID        ulid.ULID
	StartedAt time.Time
	// EndedAt は終わった時刻。進行中なら nil。
	EndedAt *time.Time
	// ParticipantIDs は一度でも入った人（最初に入った順）。
	ParticipantIDs []ulid.ULID
}

// HuddleLeftReason は参加が外れた理由（huddle.left）。
type HuddleLeftReason string

const (
	// HuddleLeft は自分で抜けた（別の端末で抜けた場合も届く）。
	HuddleLeft HuddleLeftReason = "left"
	// HuddleMoved は同じ人が別の端末から入った（決定 6）。
	HuddleMoved HuddleLeftReason = "moved"
	// HuddleRemoved は権限が変わって外された、またはハドルが終わらされた（アーカイブ・削除。決定 7・8）。
	HuddleRemoved HuddleLeftReason = "removed"
	// HuddleExpired は心拍が途絶えて外れた（決定 5）。
	HuddleExpired HuddleLeftReason = "expired"
)

// ---- ICE サーバー（決定 4・14）----

// HuddleICEServers は、ルームのハドルに入るための ICE サーバー（STUN と TURN）を発行する。
// ブラウザは RTCPeerConnection を作る時点で TURN の情報が要るので、入る前に取る。
// 入れない人（決定 7）には TURN の認証情報を出さない。
func (s *Service) HuddleICEServers(ctx context.Context, actor, roomID ulid.ULID) (ICECredentials, error) {
	if !s.huddles.enabled() {
		return ICECredentials{}, ErrHuddlesUnavailable
	}
	if err := s.checkJoinHuddle(ctx, actor, roomID); err != nil {
		return ICECredentials{}, err
	}
	if s.huddles.limiter != nil {
		d, err := s.huddles.limiter.Allow(ctx, huddleICERule, actor.String())
		if err != nil {
			return ICECredentials{}, fmt.Errorf("rate limit huddle ice: %w", err)
		}
		if !d.Allowed {
			return ICECredentials{}, &RateLimitedError{RetryAfter: d.RetryAfter}
		}
	}
	now := s.clock.Now()
	creds, err := s.huddles.media.ICEServers(ctx, HuddleICETTL, now)
	if err != nil {
		return ICECredentials{}, fmt.Errorf("issue ice servers: %w", err)
	}
	// 外されたときに取り消せるよう、発行したものをサーバーの側で覚える（決定 8）
	if creds.Username != "" {
		if err := s.huddles.states.RecordICEUsername(ctx, actor, creds.Username, creds.ExpiresAt, now); err != nil {
			return ICECredentials{}, err
		}
	}
	return creds, nil
}

// checkJoinHuddle は、actor がそのルームのハドルに入れるかを確かめる（決定 7）。
func (s *Service) checkJoinHuddle(ctx context.Context, actor, roomID ulid.ULID) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
		if err != nil {
			return err
		}
		return a.authorize(func(r authz.Room) bool { return authz.CanJoinHuddle(r, a.actor(actor)) })
	})
}

// ---- 入る（決定 4）----

// JoinHuddleInput は入るときの入力。Offer はブラウザの offer、Mid はその中の音声の transceiver の mid。
type JoinHuddleInput struct {
	Offer SessionDescription
	Mid   string
}

// JoinedHuddle は入った結果。
type JoinedHuddle struct {
	Huddle        RoomHuddle
	ParticipantID ulid.ULID
	// Answer は Cloudflare の answer。ブラウザはこれを setRemoteDescription する。
	Answer SessionDescription
}

// errHuddleStartRace は、同時に始めたもう 1 人が先にハドルを作ったことを表す（トランザクションをやり直す）。
var errHuddleStartRace = errors.New("chat: another huddle was started concurrently")

// JoinHuddle はルームのハドルに入る。進行中のハドルがなければ始める。
// authSessionID は入った人のログインのセッション（sid）。失効したら、この参加を外す（決定 8）。
func (s *Service) JoinHuddle(ctx context.Context, actor, authSessionID, roomID ulid.ULID, in JoinHuddleInput) (JoinedHuddle, error) {
	if !s.huddles.enabled() {
		return JoinedHuddle{}, ErrHuddlesUnavailable
	}
	if err := validateOffer(in.Offer, in.Mid); err != nil {
		return JoinedHuddle{}, err
	}
	// Cloudflare を呼ぶ前に確かめる（入れない人のためにセッションを作らない）
	if err := s.checkJoinHuddle(ctx, actor, roomID); err != nil {
		return JoinedHuddle{}, err
	}
	sessionID, answer, err := s.huddles.media.Publish(ctx, in.Offer, in.Mid, huddleTrackName)
	if err != nil {
		return JoinedHuddle{}, fmt.Errorf("publish huddle audio: %w", err)
	}

	now := s.clock.Now()
	p := HuddleParticipant{
		ID: s.ids.New(), UserID: actor, AuthSessionID: authSessionID,
		SFUSessionID: sessionID, TrackName: huddleTrackName, JoinedAt: now,
	}
	var (
		h           store.Huddle
		kind        RoomKind
		dmPeers     []ulid.ULID
		created     bool
		messageSeen bool // ハドルのメッセージが増えた・変わった（created か、初めて入った人がいる）
		msg         Message
		joined      *HuddleJoinResult
	)
	for range 2 {
		created, messageSeen, joined = false, false, nil
		err = s.inTx(ctx, func(tx pgx.Tx) error {
			q := store.New(tx)
			a, err := loadRoomAccess(ctx, q, memberRowLock, roomID, actor)
			if err != nil {
				return err
			}
			if err := a.authorize(func(r authz.Room) bool { return authz.CanJoinHuddle(r, a.actor(actor)) }); err != nil {
				return err
			}
			kind = a.kind()

			h, err = q.LockActiveHuddle(ctx, roomID)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				if h, err = s.startHuddle(ctx, q, roomID, kind, actor, now); err != nil {
					return err
				}
				created, messageSeen = true, true
				if kind == authz.RoomDM {
					members, err := q.ListRoomMemberIDs(ctx, roomID)
					if err != nil {
						return fmt.Errorf("list dm members: %w", err)
					}
					dmPeers = slices.DeleteFunc(members, func(u ulid.ULID) bool { return u == actor })
				}
			case err != nil:
				return fmt.Errorf("lock active huddle: %w", err)
			}

			p.HuddleID = h.ID
			res, err := s.huddles.states.Join(ctx, p, now.Add(HuddleHeartbeatTTL), HuddleParticipantLimit)
			if err != nil {
				return err
			}
			joined = &res

			rows, err := q.AddHuddleParticipant(ctx, store.AddHuddleParticipantParams{HuddleID: h.ID, UserID: actor, Now: now})
			if err != nil {
				return fmt.Errorf("add huddle participant: %w", err)
			}
			switch {
			case created:
				// 始めた人を参加した人に書いてから読む
				msg, err = getMessage(ctx, q, roomID, actor, h.MessageID)
				return err
			case rows == 1:
				// 初めて入った人がいれば、会話のメッセージの「参加した人」が増える（決定 12）
				if msg, err = s.touchHuddleMessage(ctx, q, h); err != nil {
					return err
				}
				messageSeen = true
			}
			return nil
		})
		if !errors.Is(err, errHuddleStartRace) {
			break
		}
	}
	if joined != nil && joined.Evicted != nil {
		// 同じ人の前の参加は、この後で失敗しても、もう外れている
		defer s.afterHuddleRemoval(ctx, []RemovedParticipant{*joined.Evicted}, evictedReason(joined.Evicted.Participant.HuddleID, p.HuddleID))
	}
	if err != nil {
		if joined != nil {
			// Redis に書いた後でトランザクションが失敗した。書いた参加を戻す
			if _, rerr := s.huddles.states.Remove(ctx, p.HuddleID, p.ID); rerr != nil {
				s.logger.WarnContext(ctx, "undo huddle join failed", slog.String("huddle_id", p.HuddleID.String()), slog.Any("error", rerr))
			}
		}
		s.closeHuddleMedia(ctx, p)
		return JoinedHuddle{}, err
	}

	var events []Event
	switch {
	case created:
		events = append(events, messageEvent(EventMessageCreated, msg))
	case messageSeen:
		events = append(events, messageEvent(EventMessageUpdated, msg))
	}
	view, err := s.huddleView(ctx, h)
	if err != nil {
		return JoinedHuddle{}, err
	}
	events = append(events, huddleUpdatedEvent(roomID, &view))
	// DM でハドルが始まったら、相手を呼び出す（決定 11）。ミュートした DM で鳴らさないのはクライアントが決める
	for _, peer := range dmPeers {
		events = append(events, Event{
			Type: EventHuddleRinging,
			To:   Audience{Users: []ulid.ULID{peer}},
			Data: HuddleRinging{RoomID: roomID, HuddleID: h.ID, CallerID: actor},
		})
	}
	s.deliver(ctx, events...)
	return JoinedHuddle{Huddle: view, ParticipantID: p.ID, Answer: answer}, nil
}

// evictedReason は、同じ人の前の参加が外れた理由。同じハドルなら別の端末に移った、別のハドルなら抜けた。
func evictedReason(evictedHuddle, joinedHuddle ulid.ULID) HuddleLeftReason {
	if evictedHuddle == joinedHuddle {
		return HuddleMoved
	}
	return HuddleLeft
}

// startHuddle はハドルを始める。会話のメッセージを書き、ハドルの行を作る。
// 同時にもう 1 人が始めていたら errHuddleStartRace を返す（呼び出し側がやり直し、先のハドルに入る）。
func (s *Service) startHuddle(ctx context.Context, q *store.Queries, roomID ulid.ULID, kind RoomKind, starter ulid.ULID, now time.Time) (store.Huddle, error) {
	huddleID := s.ids.New()
	messageID, err := s.writeHuddleMessage(ctx, q, roomID, kind, starter, huddleID, now)
	if err != nil {
		return store.Huddle{}, err
	}
	err = q.CreateHuddle(ctx, store.CreateHuddleParams{ID: huddleID, RoomID: roomID, StartedBy: starter, MessageID: messageID, Now: now})
	if isUniqueViolation(err, "huddles_room_id_active_idx") {
		return store.Huddle{}, errHuddleStartRace
	}
	if err != nil {
		return store.Huddle{}, fmt.Errorf("create huddle: %w", err)
	}
	return store.Huddle{ID: huddleID, RoomID: roomID, StartedBy: starter, MessageID: messageID, StartedAt: now}, nil
}

// writeHuddleMessage は、会話に残すハドルのメッセージを書く（決定 12）。
//
// DM にも書く（ADR 0033 の例外）。**DM では未読に数える**（オーナーの確認）。送信と同じく user_seq を進め、
// 始めた人の既読位置も進めるので、相手にだけ未読が 1 つ付く。不在着信に気づけるようにするため。
// チャンネルでは数えない（ハドルが始まるたびに全員のチャンネルが未読になるのを避ける）。
func (s *Service) writeHuddleMessage(ctx context.Context, q *store.Queries, roomID ulid.ULID, kind RoomKind, starter, huddleID ulid.ULID, now time.Time) (ulid.ULID, error) {
	var seq, changeSeq, userSeq int64
	if kind == authz.RoomDM {
		allocated, err := q.AllocateMessageSeq(ctx, store.AllocateMessageSeqParams{RoomID: roomID, Now: now})
		if err != nil {
			return ulid.ULID{}, archivedIfNoRows(err, "allocate huddle message seq")
		}
		seq, changeSeq, userSeq = allocated.LastMessageSeq, allocated.LastChangeSeq, allocated.LastUserSeq
	} else {
		allocated, err := q.AllocateSystemMessageSeq(ctx, store.AllocateSystemMessageSeqParams{RoomID: roomID, Now: now})
		if err != nil {
			return ulid.ULID{}, fmt.Errorf("allocate huddle message seq: %w", err)
		}
		seq, changeSeq, userSeq = allocated.LastMessageSeq, allocated.LastChangeSeq, allocated.LastUserSeq
	}
	data, err := marshalSystemEvent(SystemEvent{Type: SystemHuddle, HuddleID: &huddleID})
	if err != nil {
		return ulid.ULID{}, err
	}
	id := s.ids.New()
	systemType := string(SystemHuddle)
	err = q.CreateSystemMessage(ctx, store.CreateSystemMessageParams{
		ID: id, RoomID: roomID, Seq: seq, ChangeSeq: changeSeq, UserSeq: userSeq, SenderID: starter,
		ClientMsgID: s.ids.New(), SystemType: &systemType, SystemData: data, Now: now,
	})
	if err != nil {
		return ulid.ULID{}, fmt.Errorf("create huddle message: %w", err)
	}
	if kind == authz.RoomDM {
		if _, err := q.AdvanceLastReadSeq(ctx, store.AdvanceLastReadSeqParams{RoomID: roomID, UserID: starter, Seq: seq}); err != nil {
			return ulid.ULID{}, fmt.Errorf("advance starter's last_read_seq: %w", err)
		}
	}
	return id, nil
}

// touchHuddleMessage は、ハドルのメッセージの change_seq を進めて読み直す（参加した人が増えた・終わった。決定 12）。
// 差分の同期（after_change_seq）でも、参加した人と終わった時刻がそろう（ルール 4）。
func (s *Service) touchHuddleMessage(ctx context.Context, q *store.Queries, h store.Huddle) (Message, error) {
	changeSeq, err := q.AllocateHuddleChangeSeq(ctx, h.RoomID)
	if err != nil {
		return Message{}, fmt.Errorf("allocate huddle change_seq: %w", err)
	}
	if err := q.UpdateMessageChangeSeq(ctx, store.UpdateMessageChangeSeqParams{ID: h.MessageID, ChangeSeq: changeSeq}); err != nil {
		return Message{}, fmt.Errorf("update huddle message change_seq: %w", err)
	}
	return getMessage(ctx, q, h.RoomID, h.StartedBy, h.MessageID)
}

func validateOffer(offer SessionDescription, mid string) error {
	var fields []FieldError
	if offer.Type != "offer" {
		fields = append(fields, FieldError{Field: "offer.type", Reason: ReasonInvalidValue})
	}
	if offer.SDP == "" || len(offer.SDP) > maxSDPBytes || !strings.HasPrefix(offer.SDP, "v=0") {
		fields = append(fields, FieldError{Field: "offer.sdp", Reason: ReasonInvalidValue})
	}
	if mid == "" || len(mid) > 32 {
		fields = append(fields, FieldError{Field: "mid", Reason: ReasonInvalidValue})
	}
	if len(fields) > 0 {
		return &ValidationError{Fields: fields}
	}
	return nil
}

func validateAnswer(answer SessionDescription) error {
	if answer.Type != "answer" || answer.SDP == "" || len(answer.SDP) > maxSDPBytes || !strings.HasPrefix(answer.SDP, "v=0") {
		return &ValidationError{Fields: []FieldError{{Field: "answer", Reason: ReasonInvalidValue}}}
	}
	return nil
}

// ---- 入った後の操作（決定 9・10・11）----

// ownParticipant は、actor の参加を読む。もうない・別の人の参加なら ErrHuddleParticipantGone。
func (s *Service) ownParticipant(ctx context.Context, actor, huddleID, participantID ulid.ULID) (HuddleParticipant, error) {
	if !s.huddles.enabled() {
		return HuddleParticipant{}, ErrHuddlesUnavailable
	}
	p, err := s.huddles.states.Participant(ctx, huddleID, participantID)
	if err != nil {
		return HuddleParticipant{}, err
	}
	if p == nil || p.UserID != actor {
		return HuddleParticipant{}, ErrHuddleParticipantGone
	}
	return *p, nil
}

// HuddleSubscription は、受け始めた相手のトラック（決定 9）。
type HuddleSubscription struct {
	UserID ulid.ULID
	Mid    string
}

// SubscribedHuddle は SubscribeHuddle の結果。Offer はブラウザの answer を RenegotiateHuddle で返す。受けるものがなければ nil。
type SubscribedHuddle struct {
	Offer  *SessionDescription
	Tracks []HuddleSubscription
}

// SubscribeHuddle は、同じハドルにいる userIDs の音声を受ける（決定 9）。
// Go がユーザー ID を相手の Cloudflare のセッションに引き直すので、同じハドルにいない人の音声は受けられない（決定 2）。
// いない人・自分は黙って飛ばす（抜けた直後の要求はよくある）。
func (s *Service) SubscribeHuddle(ctx context.Context, actor, huddleID, participantID ulid.ULID, userIDs []ulid.ULID) (SubscribedHuddle, error) {
	if len(userIDs) > HuddleParticipantLimit {
		return SubscribedHuddle{}, &ValidationError{Fields: []FieldError{{Field: "user_ids", Reason: ReasonInvalidValue}}}
	}
	p, err := s.ownParticipant(ctx, actor, huddleID, participantID)
	if err != nil {
		return SubscribedHuddle{}, err
	}
	snaps, err := s.huddles.states.Snapshots(ctx, []ulid.ULID{huddleID}, s.clock.Now())
	if err != nil {
		return SubscribedHuddle{}, err
	}
	bySession := map[string]ulid.ULID{}
	var remotes []RemoteTrack
	for _, other := range snaps[huddleID].Participants {
		if other.UserID == actor || !slices.Contains(userIDs, other.UserID) {
			continue
		}
		bySession[other.SFUSessionID] = other.UserID
		remotes = append(remotes, RemoteTrack{SessionID: other.SFUSessionID, TrackName: other.TrackName})
	}
	if len(remotes) == 0 {
		return SubscribedHuddle{}, nil
	}
	res, err := s.huddles.media.Subscribe(ctx, p.SFUSessionID, remotes)
	if err != nil {
		return SubscribedHuddle{}, fmt.Errorf("subscribe huddle audio: %w", err)
	}
	out := SubscribedHuddle{Offer: res.Offer}
	for _, t := range res.Tracks {
		if userID, ok := bySession[t.SessionID]; ok && t.OK {
			out.Tracks = append(out.Tracks, HuddleSubscription{UserID: userID, Mid: t.Mid})
		}
	}
	return out, nil
}

// RenegotiateHuddle は SubscribeHuddle の offer に対するブラウザの answer を渡す。
func (s *Service) RenegotiateHuddle(ctx context.Context, actor, huddleID, participantID ulid.ULID, answer SessionDescription) error {
	if err := validateAnswer(answer); err != nil {
		return err
	}
	p, err := s.ownParticipant(ctx, actor, huddleID, participantID)
	if err != nil {
		return err
	}
	if err := s.huddles.media.Renegotiate(ctx, p.SFUSessionID, answer); err != nil {
		return fmt.Errorf("renegotiate huddle: %w", err)
	}
	return nil
}

// UnsubscribeHuddle は、抜けた人の分の受けるトラックを閉じる（決定 9）。
func (s *Service) UnsubscribeHuddle(ctx context.Context, actor, huddleID, participantID ulid.ULID, mids []string) error {
	if len(mids) == 0 || len(mids) > HuddleParticipantLimit || slices.Contains(mids, "") {
		return &ValidationError{Fields: []FieldError{{Field: "mids", Reason: ReasonInvalidValue}}}
	}
	p, err := s.ownParticipant(ctx, actor, huddleID, participantID)
	if err != nil {
		return err
	}
	if err := s.huddles.media.Close(ctx, p.SFUSessionID, mids); err != nil {
		return fmt.Errorf("close huddle tracks: %w", err)
	}
	return nil
}

// SetHuddleMuted はミュートの印を書き換える（決定 10）。音を止めるのは本人のブラウザで、サーバーは強制しない。
func (s *Service) SetHuddleMuted(ctx context.Context, actor, huddleID, participantID ulid.ULID, muted bool) error {
	p, err := s.ownParticipant(ctx, actor, huddleID, participantID)
	if err != nil {
		return err
	}
	if _, ok, err := s.huddles.states.SetMuted(ctx, huddleID, p.ID, muted); err != nil {
		return err
	} else if !ok {
		return ErrHuddleParticipantGone
	}
	s.deliverHuddleUpdated(ctx, huddleID)
	return nil
}

// HuddleJoiningSoon は「もうすぐ参加する」を知らせる（決定 11）。ハドルにいる人の画面に 5 分出る。
func (s *Service) HuddleJoiningSoon(ctx context.Context, actor, huddleID ulid.ULID) error {
	if !s.huddles.enabled() {
		return ErrHuddlesUnavailable
	}
	h, err := s.lookupHuddle(ctx, huddleID)
	if err != nil {
		return err
	}
	if err := s.checkJoinHuddle(ctx, actor, h.RoomID); err != nil {
		return err
	}
	if h.EndedAt != nil {
		return ErrNotFound
	}
	now := s.clock.Now()
	if _, err := s.huddles.states.JoiningSoon(ctx, huddleID, actor, now.Add(HuddleJoiningSoonTTL), now); err != nil {
		return err
	}
	s.deliverHuddleUpdated(ctx, huddleID)
	return nil
}

// HeartbeatHuddle は心拍を受ける（決定 5）。参加がもうなければ false（クライアントは外れたと分かる）。
func (s *Service) HeartbeatHuddle(ctx context.Context, actor, huddleID, participantID ulid.ULID) (bool, error) {
	if !s.huddles.enabled() {
		return false, nil
	}
	return s.huddles.states.Heartbeat(ctx, actor, huddleID, participantID, s.clock.Now().Add(HuddleHeartbeatTTL))
}

// ---- 抜ける・外す・終わる（決定 4・5・8）----

// LeaveHuddle は自分の参加を外す。もう外れていれば何もしない（何度呼んでもよい）。
func (s *Service) LeaveHuddle(ctx context.Context, actor, huddleID, participantID ulid.ULID) error {
	if _, err := s.ownParticipant(ctx, actor, huddleID, participantID); err != nil {
		if errors.Is(err, ErrHuddleParticipantGone) {
			return nil
		}
		return err
	}
	removed, err := s.huddles.states.Remove(ctx, huddleID, participantID)
	if err != nil {
		return err
	}
	if removed != nil {
		s.afterHuddleRemoval(ctx, []RemovedParticipant{*removed}, HuddleLeft)
	}
	return nil
}

// SweepHuddles は、心拍の途絶えた参加を外す（決定 5）。外した数を返す。
func (s *Service) SweepHuddles(ctx context.Context) int {
	if !s.huddles.enabled() {
		return 0
	}
	total := 0
	for {
		removed, err := s.huddles.states.Sweep(ctx, s.clock.Now(), huddleSweepBatch)
		if err != nil {
			s.logger.WarnContext(ctx, "sweep huddles failed", slog.Any("error", err))
			return total
		}
		s.afterHuddleRemoval(ctx, removed, HuddleExpired)
		total += len(removed)
		if len(removed) < huddleSweepBatch {
			return total
		}
	}
}

// RunHuddleSweeper は ctx が終わるまで interval ごとに SweepHuddles を呼ぶ。
func (s *Service) RunHuddleSweeper(ctx context.Context, interval time.Duration) {
	if !s.huddles.enabled() {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		s.SweepHuddles(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// afterHuddleRemoval は、外した参加の後始末をする。
//   - Cloudflare のトラックを閉じる（送るものも受けるものも。ブラウザは秘密を持たないので受け直せない。決定 2・8）
//   - 外された（removed）なら、発行した TURN の認証情報も取り消す（決定 8）
//   - 本人のすべての接続に huddle.left を送る（別の端末で抜けた場合も含めて、画面を片付けるため）
//   - ハドルに誰も残らなければ終わらせ、残っていれば huddle.updated を配る
func (s *Service) afterHuddleRemoval(ctx context.Context, removed []RemovedParticipant, reason HuddleLeftReason) {
	if len(removed) == 0 {
		return
	}
	ctx = context.WithoutCancel(ctx)
	rooms := map[ulid.ULID]ulid.ULID{}
	var events []Event
	var wg sync.WaitGroup
	for _, r := range removed {
		p := r.Participant
		wg.Go(func() { s.closeHuddleMedia(ctx, p) })
		if reason == HuddleRemoved {
			wg.Go(func() { s.revokeHuddleICE(ctx, p.UserID) })
		}
		roomID, ok := rooms[p.HuddleID]
		if !ok {
			h, err := s.lookupHuddle(ctx, p.HuddleID)
			if err != nil {
				s.logger.WarnContext(ctx, "look up huddle failed", slog.String("huddle_id", p.HuddleID.String()), slog.Any("error", err))
				continue
			}
			roomID = h.RoomID
			rooms[p.HuddleID] = roomID
		}
		events = append(events, Event{
			Type: EventHuddleLeft,
			To:   Audience{Users: []ulid.ULID{p.UserID}},
			Data: HuddleLeftData{RoomID: roomID, HuddleID: p.HuddleID, ParticipantID: p.ID, Reason: reason},
		})
	}
	s.deliver(ctx, events...)
	for huddleID := range rooms {
		s.endHuddleIfEmpty(ctx, huddleID)
	}
	wg.Wait()
}

// endHuddleIfEmpty は、誰も残っていなければハドルを終わらせ、残っていれば huddle.updated を配る。
func (s *Service) endHuddleIfEmpty(ctx context.Context, huddleID ulid.ULID) {
	var (
		ended bool
		msg   Message
		room  ulid.ULID
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		// 入る要求と同じ行をロックする。入っている途中の人がいれば、その人のコミットの後で数える（決定 4）
		h, err := q.LockHuddle(ctx, huddleID)
		if err != nil {
			return notFoundIfNoRows(err, "lock huddle")
		}
		room = h.RoomID
		if h.EndedAt != nil {
			return nil
		}
		snaps, err := s.huddles.states.Snapshots(ctx, []ulid.ULID{huddleID}, s.clock.Now())
		if err != nil {
			return err
		}
		if len(snaps[huddleID].Participants) > 0 {
			return nil
		}
		if msg, err = s.endHuddle(ctx, q, h); err != nil {
			return err
		}
		ended = true
		return nil
	})
	if errors.Is(err, ErrNotFound) {
		return // ルームごと消えた
	}
	if err != nil {
		s.logger.WarnContext(ctx, "end huddle failed", slog.String("huddle_id", huddleID.String()), slog.Any("error", err))
		return
	}
	if !ended {
		s.deliverHuddleUpdated(ctx, huddleID)
		return
	}
	if _, err := s.huddles.states.Clear(ctx, huddleID); err != nil {
		s.logger.WarnContext(ctx, "clear huddle state failed", slog.String("huddle_id", huddleID.String()), slog.Any("error", err))
	}
	s.deliver(ctx, messageEvent(EventMessageUpdated, msg), huddleUpdatedEvent(room, nil))
}

// endHuddle はハドルを終わらせ、会話のメッセージを「終了」にする（決定 12）。
func (s *Service) endHuddle(ctx context.Context, q *store.Queries, h store.Huddle) (Message, error) {
	if err := q.EndHuddle(ctx, store.EndHuddleParams{ID: h.ID, Now: s.clock.Now()}); err != nil {
		return Message{}, fmt.Errorf("end huddle: %w", err)
	}
	return s.touchHuddleMessage(ctx, q, h)
}

// endRoomHuddle は、ルームの進行中のハドルを、入っている人ごと終わらせる（アーカイブ。決定 7）。
func (s *Service) endRoomHuddle(ctx context.Context, roomID ulid.ULID) {
	if !s.huddles.enabled() {
		return
	}
	ctx = context.WithoutCancel(ctx)
	var (
		h   store.Huddle
		msg Message
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		var err error
		if h, err = q.LockActiveHuddle(ctx, roomID); err != nil {
			return err
		}
		msg, err = s.endHuddle(ctx, q, h)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return
	}
	if err != nil {
		s.logger.WarnContext(ctx, "end room huddle failed", slog.String("room_id", roomID.String()), slog.Any("error", err))
		return
	}
	s.clearEndedHuddle(ctx, roomID, h.ID)
	s.deliver(ctx, messageEvent(EventMessageUpdated, msg), huddleUpdatedEvent(roomID, nil))
}

// clearEndedHuddle は、終わらせたハドルに入っていた人を全員外す（ルームのアーカイブ・削除。決定 7・8）。
func (s *Service) clearEndedHuddle(ctx context.Context, roomID, huddleID ulid.ULID) {
	participants, err := s.huddles.states.Clear(ctx, huddleID)
	if err != nil {
		s.logger.WarnContext(ctx, "clear huddle state failed", slog.String("huddle_id", huddleID.String()), slog.Any("error", err))
		return
	}
	var events []Event
	var wg sync.WaitGroup
	for _, p := range participants {
		wg.Go(func() { s.closeHuddleMedia(ctx, p) })
		wg.Go(func() { s.revokeHuddleICE(ctx, p.UserID) })
		events = append(events, Event{
			Type: EventHuddleLeft,
			To:   Audience{Users: []ulid.ULID{p.UserID}},
			Data: HuddleLeftData{RoomID: roomID, HuddleID: huddleID, ParticipantID: p.ID, Reason: HuddleRemoved},
		})
	}
	s.deliver(ctx, events...)
	wg.Wait()
}

// removeFromHuddle は、権限が変わった人をハドルからすぐに外す（CLAUDE.md ルール 8。決定 8）。
// affected はそのハドル（のルームとワークスペース）が対象かを決める。1 人が入れるハドルは 1 つなので、見るのは 1 つだけ（決定 6）。
func (s *Service) removeFromHuddle(ctx context.Context, userID ulid.ULID, affected func(store.GetHuddleRoomRow) bool) {
	if !s.huddles.enabled() {
		return
	}
	ctx = context.WithoutCancel(ctx)
	huddleID, participantID, ok, err := s.huddles.states.Current(ctx, userID)
	if err != nil {
		s.logger.WarnContext(ctx, "read current huddle failed", slog.Any("error", err))
		return
	}
	if !ok {
		return
	}
	h, err := s.lookupHuddle(ctx, huddleID)
	if err != nil || !affected(h) {
		return
	}
	removed, err := s.huddles.states.Remove(ctx, huddleID, participantID)
	if err != nil {
		s.logger.WarnContext(ctx, "remove from huddle failed", slog.Any("error", err))
		return
	}
	if removed != nil {
		s.afterHuddleRemoval(ctx, []RemovedParticipant{*removed}, HuddleRemoved)
	}
}

// RemoveRevokedHuddleSession は、失効したログインのセッションで入っている参加を外す（決定 8）。
// all ならその人のすべてのセッション（全端末のログアウト、Refresh Token の再利用の検知）。
func (s *Service) RemoveRevokedHuddleSession(ctx context.Context, userID, sessionID ulid.ULID, all bool) {
	if !s.huddles.enabled() {
		return
	}
	huddleID, participantID, ok, err := s.huddles.states.Current(ctx, userID)
	if err != nil || !ok {
		return
	}
	p, err := s.huddles.states.Participant(ctx, huddleID, participantID)
	if err != nil || p == nil || (!all && p.AuthSessionID != sessionID) {
		return
	}
	removed, err := s.huddles.states.Remove(ctx, huddleID, participantID)
	if err != nil {
		s.logger.WarnContext(ctx, "remove revoked huddle session failed", slog.Any("error", err))
		return
	}
	if removed != nil {
		s.afterHuddleRemoval(ctx, []RemovedParticipant{*removed}, HuddleRemoved)
	}
}

func (s *Service) lookupHuddle(ctx context.Context, huddleID ulid.ULID) (store.GetHuddleRoomRow, error) {
	h, err := store.New(s.db).GetHuddleRoom(ctx, huddleID)
	if err != nil {
		return store.GetHuddleRoomRow{}, notFoundIfNoRows(err, "get huddle room")
	}
	return h, nil
}

// closeHuddleMedia は参加の Cloudflare のトラックを全部閉じる。失敗しても、セッションは接続が切れて 30 秒で消える。
func (s *Service) closeHuddleMedia(ctx context.Context, p HuddleParticipant) {
	if p.SFUSessionID == "" {
		return
	}
	if err := s.huddles.media.Close(ctx, p.SFUSessionID, nil); err != nil {
		s.logger.WarnContext(ctx, "close huddle media failed", slog.String("participant_id", p.ID.String()), slog.Any("error", err))
	}
}

// revokeHuddleICE は、その人に発行した TURN の認証情報を取り消す（決定 8）。取り消せなくても、12 時間で使えなくなる。
func (s *Service) revokeHuddleICE(ctx context.Context, userID ulid.ULID) {
	names, err := s.huddles.states.TakeICEUsernames(ctx, userID, s.clock.Now())
	if err != nil {
		s.logger.WarnContext(ctx, "take ice usernames failed", slog.Any("error", err))
		return
	}
	for _, name := range names {
		if err := s.huddles.media.RevokeICE(ctx, name); err != nil {
			s.logger.WarnContext(ctx, "revoke ice failed", slog.Any("error", err))
		}
	}
}

// ---- 読む（決定 12・13）----

// huddleView はハドルのいまの状態（Redis）を、ルームの応答と huddle.updated の形にする。
func (s *Service) huddleView(ctx context.Context, h store.Huddle) (RoomHuddle, error) {
	snaps, err := s.huddles.states.Snapshots(ctx, []ulid.ULID{h.ID}, s.clock.Now())
	if err != nil {
		return RoomHuddle{}, err
	}
	return roomHuddle(h.ID, h.RoomID, h.MessageID, h.StartedAt, snaps[h.ID]), nil
}

func roomHuddle(id, roomID, messageID ulid.ULID, startedAt time.Time, snap HuddleSnapshot) RoomHuddle {
	v := RoomHuddle{ID: id, RoomID: roomID, MessageID: messageID, StartedAt: startedAt, Version: snap.Version, JoiningSoon: snap.JoiningSoon}
	seen := map[ulid.ULID]bool{}
	for _, p := range snap.Participants {
		if seen[p.UserID] {
			continue
		}
		seen[p.UserID] = true
		v.Participants = append(v.Participants, RoomHuddleParticipant{UserID: p.UserID, Muted: p.Muted})
	}
	return v
}

// deliverHuddleUpdated は、ハドルのいまの状態を huddle.updated で配る。
// 差分ではなく全体と版を配るので、取りこぼしても次の 1 件で正しくなり、届く順が入れ替わっても古い版は捨てられる（決定 13）。
func (s *Service) deliverHuddleUpdated(ctx context.Context, huddleID ulid.ULID) {
	h, err := store.New(s.db).GetHuddle(ctx, huddleID)
	if err != nil {
		s.logger.WarnContext(ctx, "get huddle failed", slog.String("huddle_id", huddleID.String()), slog.Any("error", err))
		return
	}
	if h.EndedAt != nil {
		return
	}
	view, err := s.huddleView(ctx, h)
	if err != nil {
		s.logger.WarnContext(ctx, "read huddle state failed", slog.String("huddle_id", huddleID.String()), slog.Any("error", err))
		return
	}
	s.deliver(ctx, huddleUpdatedEvent(h.RoomID, &view))
}

func huddleUpdatedEvent(roomID ulid.ULID, h *RoomHuddle) Event {
	return Event{Type: EventHuddleUpdated, To: Audience{Rooms: []ulid.ULID{roomID}}, Data: HuddleUpdated{RoomID: roomID, Huddle: h}}
}

// attachHuddles は、ルームの一覧と 1 件の取得に進行中のハドルを添える（決定 13）。
// 再接続したクライアントは、ここからハドルの状態を読み直す（presence と同じく、Redis の状態は REST で読み直す）。
// ハドルは表示の補助なので、Redis に届かなければ添えずに返す（一覧そのものは失敗させない）。
func (s *Service) attachHuddles(ctx context.Context, rooms []Room) {
	if !s.huddles.enabled() || len(rooms) == 0 {
		return
	}
	ids := make([]ulid.ULID, len(rooms))
	for i, r := range rooms {
		ids[i] = r.ID
	}
	active, err := store.New(s.db).ListActiveHuddlesInRooms(ctx, ids)
	if err != nil {
		s.logger.WarnContext(ctx, "list active huddles failed", slog.Any("error", err))
		return
	}
	if len(active) == 0 {
		return
	}
	huddleIDs := make([]ulid.ULID, len(active))
	for i, h := range active {
		huddleIDs[i] = h.ID
	}
	snaps, err := s.huddles.states.Snapshots(ctx, huddleIDs, s.clock.Now())
	if err != nil {
		s.logger.WarnContext(ctx, "read huddle states failed", slog.Any("error", err))
		return
	}
	byRoom := make(map[ulid.ULID]RoomHuddle, len(active))
	for _, h := range active {
		byRoom[h.RoomID] = roomHuddle(h.ID, h.RoomID, h.MessageID, h.StartedAt, snaps[h.ID])
	}
	for i := range rooms {
		if h, ok := byRoom[rooms[i].ID]; ok {
			rooms[i].Huddle = &h
		}
	}
}

// loadMessageHuddles は、ハドルのメッセージに Huddle を載せる（決定 12）。ページの分を 1 回のクエリで引く。
func loadMessageHuddles(ctx context.Context, q *store.Queries, msgs []Message) error {
	var ids []ulid.ULID
	for _, m := range msgs {
		if m.System != nil && m.System.Type == SystemHuddle {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := q.ListHuddlesOfMessages(ctx, ids)
	if err != nil {
		return fmt.Errorf("list huddles of messages: %w", err)
	}
	byMessage := make(map[ulid.ULID]*MessageHuddle, len(rows))
	for _, r := range rows {
		byMessage[r.MessageID] = &MessageHuddle{ID: r.ID, StartedAt: r.StartedAt, EndedAt: r.EndedAt, ParticipantIDs: r.ParticipantIds}
	}
	for i := range msgs {
		if h, ok := byMessage[msgs[i].ID]; ok {
			msgs[i].Huddle = h
		}
	}
	return nil
}
