package httpx

import (
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 音声のハドル（ADR 0066）。

// roomHuddleResponse はルームの進行中のハドル（決定 13）。ルームの応答と huddle.updated に載せる。
type roomHuddleResponse struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"room_id"`
	MessageID string    `json:"message_id"`
	StartedAt time.Time `json:"started_at"`
	// Version は状態の版。クライアントは手元より古い版を捨てる（決定 13）。
	Version int64 `json:"version"`
	// Participants はいま入っている人（入った順）。
	Participants []huddleParticipantResponse `json:"participants"`
	// JoiningSoon は「もうすぐ参加する」を押した人の user_id（決定 11）。
	JoiningSoon []string `json:"joining_soon"`
}

type huddleParticipantResponse struct {
	UserID string `json:"user_id"`
	Muted  bool   `json:"muted"`
}

func newRoomHuddleResponse(h *chat.RoomHuddle) *roomHuddleResponse {
	if h == nil {
		return nil
	}
	resp := &roomHuddleResponse{
		ID: h.ID.String(), RoomID: h.RoomID.String(), MessageID: h.MessageID.String(), StartedAt: h.StartedAt,
		Version: h.Version, Participants: []huddleParticipantResponse{}, JoiningSoon: []string{},
	}
	for _, p := range h.Participants {
		resp.Participants = append(resp.Participants, huddleParticipantResponse{UserID: p.UserID.String(), Muted: p.Muted})
	}
	for _, u := range h.JoiningSoon {
		resp.JoiningSoon = append(resp.JoiningSoon, u.String())
	}
	return resp
}

// messageHuddleResponse はハドルのメッセージに載せるハドル（決定 12）。見る人によらない値だけ。
// 「不在着信」「応答なし」「参加中」などの見え方は、クライアントが自分の ID と participant_ids から決める。
type messageHuddleResponse struct {
	ID        string    `json:"id"`
	StartedAt time.Time `json:"started_at"`
	// EndedAt は進行中なら null。
	EndedAt *time.Time `json:"ended_at"`
	// ParticipantIDs は一度でも入った人（最初に入った順）。
	ParticipantIDs []string `json:"participant_ids"`
}

func newMessageHuddleResponse(h *chat.MessageHuddle) *messageHuddleResponse {
	if h == nil {
		return nil
	}
	resp := &messageHuddleResponse{ID: h.ID.String(), StartedAt: h.StartedAt, EndedAt: h.EndedAt, ParticipantIDs: []string{}}
	for _, u := range h.ParticipantIDs {
		resp.ParticipantIDs = append(resp.ParticipantIDs, u.String())
	}
	return resp
}

// huddleUpdatedData は huddle.updated（決定 13）。差分ではなく全体。huddle が null ならハドルが終わった。
type huddleUpdatedData struct {
	RoomID string              `json:"room_id"`
	Huddle *roomHuddleResponse `json:"huddle"`
}

// huddleRingingData は huddle.ringing（DM の呼び出し。決定 11）。
type huddleRingingData struct {
	RoomID   string `json:"room_id"`
	HuddleID string `json:"huddle_id"`
	CallerID string `json:"caller_id"`
}

// huddleLeftData は huddle.left（自分の参加が外れた。決定 5・6・8）。
type huddleLeftData struct {
	RoomID        string                `json:"room_id"`
	HuddleID      string                `json:"huddle_id"`
	ParticipantID string                `json:"participant_id"`
	Reason        chat.HuddleLeftReason `json:"reason"`
}
