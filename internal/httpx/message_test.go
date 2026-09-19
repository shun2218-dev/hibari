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
	ThreadRootID *string `json:"thread_root_id"`
	ThreadSeq    *int64  `json:"thread_seq"`
	Thread       *struct {
		ReplyCount    int64 `json:"reply_count"`
		LastThreadSeq int64 `json:"last_thread_seq"`
	} `json:"thread"`
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
	// seq 1 はルームの作成のログ、2 は alice の参加のログ（ADR 0033）。人の発言はその次から。
	if first.Seq != 3 || first.Body != "こんにちは" || first.ClientMsgID != clientMsgID || first.Sender.ID != alice.id || first.RoomID != room.ID ||
		!strings.Contains(string(r.body), `"thread_root_id":null`) || !strings.Contains(string(r.body), `"deleted_at":null`) {
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

	// 参加した bob の発言。間に bob の参加のログ（seq 4）が入る。
	r = c.as(bob, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "返事です"})
	expectStatus(t, r, http.StatusCreated)
	reply := decode[messageBody](t, r)
	if reply.Seq != 5 {
		t.Errorf("bob's message = %s", r.body)
	}
	// 別のルームのメッセージをスレッドの親にはできない（422。seq も消費しない。ADR 0036）。
	r = c.as(owner, http.MethodPost, "/api/v1/rooms/"+other.ID+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": "別室"})
	expectStatus(t, r, http.StatusCreated)
	foreign := decode[messageBody](t, r)
	p := expectProblem(t, c.as(bob, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "x", "thread_root_id": foreign.ID}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "thread_root_id" {
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

	var latestSeq int64
	for i := range 3 {
		r = c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "続き " + strconv.Itoa(i)})
		expectStatus(t, r, http.StatusCreated)
		latestSeq = decode[messageBody](t, r).Seq
	}

	// 履歴: 最新から、before_seq で古い方へ、after_seq で差分を取る。messages は常に昇順。
	// このルームの seq の並びは、1=作成のログ、2=alice の参加のログ、3=first、4=bob の参加のログ、
	// 5=bob の発言、6〜8=続き 0〜2（システムメッセージも seq を消費する。ADR 0033）。
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
		{"?limit=2", "7,8", true},
		{"?before_seq=4&limit=2", "2,3", true},
		{"?before_seq=2", "1", false},
		{"?after_seq=2&limit=2", "3,4", true},
		{"?after_seq=5&limit=3", "6,7,8", false},
		{"?after_seq=8", "", false},
	} {
		r = c.as(bob, http.MethodGet, messages+tt.query, nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[messagesBody](t, r); seqs(got) != tt.wantSeqs || got.HasMore != tt.wantMore {
			t.Errorf("%s: seqs %s (has_more %v), want %s (has_more %v)", tt.query, seqs(got), got.HasMore, tt.wantSeqs, tt.wantMore)
		}
	}
	if r = c.as(bob, http.MethodGet, messages+"?after_seq="+strconv.FormatInt(latestSeq, 10), nil); !strings.Contains(string(r.body), `"messages":[]`) {
		t.Errorf("empty page = %s, want an empty array", r.body)
	}
	for _, q := range []string{"?before_seq=abc", "?after_seq=1.5", "?limit=0", "?after_change_seq=x"} {
		expectProblem(t, c.as(bob, http.MethodGet, messages+q, nil), http.StatusBadRequest, "bad-request")
	}
	expectProblem(t, c.as(bob, http.MethodGet, messages+"?before_seq=3&after_seq=1", nil), http.StatusUnprocessableEntity, "validation-error")
	expectProblem(t, c.as(bob, http.MethodGet, messages+"?after_seq=3&after_change_seq=1", nil), http.StatusUnprocessableEntity, "validation-error")
	// 差分取得（ADR 0014）: change_seq の順に返し、ルームの last_change_seq を付ける。
	// ここまで編集も削除もしていないので、change_seq は seq と同じ値になっている。
	r = c.as(bob, http.MethodGet, messages+"?after_change_seq=5", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[messagesBody](t, r); seqs(got) != "6,7,8" || got.HasMore || got.LastChangeSeq != 8 || got.Messages[0].ChangeSeq != 6 {
		t.Errorf("after_change_seq=5: %s", r.body)
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
	// 間にシステムメッセージが挟まるので、見たい 1 件ずつを after_seq で名指しして取る。
	r = c.as(bob, http.MethodGet, messages+"?after_seq="+strconv.FormatInt(first.Seq-1, 10)+"&limit=1", nil)
	expectStatus(t, r, http.StatusOK)
	if m := decode[messagesBody](t, r).Messages[0]; m.ID != first.ID || m.Body != "" || m.DeletedAt == nil {
		t.Errorf("tombstone = %+v", m)
	}

	// 既読と未読数。bob は自分の発言（seq 5）まで送信済み（= 既読）で、alice が 3 件送った。
	// 未読は人の発言だけを数える（ADR 0033）ので、間のログは数に入らない。
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
	if sidebar.LastReadSeq == nil || *sidebar.LastReadSeq != reply.Seq || sidebar.UnreadCount != 3 || sidebar.LastMessage == nil || sidebar.LastMessage.Body != "続き 2" {
		t.Errorf("sidebar room = %+v", sidebar)
	}
	readPath := "/api/v1/rooms/" + room.ID + "/read"
	r = c.as(bob, http.MethodPost, readPath, map[string]int{"seq": 99})
	expectStatus(t, r, http.StatusOK)
	if got := decode[struct {
		LastReadSeq int64 `json:"last_read_seq"`
		UnreadCount int64 `json:"unread_count"`
	}](t, r); got.LastReadSeq != latestSeq || got.UnreadCount != 0 {
		t.Errorf("read state = %s", r.body)
	}
	expectProblem(t, c.as(bob, http.MethodPost, readPath, map[string]string{}), http.StatusUnprocessableEntity, "validation-error")
	r = c.as(owner, http.MethodGet, "/api/v1/rooms/"+other.ID, nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[roomWithReadBody](t, r); got.LastReadSeq == nil || *got.LastReadSeq != foreign.Seq || got.UnreadCount != 0 || got.LastMessage == nil {
		t.Errorf("owner's room = %s", r.body)
	}
}
