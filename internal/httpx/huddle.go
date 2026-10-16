package httpx

import (
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
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
	// Camera はカメラを送っているか（ADR 0068 決定 4）。
	Camera bool `json:"camera"`
	// Screen は画面を共有しているか。
	Screen bool `json:"screen"`
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
		resp.Participants = append(resp.Participants, huddleParticipantResponse{UserID: p.UserID.String(), Muted: p.Muted, Camera: p.Camera, Screen: p.Screen})
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

// ---- HTTP の API（決定 4）----

// sessionDescriptionBody は SDP（RTCSessionDescription と同じ形）。
type sessionDescriptionBody struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

func (b sessionDescriptionBody) toChat() chat.SessionDescription {
	return chat.SessionDescription{Type: b.Type, SDP: b.SDP}
}

func newSessionDescriptionBody(d chat.SessionDescription) sessionDescriptionBody {
	return sessionDescriptionBody{Type: d.Type, SDP: d.SDP}
}

// iceServerResponse は RTCIceServer と同じ形。ブラウザの RTCPeerConnection にそのまま渡す。
type iceServerResponse struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitzero"`
	Credential string   `json:"credential,omitzero"`
}

type huddleICEServersResponse struct {
	ICEServers []iceServerResponse `json:"ice_servers"`
	// ExpiresAt は TURN の認証情報の期限。長いハドルでは、切れる前に取り直して setConfiguration で差し替える（決定 14）。
	ExpiresAt time.Time `json:"expires_at"`
	// ICETransportPolicy は RTCConfiguration の iceTransportPolicy にそのまま渡す。
	ICETransportPolicy iceTransportPolicy `json:"ice_transport_policy"`
}

// iceTransportPolicy は RTCIceTransportPolicy と同じ値。
// relay は開発で TURN を通る経路を確かめるときだけ使う（HUDDLE_ICE_TRANSPORT_POLICY）。
// 違うネットワークを用意しなくても、ブラウザに直接の経路を捨てさせれば中継を通る。
type iceTransportPolicy string

const (
	iceTransportAll   iceTransportPolicy = "all"
	iceTransportRelay iceTransportPolicy = "relay"
)

// getHuddleICEServers は、ルームのハドルに入るための ICE サーバーを発行する（決定 4・14）。
func (h *chatHandlers) getHuddleICEServers(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	creds, err := h.svc.HuddleICEServers(r.Context(), actorOf(r), roomID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := huddleICEServersResponse{ICEServers: []iceServerResponse{}, ExpiresAt: creds.ExpiresAt, ICETransportPolicy: iceTransportAll}
	if creds.RelayOnly {
		resp.ICETransportPolicy = iceTransportRelay
	}
	for _, s := range creds.Servers {
		resp.ICEServers = append(resp.ICEServers, iceServerResponse(s))
	}
	writeJSON(w, http.StatusOK, resp)
}

type joinHuddleRequest struct {
	Offer sessionDescriptionBody `json:"offer"`
	// Mid は offer の中の、マイクの音声の transceiver の mid。
	Mid string `json:"mid"`
}

type joinHuddleResponse struct {
	Huddle roomHuddleResponse `json:"huddle"`
	// ParticipantID は「この端末のこの参加」（決定 4）。入った後の操作と心拍に使う。
	ParticipantID string                 `json:"participant_id"`
	Answer        sessionDescriptionBody `json:"answer"`
}

// joinHuddle はルームのハドルに入る。進行中のハドルがなければ始める（決定 4）。
func (h *chatHandlers) joinHuddle(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req joinHuddleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	// 失効したログインのセッションで入っている参加を外すため、sid も渡す（決定 8）
	identity, _ := authn.FromContext(r.Context())
	joined, err := h.svc.JoinHuddle(r.Context(), identity.UserID, identity.SessionID, roomID, chat.JoinHuddleInput{Offer: req.Offer.toChat(), Mid: req.Mid})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, joinHuddleResponse{
		Huddle: *newRoomHuddleResponse(&joined.Huddle), ParticipantID: joined.ParticipantID.String(), Answer: newSessionDescriptionBody(joined.Answer),
	})
}

// huddleParticipantPath は /huddles/{huddleID}/participants/{participantID} の 2 つの ID を読む。
func huddleParticipantPath(r *http.Request) (huddleID, participantID ulid.ULID, err error) {
	if huddleID, err = pathID(r, "huddleID"); err != nil {
		return
	}
	participantID, err = pathID(r, "participantID")
	return
}

type subscribeHuddleRequest struct {
	// Tracks は受けたい相手のトラック。音声は全員、映像はステージに載せた人の分だけを頼む（ADR 0068 決定 5）。
	// いない人・自分・その種類を送っていない人は黙って飛ばす。
	Tracks []huddleTrackRequestBody `json:"tracks"`
}

type huddleTrackRequestBody struct {
	UserID string               `json:"user_id"`
	Kind   chat.HuddleTrackKind `json:"kind"`
	// Quality はカメラのときだけ要る（受ける層。ADR 0068 決定 6）。音声と画面では送らない。
	Quality chat.HuddleQuality `json:"quality,omitzero"`
}

type huddleSubscriptionResponse struct {
	UserID string               `json:"user_id"`
	Kind   chat.HuddleTrackKind `json:"kind"`
	Mid    string               `json:"mid"`
}

type subscribeHuddleResponse struct {
	// Offer は Cloudflare の offer。ブラウザの answer を renegotiate で返す。受けるものがなければ null。
	Offer  *sessionDescriptionBody      `json:"offer"`
	Tracks []huddleSubscriptionResponse `json:"tracks"`
}

// subscribeHuddle は、同じハドルにいる人のトラックを受ける（決定 9・ADR 0068 決定 5）。
func (h *chatHandlers) subscribeHuddle(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req subscribeHuddleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	reqs := make([]chat.HuddleTrackRequest, 0, len(req.Tracks))
	for _, t := range req.Tracks {
		id, err := ulid.ParseStrict(t.UserID)
		if err != nil {
			writeError(h.logger, w, r, &chat.ValidationError{Fields: []chat.FieldError{{Field: "tracks.user_id", Reason: chat.ReasonInvalidValue}}})
			return
		}
		reqs = append(reqs, chat.HuddleTrackRequest{UserID: id, Kind: t.Kind, Quality: t.Quality})
	}
	res, err := h.svc.SubscribeHuddle(r.Context(), actorOf(r), huddleID, participantID, reqs)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := subscribeHuddleResponse{Tracks: []huddleSubscriptionResponse{}}
	if res.Offer != nil {
		o := newSessionDescriptionBody(*res.Offer)
		resp.Offer = &o
	}
	for _, t := range res.Tracks {
		resp.Tracks = append(resp.Tracks, huddleSubscriptionResponse{UserID: t.UserID.String(), Kind: t.Kind, Mid: t.Mid})
	}
	writeJSON(w, http.StatusOK, resp)
}

type updateHuddleSubscriptionRequest struct {
	// UserID はその mid で受けているカメラの持ち主（サーバーは受けているものを覚えていない）。
	UserID  string             `json:"user_id"`
	Quality chat.HuddleQuality `json:"quality"`
}

// updateHuddleSubscription は、受けているカメラの層を替える（ADR 0068 決定 6）。SDP のやり取りは要らない。
func (h *chatHandlers) updateHuddleSubscription(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req updateHuddleSubscriptionRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	userID, err := ulid.ParseStrict(req.UserID)
	if err != nil {
		writeError(h.logger, w, r, &chat.ValidationError{Fields: []chat.FieldError{{Field: "user_id", Reason: chat.ReasonInvalidValue}}})
		return
	}
	if err := h.svc.SetHuddleSubscriptionQuality(r.Context(), actorOf(r), huddleID, participantID, r.PathValue("mid"), userID, req.Quality); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type publishHuddleTrackRequest struct {
	Kind  chat.HuddleTrackKind   `json:"kind"`
	Offer sessionDescriptionBody `json:"offer"`
	// Mid は offer の中の、足したカメラか画面の transceiver の mid。
	Mid string `json:"mid"`
}

type publishHuddleTrackResponse struct {
	Answer sessionDescriptionBody `json:"answer"`
}

// publishHuddleTrack は、カメラか画面を送り始める（ADR 0068 決定 3）。
func (h *chatHandlers) publishHuddleTrack(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req publishHuddleTrackRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	answer, err := h.svc.PublishHuddleTrack(r.Context(), actorOf(r), huddleID, participantID, req.Kind, req.Offer.toChat(), req.Mid)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, publishHuddleTrackResponse{Answer: newSessionDescriptionBody(answer)})
}

// unpublishHuddleTrack は、カメラか画面を送るのをやめる（ADR 0068 決定 2・3）。もうやめていても 204。
func (h *chatHandlers) unpublishHuddleTrack(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.UnpublishHuddleTrack(r.Context(), actorOf(r), huddleID, participantID, chat.HuddleTrackKind(r.PathValue("kind"))); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type renegotiateHuddleRequest struct {
	Answer sessionDescriptionBody `json:"answer"`
}

// renegotiateHuddle は subscribe の offer に対するブラウザの answer を渡す（決定 9）。
func (h *chatHandlers) renegotiateHuddle(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req renegotiateHuddleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.RenegotiateHuddle(r.Context(), actorOf(r), huddleID, participantID, req.Answer.toChat()); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type unsubscribeHuddleRequest struct {
	// Mids は閉じる受けるトラックの mid（抜けた人の分）。
	Mids []string `json:"mids"`
}

// unsubscribeHuddle は、抜けた人の分の受けるトラックを閉じる（決定 9）。
func (h *chatHandlers) unsubscribeHuddle(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req unsubscribeHuddleRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.UnsubscribeHuddle(r.Context(), actorOf(r), huddleID, participantID, req.Mids); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type updateHuddleParticipantRequest struct {
	Muted bool `json:"muted"`
}

// updateHuddleParticipant はミュートの印を書き換える（決定 10）。音を止めるのはブラウザ。
func (h *chatHandlers) updateHuddleParticipant(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req updateHuddleParticipantRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.SetHuddleMuted(r.Context(), actorOf(r), huddleID, participantID, req.Muted); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// leaveHuddle は自分の参加を外す（決定 4）。もう外れていても 204（タブを閉じたときの keepalive で重なってもよい）。
func (h *chatHandlers) leaveHuddle(w http.ResponseWriter, r *http.Request) {
	huddleID, participantID, err := huddleParticipantPath(r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.LeaveHuddle(r.Context(), actorOf(r), huddleID, participantID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// huddleJoiningSoon は DM の呼び出しの「もうすぐ参加する」（決定 11）。
func (h *chatHandlers) huddleJoiningSoon(w http.ResponseWriter, r *http.Request) {
	huddleID, err := pathID(r, "huddleID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.HuddleJoiningSoon(r.Context(), actorOf(r), huddleID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// featuresResponse は、サーバーの設定で使えるかが変わる機能（ADR 0066 決定 15）。
// Web は起動したときに 1 回読み、使えない機能の入口（ボタン）を出さない。
type featuresResponse struct {
	// Huddles は音声のハドル。Cloudflare の設定がなければ false。
	Huddles bool `json:"huddles"`
}

func (h *chatHandlers) getFeatures(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, featuresResponse{Huddles: h.svc.HuddlesEnabled()})
}
