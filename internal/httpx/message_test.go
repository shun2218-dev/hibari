package httpx_test

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

type messageBody struct {
	ID          string `json:"id"`
	RoomID      string `json:"room_id"`
	Seq         int64  `json:"seq"`
	ChangeSeq   int64  `json:"change_seq"`
	ClientMsgID string `json:"client_msg_id"`
	Body        string `json:"body"`
	Sender      struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
	} `json:"sender"`
	ReplyTo *struct {
		ID      string `json:"id"`
		Seq     int64  `json:"seq"`
		Body    string `json:"body"`
		Deleted bool   `json:"deleted"`
	} `json:"reply_to"`
	EditedAt  *string `json:"edited_at"`
	DeletedAt *string `json:"deleted_at"`
}

type messagesBody struct {
	Messages      []messageBody `json:"messages"`
	HasMore       bool          `json:"has_more"`
	LastChangeSeq int64         `json:"last_change_seq"`
}

type roomWithReadBody struct {
	ID          string `json:"id"`
	LastReadSeq *int64 `json:"last_read_seq"`
	UnreadCount int64  `json:"unread_count"`
	LastMessage *struct {
		ID      string `json:"id"`
		Body    string `json:"body"`
		Deleted bool   `json:"deleted"`
	} `json:"last_message"`
}

// ロードマップ Phase 3b の DoD: curl だけで 送信 → 履歴取得 が通る。
func TestMessageFlow(t *testing.T) {
	c := newAPI(t)
	owner, alice, bob := c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "別室"})
	expectStatus(t, r, http.StatusCreated)
	other := decode[roomBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	c.joinViaInvite(owner, ws.ID, bob)
	messages := "/api/v1/rooms/" + room.ID + "/messages"
	expectStatus(t, c.as(alice, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)

	// 送信: 新規は 201、同じ client_msg_id の再送は既存を 200 で返す。
	clientMsgID := ulid.Make().String()
	r = c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": clientMsgID, "body": "こんにちは"})
	expectStatus(t, r, http.StatusCreated)
	first := decode[messageBody](t, r)
	if first.Seq != 1 || first.Body != "こんにちは" || first.ClientMsgID != clientMsgID || first.Sender.ID != alice.id || first.RoomID != room.ID ||
		!strings.Contains(string(r.body), `"reply_to":null`) || !strings.Contains(string(r.body), `"deleted_at":null`) {
		t.Fatalf("sent message = %s", r.body)
	}
	r = c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": clientMsgID, "body": "こんにちは"})
	expectStatus(t, r, http.StatusOK)
	if got := decode[messageBody](t, r); got.ID != first.ID {
		t.Errorf("retry returned %s, want %s", got.ID, first.ID)
	}

	// public ルームは参加していなくても読めるが、書けない。
	expectProblem(t, c.as(bob, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "x"}), http.StatusForbidden, "forbidden")
	expectStatus(t, c.as(bob, http.MethodGet, messages, nil), http.StatusOK)
	expectStatus(t, c.as(bob, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)

	// 返信。別のルームのメッセージへの返信は 422。
	r = c.as(bob, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "返信です", "reply_to_id": first.ID})
	expectStatus(t, r, http.StatusCreated)
	reply := decode[messageBody](t, r)
	if reply.Seq != 2 || reply.ReplyTo == nil || reply.ReplyTo.ID != first.ID || reply.ReplyTo.Body != "こんにちは" {
		t.Errorf("reply = %s", r.body)
	}
	r = c.as(owner, http.MethodPost, "/api/v1/rooms/"+other.ID+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": "別室"})
	expectStatus(t, r, http.StatusCreated)
	foreign := decode[messageBody](t, r)
	p := expectProblem(t, c.as(bob, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "x", "reply_to_id": foreign.ID}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "reply_to_id" {
		t.Errorf("errors = %+v", p.Errors)
	}
	p = expectProblem(t, c.as(bob, http.MethodPost, messages, map[string]string{"client_msg_id": "not-a-ulid", "body": " "}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "client_msg_id" || p.Errors[0].Reason != "invalid_format" {
		t.Errorf("errors = %+v", p.Errors)
	}
	p = expectProblem(t, c.as(bob, http.MethodPost, messages, map[string]string{"body": " "}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 2 {
		t.Errorf("errors = %+v, want client_msg_id and body", p.Errors)
	}

	for i := range 3 {
		expectStatus(t, c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "続き " + strconv.Itoa(i)}), http.StatusCreated)
	}

	// 履歴: 最新から、before_seq で古い方へ、after_seq で差分を取る。messages は常に昇順。
	seqs := func(b messagesBody) string {
		s := make([]string, len(b.Messages))
		for i, m := range b.Messages {
			s[i] = strconv.FormatInt(m.Seq, 10)
		}
		return strings.Join(s, ",")
	}
	for _, tt := range []struct {
		query    string
		wantSeqs string
		wantMore bool
	}{
		{"?limit=2", "4,5", true},
		{"?before_seq=4&limit=2", "2,3", true},
		{"?before_seq=2", "1", false},
		{"?after_seq=2&limit=2", "3,4", true},
		{"?after_seq=4", "5", false},
		{"?after_seq=5", "", false},
	} {
		r = c.as(bob, http.MethodGet, messages+tt.query, nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[messagesBody](t, r); seqs(got) != tt.wantSeqs || got.HasMore != tt.wantMore {
			t.Errorf("%s: seqs %s (has_more %v), want %s (has_more %v)", tt.query, seqs(got), got.HasMore, tt.wantSeqs, tt.wantMore)
		}
	}
	if r = c.as(bob, http.MethodGet, messages+"?after_seq=5", nil); !strings.Contains(string(r.body), `"messages":[]`) {
		t.Errorf("empty page = %s, want an empty array", r.body)
	}
	for _, q := range []string{"?before_seq=abc", "?after_seq=1.5", "?limit=0", "?after_change_seq=x"} {
		expectProblem(t, c.as(bob, http.MethodGet, messages+q, nil), http.StatusBadRequest, "bad-request")
	}
	expectProblem(t, c.as(bob, http.MethodGet, messages+"?before_seq=3&after_seq=1", nil), http.StatusUnprocessableEntity, "validation-error")
	expectProblem(t, c.as(bob, http.MethodGet, messages+"?after_seq=3&after_change_seq=1", nil), http.StatusUnprocessableEntity, "validation-error")
	// 差分取得（ADR 0014）: change_seq の順に返し、ルームの last_change_seq を付ける。
	r = c.as(bob, http.MethodGet, messages+"?after_change_seq=3", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[messagesBody](t, r); seqs(got) != "4,5" || got.HasMore || got.LastChangeSeq != 5 || got.Messages[0].ChangeSeq != 4 {
		t.Errorf("after_change_seq=3: %s", r.body)
	}
	expectProblem(t, c.as(bob, http.MethodGet, "/api/v1/rooms/"+ulid.Make().String()+"/messages", nil), http.StatusNotFound, "not-found")

	// 編集は送信者だけ。owner でも他人のメッセージは編集できない。
	msgPath := messages + "/" + first.ID
	expectProblem(t, c.as(owner, http.MethodPatch, msgPath, map[string]string{"body": "乗っ取り"}), http.StatusForbidden, "forbidden")
	r = c.as(alice, http.MethodPatch, msgPath, map[string]string{"body": "こんにちは（修正）"})
	expectStatus(t, r, http.StatusOK)
	if got := decode[messageBody](t, r); got.Body != "こんにちは（修正）" || got.EditedAt == nil {
		t.Errorf("edited = %s", r.body)
	}
	expectProblem(t, c.as(alice, http.MethodPatch, "/api/v1/rooms/"+other.ID+"/messages/"+first.ID, map[string]string{"body": "x"}), http.StatusNotFound, "not-found")

	// 削除: member は他人のメッセージを消せない。owner は member のメッセージを消せる。冪等。削除済みは編集できない。
	expectProblem(t, c.as(bob, http.MethodDelete, msgPath, nil), http.StatusForbidden, "forbidden")
	expectStatus(t, c.as(owner, http.MethodDelete, msgPath, nil), http.StatusNoContent)
	expectStatus(t, c.as(alice, http.MethodDelete, msgPath, nil), http.StatusNoContent)
	expectProblem(t, c.as(alice, http.MethodPatch, msgPath, map[string]string{"body": "復活"}), http.StatusConflict, "message-deleted")
	r = c.as(bob, http.MethodGet, messages+"?limit=5", nil)
	expectStatus(t, r, http.StatusOK)
	history := decode[messagesBody](t, r)
	if m := history.Messages[0]; m.ID != first.ID || m.Body != "" || m.DeletedAt == nil {
		t.Errorf("tombstone = %+v", m)
	}
	if m := history.Messages[1]; m.ReplyTo == nil || !m.ReplyTo.Deleted || m.ReplyTo.Body != "" {
		t.Errorf("reply to deleted = %+v", m.ReplyTo)
	}

	// 既読と未読数。bob は seq 2 まで送信済み（= 既読）で、alice が 3〜5 を送った。
	r = c.as(bob, http.MethodGet, "/api/v1/workspaces/"+ws.ID+"/rooms", nil)
	expectStatus(t, r, http.StatusOK)
	var sidebar roomWithReadBody
	for _, rm := range decode[struct {
		Rooms []roomWithReadBody `json:"rooms"`
	}](t, r).Rooms {
		if rm.ID == room.ID {
			sidebar = rm
		}
	}
	if sidebar.LastReadSeq == nil || *sidebar.LastReadSeq != 2 || sidebar.UnreadCount != 3 || sidebar.LastMessage == nil || sidebar.LastMessage.Body != "続き 2" {
		t.Errorf("sidebar room = %+v", sidebar)
	}
	readPath := "/api/v1/rooms/" + room.ID + "/read"
	r = c.as(bob, http.MethodPost, readPath, map[string]int{"seq": 99})
	expectStatus(t, r, http.StatusOK)
	if got := decode[struct {
		LastReadSeq int64 `json:"last_read_seq"`
		UnreadCount int64 `json:"unread_count"`
	}](t, r); got.LastReadSeq != 5 || got.UnreadCount != 0 {
		t.Errorf("read state = %s", r.body)
	}
	expectProblem(t, c.as(bob, http.MethodPost, readPath, map[string]string{}), http.StatusUnprocessableEntity, "validation-error")
	r = c.as(owner, http.MethodGet, "/api/v1/rooms/"+other.ID, nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[roomWithReadBody](t, r); got.LastReadSeq == nil || *got.LastReadSeq != 1 || got.UnreadCount != 0 || got.LastMessage == nil {
		t.Errorf("owner's room = %s", r.body)
	}
}
