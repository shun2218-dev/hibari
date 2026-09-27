package httpx_test

import (
	"encoding/json/v2"
	"net/http"
	"slices"
	"testing"

	"github.com/oklog/ulid/v2"
)

// 音声のハドル（ADR 0066）の HTTP の API と WebSocket の心拍。Cloudflare は chattest.Media（偽物）。

var testOffer = map[string]string{"type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}

type huddleBody struct {
	ID           string `json:"id"`
	RoomID       string `json:"room_id"`
	MessageID    string `json:"message_id"`
	Version      int64  `json:"version"`
	Participants []struct {
		UserID string `json:"user_id"`
		Muted  bool   `json:"muted"`
	} `json:"participants"`
	JoiningSoon []string `json:"joining_soon"`
}

type joinedHuddleBody struct {
	Huddle        huddleBody `json:"huddle"`
	ParticipantID string     `json:"participant_id"`
	Answer        struct {
		Type string `json:"type"`
		SDP  string `json:"sdp"`
	} `json:"answer"`
}

func participantUserIDs(h *huddleBody) []string {
	if h == nil {
		return nil
	}
	out := make([]string, len(h.Participants))
	for i, p := range h.Participants {
		out[i] = p.UserID
	}
	return out
}

// huddleFixture は、owner と alice が参加しているチャンネルと、ワークスペースの外の人。
type huddleFixture struct {
	owner, alice, outsider apiUser
	room                   roomBody
}

func newHuddleFixture(t *testing.T, c *apiClient) huddleFixture {
	t.Helper()
	f := huddleFixture{owner: c.registerUser(), alice: c.registerUser(), outsider: c.registerUser()}
	r := c.as(f.owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "ハドル"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(f.owner, ws.ID, f.alice)
	r = c.as(f.owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "設計"})
	expectStatus(t, r, http.StatusCreated)
	f.room = decode[roomBody](t, r)
	expectStatus(t, c.as(f.alice, http.MethodPost, "/api/v1/rooms/"+f.room.ID+"/join", nil), http.StatusOK)
	return f
}

func (c *apiClient) joinHuddle(u apiUser, roomID string) joinedHuddleBody {
	c.t.Helper()
	r := c.as(u, http.MethodPost, "/api/v1/rooms/"+roomID+"/huddle/participants", map[string]any{"offer": testOffer, "mid": "0"})
	expectStatus(c.t, r, http.StatusCreated)
	return decode[joinedHuddleBody](c.t, r)
}

func TestHuddleAPI(t *testing.T) {
	c := newAPI(t)
	f := newHuddleFixture(t, c)
	roomPath := "/api/v1/rooms/" + f.room.ID

	t.Run("使える機能に huddles が載る", func(t *testing.T) {
		r := c.as(f.owner, http.MethodGet, "/api/v1/features", nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[struct {
			Huddles bool `json:"huddles"`
		}](t, r); !got.Huddles {
			t.Errorf("features = %s", r.body)
		}
	})
	t.Run("ICE サーバーは入れる人にだけ出す", func(t *testing.T) {
		r := c.as(f.owner, http.MethodPost, roomPath+"/huddle/ice-servers", nil)
		expectStatus(t, r, http.StatusOK)
		body := decode[struct {
			ICEServers []struct {
				URLs       []string `json:"urls"`
				Username   string   `json:"username"`
				Credential string   `json:"credential"`
			} `json:"ice_servers"`
			ExpiresAt          string `json:"expires_at"`
			ICETransportPolicy string `json:"ice_transport_policy"`
		}](t, r)
		// relay は開発で明示したときだけ。既定で直接の経路を捨てると、中継の転送量が無駄に増える
		if len(body.ICEServers) != 2 || body.ICEServers[1].Username == "" || body.ExpiresAt == "" || body.ICETransportPolicy != "all" {
			t.Errorf("body = %s", r.body)
		}
		expectProblem(t, c.as(f.outsider, http.MethodPost, roomPath+"/huddle/ice-servers", nil), http.StatusNotFound, "not-found")
	})

	joined := c.joinHuddle(f.owner, f.room.ID)
	participantPath := "/api/v1/huddles/" + joined.Huddle.ID + "/participants/" + joined.ParticipantID

	t.Run("入ると answer と参加 ID を返す", func(t *testing.T) {
		if joined.ParticipantID == "" || joined.Answer.Type != "answer" || !slices.Equal(participantUserIDs(&joined.Huddle), []string{f.owner.id}) {
			t.Errorf("joined = %+v", joined)
		}
		r := c.as(f.owner, http.MethodGet, roomPath, nil)
		expectStatus(t, r, http.StatusOK)
		room := decode[struct {
			Huddle *huddleBody `json:"huddle"`
		}](t, r)
		if room.Huddle == nil || room.Huddle.ID != joined.Huddle.ID {
			t.Errorf("room = %s", r.body)
		}
	})
	t.Run("offer の形が違えば 422", func(t *testing.T) {
		r := c.as(f.alice, http.MethodPost, roomPath+"/huddle/participants", map[string]any{"offer": map[string]string{"type": "answer", "sdp": "v=0"}, "mid": "0"})
		expectProblem(t, r, http.StatusUnprocessableEntity, "validation-error")
	})

	alice := c.joinHuddle(f.alice, f.room.ID)

	t.Run("同じハドルの人の音声を受ける", func(t *testing.T) {
		r := c.as(f.owner, http.MethodPost, participantPath+"/subscriptions", map[string]any{"user_ids": []string{f.alice.id}})
		expectStatus(t, r, http.StatusOK)
		body := decode[struct {
			Offer *struct {
				Type string `json:"type"`
			} `json:"offer"`
			Tracks []struct {
				UserID string `json:"user_id"`
				Mid    string `json:"mid"`
			} `json:"tracks"`
		}](t, r)
		if body.Offer == nil || body.Offer.Type != "offer" || len(body.Tracks) != 1 || body.Tracks[0].UserID != f.alice.id {
			t.Errorf("body = %s", r.body)
		}
		answer := map[string]any{"answer": map[string]string{"type": "answer", "sdp": "v=0\r\n"}}
		expectStatus(t, c.as(f.owner, http.MethodPut, participantPath+"/renegotiate", answer), http.StatusNoContent)
		expectStatus(t, c.as(f.owner, http.MethodPost, participantPath+"/subscriptions/close", map[string]any{"mids": []string{body.Tracks[0].Mid}}), http.StatusNoContent)
	})
	t.Run("他人の参加 ID では操作できない", func(t *testing.T) {
		r := c.as(f.alice, http.MethodPatch, participantPath, map[string]any{"muted": true})
		expectProblem(t, r, http.StatusConflict, "huddle-participant-gone")
	})
	t.Run("ミュートと「もうすぐ参加する」", func(t *testing.T) {
		expectStatus(t, c.as(f.owner, http.MethodPatch, participantPath, map[string]any{"muted": true}), http.StatusNoContent)
		expectStatus(t, c.as(f.owner, http.MethodPost, "/api/v1/huddles/"+joined.Huddle.ID+"/joining-soon", nil), http.StatusNoContent)
		expectProblem(t, c.as(f.outsider, http.MethodPost, "/api/v1/huddles/"+joined.Huddle.ID+"/joining-soon", nil), http.StatusNotFound, "not-found")
	})
	t.Run("抜ける（何度でも 204）", func(t *testing.T) {
		alicePath := "/api/v1/huddles/" + alice.Huddle.ID + "/participants/" + alice.ParticipantID
		expectStatus(t, c.as(f.alice, http.MethodDelete, alicePath, nil), http.StatusNoContent)
		expectStatus(t, c.as(f.alice, http.MethodDelete, alicePath, nil), http.StatusNoContent)
	})
}

// Cloudflare の設定がなければ 503（ADR 0066 決定 15）。
func TestHuddleAPIUnavailable(t *testing.T) {
	c := newAPI(t, withoutHuddles())
	f := newHuddleFixture(t, c)

	expectProblem(t, c.as(f.owner, http.MethodPost, "/api/v1/rooms/"+f.room.ID+"/huddle/ice-servers", nil), http.StatusServiceUnavailable, "huddles-unavailable")
	r := c.as(f.owner, http.MethodGet, "/api/v1/features", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[struct {
		Huddles bool `json:"huddles"`
	}](t, r); got.Huddles {
		t.Errorf("features = %s", r.body)
	}
	r = c.as(f.owner, http.MethodPost, "/api/v1/rooms/"+f.room.ID+"/huddle/participants", map[string]any{"offer": testOffer, "mid": "0"})
	expectProblem(t, r, http.StatusServiceUnavailable, "huddles-unavailable")
}

// ハドルの状態は WebSocket で届き、心拍は WebSocket で送る（ADR 0066 決定 5・13）。
func TestHuddleWebSocket(t *testing.T) {
	c := newAPI(t)
	f := newHuddleFixture(t, c)
	w := c.dialWS(f.alice)
	w.subscribe("room_id", f.room.ID)

	joined := c.joinHuddle(f.owner, f.room.ID)

	t.Run("始まると huddle.updated と会話のメッセージが届く", func(t *testing.T) {
		events := w.sync()
		updated := eventsOfType(events, "huddle.updated")
		if len(updated) != 1 {
			t.Fatalf("events = %+v", events)
		}
		var data struct {
			RoomID string      `json:"room_id"`
			Huddle *huddleBody `json:"huddle"`
		}
		if err := json.Unmarshal(updated[0].Data, &data); err != nil {
			t.Fatal(err)
		}
		if data.RoomID != f.room.ID || !slices.Equal(participantUserIDs(data.Huddle), []string{f.owner.id}) {
			t.Errorf("huddle.updated = %s", updated[0].Data)
		}
		created := eventsOfType(events, "message.created")
		if len(created) != 1 {
			t.Fatalf("message.created = %d", len(created))
		}
		var msg struct {
			System struct {
				Type     string `json:"type"`
				HuddleID string `json:"huddle_id"`
			} `json:"system"`
			Huddle struct {
				ID             string   `json:"id"`
				EndedAt        *string  `json:"ended_at"`
				ParticipantIDs []string `json:"participant_ids"`
			} `json:"huddle"`
		}
		if err := json.Unmarshal(created[0].Data, &msg); err != nil {
			t.Fatal(err)
		}
		if msg.System.Type != "huddle" || msg.System.HuddleID != joined.Huddle.ID || msg.Huddle.ID != joined.Huddle.ID || msg.Huddle.EndedAt != nil {
			t.Errorf("message = %s", created[0].Data)
		}
	})
	t.Run("心拍: 自分の参加なら ack、なければ not_found", func(t *testing.T) {
		owner := c.dialWS(f.owner)
		ack, _ := owner.request(map[string]any{"type": "huddle_heartbeat", "huddle_id": joined.Huddle.ID, "participant_id": joined.ParticipantID})
		if ack.Error != "" {
			t.Errorf("heartbeat ack = %+v", ack)
		}
		// 他人の参加 ID の心拍は通らない
		ack, _ = w.request(map[string]any{"type": "huddle_heartbeat", "huddle_id": joined.Huddle.ID, "participant_id": joined.ParticipantID})
		if ack.Error != "not_found" {
			t.Errorf("someone else's heartbeat ack = %+v", ack)
		}
		ack, _ = owner.request(map[string]any{"type": "huddle_heartbeat", "huddle_id": joined.Huddle.ID, "participant_id": ulid.Make().String()})
		if ack.Error != "not_found" {
			t.Errorf("unknown participant ack = %+v", ack)
		}
		ack, _ = owner.request(map[string]any{"type": "huddle_heartbeat", "huddle_id": "x", "participant_id": joined.ParticipantID})
		if ack.Error != "invalid_message" {
			t.Errorf("invalid id ack = %+v", ack)
		}
	})
	t.Run("最後の人が抜けると huddle: null", func(t *testing.T) {
		w.sync()
		expectStatus(t, c.as(f.owner, http.MethodDelete, "/api/v1/huddles/"+joined.Huddle.ID+"/participants/"+joined.ParticipantID, nil), http.StatusNoContent)
		updated := eventsOfType(w.sync(), "huddle.updated")
		if len(updated) != 1 {
			t.Fatalf("huddle.updated = %d", len(updated))
		}
		var data struct {
			Huddle *huddleBody `json:"huddle"`
		}
		if err := json.Unmarshal(updated[0].Data, &data); err != nil || data.Huddle != nil {
			t.Errorf("huddle.updated = %s", updated[0].Data)
		}
	})
}
