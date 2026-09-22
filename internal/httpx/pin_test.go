package httpx_test

import (
	"net/http"
	"testing"

	"github.com/oklog/ulid/v2"
)

// ピン留めの API（ロードマップ Phase 6.12 / ADR 0054）。

type pinBody struct {
	By userBody `json:"by"`
	At string   `json:"at"`
}

type messageWithPinBody struct {
	ID        string   `json:"id"`
	ChangeSeq int64    `json:"change_seq"`
	Seq       int64    `json:"seq"`
	Pinned    *pinBody `json:"pinned"`
	Kind      string   `json:"kind"`
	System    *struct {
		Type      string `json:"type"`
		MessageID string `json:"message_id"`
	} `json:"system"`
}

func pinPath(roomID, messageID string) string {
	return "/api/v1/rooms/" + roomID + "/messages/" + messageID + "/pin"
}

func TestPinFlow(t *testing.T) {
	c := newAPI(t)
	owner, alice, bob := c.registerUser(), c.registerUser(), c.registerUser()
	// carol はワークスペースのメンバーだが、このルームには参加しない（読めるが投稿できない）
	carol := c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	c.joinViaInvite(owner, ws.ID, bob)
	c.joinViaInvite(owner, ws.ID, carol)

	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	for _, u := range []apiUser{alice, bob} {
		expectStatus(t, c.as(u, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)
	}
	r = c.as(alice, http.MethodPost, "/api/v1/rooms/"+room.ID+"/messages",
		map[string]string{"client_msg_id": ulid.Make().String(), "body": "手順はこちら"})
	expectStatus(t, r, http.StatusCreated)
	msg := decode[messageWithPinBody](t, r)
	if msg.Pinned != nil {
		t.Fatalf("送信直後の pinned = %+v, want null", msg.Pinned)
	}
	path := pinPath(room.ID, msg.ID)

	t.Run("PUT でピン留めし、誰が付けたかが返る", func(t *testing.T) {
		r := c.as(bob, http.MethodPut, path, nil)
		expectStatus(t, r, http.StatusOK)
		got := decode[messageWithPinBody](t, r)
		if got.Pinned == nil || got.Pinned.By.ID != bob.id || got.Pinned.At == "" {
			t.Fatalf("pinned = %s", r.body)
		}
		if got.ChangeSeq <= msg.ChangeSeq || got.Seq != msg.Seq {
			t.Errorf("change_seq, seq = %d, %d", got.ChangeSeq, got.Seq)
		}
		// 2 回目も 200（冪等）
		expectStatus(t, c.as(alice, http.MethodPut, path, nil), http.StatusOK)
	})

	t.Run("チャンネルにピン留めのログが残る", func(t *testing.T) {
		r := c.as(alice, http.MethodGet, "/api/v1/rooms/"+room.ID+"/messages", nil)
		expectStatus(t, r, http.StatusOK)
		page := decode[struct {
			Messages []messageWithPinBody `json:"messages"`
		}](t, r)
		logs := 0
		for _, m := range page.Messages {
			if m.System != nil && m.System.Type == "message_pinned" {
				logs++
				if m.System.MessageID != msg.ID {
					t.Errorf("log.message_id = %q, want %q", m.System.MessageID, msg.ID)
				}
			}
		}
		if logs != 1 {
			t.Errorf("ピン留めのログ = %d 件, want 1（2 回目の PUT では増えない）", logs)
		}
	})

	t.Run("一覧は参加していない人でも読める", func(t *testing.T) {
		r := c.as(carol, http.MethodGet, "/api/v1/rooms/"+room.ID+"/pins", nil)
		expectStatus(t, r, http.StatusOK)
		list := decode[struct {
			Messages []messageWithPinBody `json:"messages"`
		}](t, r)
		if len(list.Messages) != 1 || list.Messages[0].ID != msg.ID || list.Messages[0].Pinned == nil {
			t.Errorf("pins = %s", r.body)
		}
	})

	t.Run("参加していない public ルームでは付けられない", func(t *testing.T) {
		expectProblem(t, c.as(carol, http.MethodDelete, path, nil), http.StatusForbidden, "forbidden")
	})

	t.Run("ワークスペースの外の人には見えない", func(t *testing.T) {
		stranger := c.registerUser()
		expectProblem(t, c.as(stranger, http.MethodPut, path, nil), http.StatusNotFound, "not-found")
		expectProblem(t, c.as(stranger, http.MethodGet, "/api/v1/rooms/"+room.ID+"/pins", nil), http.StatusNotFound, "not-found")
	})

	t.Run("DELETE で外れ、2 回目も 200", func(t *testing.T) {
		r := c.as(alice, http.MethodDelete, path, nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[messageWithPinBody](t, r); got.Pinned != nil {
			t.Errorf("pinned = %s, want null", r.body)
		}
		expectStatus(t, c.as(alice, http.MethodDelete, path, nil), http.StatusOK)
	})

	t.Run("存在しないメッセージは 404", func(t *testing.T) {
		expectProblem(t, c.as(alice, http.MethodPut, pinPath(room.ID, ulid.Make().String()), nil), http.StatusNotFound, "not-found")
	})
}
