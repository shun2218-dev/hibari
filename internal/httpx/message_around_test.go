package httpx_test

import (
	"net/http"
	"testing"

	"github.com/oklog/ulid/v2"
)

type aroundBody struct {
	Seq          int64   `json:"seq"`
	ThreadRootID *string `json:"thread_root_id"`
}

type messagesAroundBody struct {
	Messages     []messageBody `json:"messages"`
	HasMore      bool          `json:"has_more"`
	HasMoreAfter bool          `json:"has_more_after"`
	Around       *aroundBody   `json:"around"`
}

func seqsOfBody(msgs []messageBody) []int64 {
	out := make([]int64, len(msgs))
	for i, m := range msgs {
		out[i] = m.Seq
	}
	return out
}

// ?around_message_id= で、指定したメッセージを真ん中に置いた 1 ページが返る（ADR 0042）。
func TestListMessagesAround(t *testing.T) {
	c := newAPI(t)
	owner, alice := c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	expectStatus(t, c.as(alice, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)
	messages := "/api/v1/rooms/" + room.ID + "/messages"

	sent := make([]messageBody, 10)
	for i := range sent {
		sent[i] = decode[messageBody](t, c.sendMessage(owner, room.ID, string(rune('a'+i))))
	}
	target := sent[5]

	r = c.as(alice, http.MethodGet, messages+"?around_message_id="+target.ID+"&limit=5", nil)
	expectStatus(t, r, http.StatusOK)
	got := decode[messagesAroundBody](t, r)
	if want := []int64{sent[3].Seq, sent[4].Seq, target.Seq, sent[6].Seq, sent[7].Seq}; !equalInt64s(seqsOfBody(got.Messages), want) {
		t.Errorf("seqs = %v, want %v", seqsOfBody(got.Messages), want)
	}
	if !got.HasMore || !got.HasMoreAfter {
		t.Errorf("has_more = %v, has_more_after = %v, want both true", got.HasMore, got.HasMoreAfter)
	}
	if got.Around == nil || got.Around.Seq != target.Seq || got.Around.ThreadRootID != nil {
		t.Errorf("around = %s", r.body)
	}

	// 見つからない ID は、どれも同じ形（最新のページと around: null）。
	// ULID として読めない文字列も 400 にしない。区別できるとメッセージの実在を外から当てられる。
	r = c.as(alice, http.MethodGet, messages+"?limit=5", nil)
	expectStatus(t, r, http.StatusOK)
	latest := seqsOfBody(decode[messagesAroundBody](t, r).Messages)
	for _, id := range []string{ulid.Make().String(), "not-a-ulid"} {
		r := c.as(alice, http.MethodGet, messages+"?around_message_id="+id+"&limit=5", nil)
		expectStatus(t, r, http.StatusOK)
		got := decode[messagesAroundBody](t, r)
		if got.Around != nil {
			t.Errorf("around_message_id=%s: around = %s, want null", id, r.body)
		}
		if !equalInt64s(seqsOfBody(got.Messages), latest) {
			t.Errorf("around_message_id=%s: seqs = %v, want the latest page %v", id, seqsOfBody(got.Messages), latest)
		}
	}

	// ほかのカーソルと同時には指定できない。
	expectProblem(t, c.as(alice, http.MethodGet, messages+"?around_message_id="+target.ID+"&before_seq=3", nil),
		http.StatusUnprocessableEntity, "validation-error")

	// スレッドの返信を指すと、around に親の ID が入る。
	r = c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "返信", "thread_root_id": target.ID})
	expectStatus(t, r, http.StatusCreated)
	answer := decode[messageBody](t, r)
	r = c.as(alice, http.MethodGet, messages+"?around_message_id="+answer.ID+"&limit=3", nil)
	expectStatus(t, r, http.StatusOK)
	got = decode[messagesAroundBody](t, r)
	if got.Around == nil || got.Around.ThreadRootID == nil || *got.Around.ThreadRootID != target.ID {
		t.Fatalf("around = %s", r.body)
	}
	// チャンネルのタイムラインに出ない返信でも、対象自身は必ず入る。
	if last := got.Messages[len(got.Messages)-1]; last.ID != answer.ID {
		t.Errorf("last message = %s, want the reply %s", last.ID, answer.ID)
	}

	// スレッドの一覧でも同じクエリが使える。
	r = c.as(alice, http.MethodGet, "/api/v1/rooms/"+room.ID+"/threads/"+target.ID+"/messages?around_message_id="+answer.ID, nil)
	expectStatus(t, r, http.StatusOK)
	thread := decode[struct {
		Root         messageBody   `json:"root"`
		Messages     []messageBody `json:"messages"`
		HasMoreAfter bool          `json:"has_more_after"`
		Around       *aroundBody   `json:"around"`
	}](t, r)
	if thread.Root.ID != target.ID || len(thread.Messages) != 1 || thread.Messages[0].ID != answer.ID {
		t.Errorf("thread page = %s", r.body)
	}
	if thread.Around == nil || thread.Around.Seq != answer.Seq || thread.HasMoreAfter {
		t.Errorf("thread around = %s", r.body)
	}
}

func equalInt64s(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
