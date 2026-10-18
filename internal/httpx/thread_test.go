package httpx_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/oklog/ulid/v2"
)

type threadMessagesBody struct {
	Root              messageBody   `json:"root"`
	Messages          []messageBody `json:"messages"`
	HasMore           bool          `json:"has_more"`
	LastChangeSeq     int64         `json:"last_change_seq"`
	LastReadThreadSeq *int64        `json:"last_read_thread_seq"`
}

type threadListBody struct {
	Threads []struct {
		Room struct {
			ID   string  `json:"id"`
			Kind string  `json:"kind"`
			Name *string `json:"name"`
		} `json:"room"`
		Root struct {
			ID   string `json:"id"`
			Body string `json:"body"`
		} `json:"root"`
		ReplyCount  int64 `json:"reply_count"`
		UnreadCount int64 `json:"unread_count"`
	} `json:"threads"`
	NextCursor *string `json:"next_cursor"`
}

// スレッド（ADR 0036）: 返信 → チャンネルに出ない → スレッドで読む → 参加中の一覧と未読 → 既読。
func TestThreadFlow(t *testing.T) {
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

	r = c.as(owner, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "親"})
	expectStatus(t, r, http.StatusCreated)
	root := decode[messageBody](t, r)

	// 返信: thread_root_id を付けて送る。同じ client_msg_id の再送は既存を 200 で返す。
	clientMsgID := ulid.Make().String()
	r = c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": clientMsgID, "body": "返信", "thread_root_id": root.ID})
	expectStatus(t, r, http.StatusCreated)
	reply := decode[messageBody](t, r)
	if reply.ThreadRootID == nil || *reply.ThreadRootID != root.ID || reply.ThreadSeq == nil || *reply.ThreadSeq != 1 || reply.Thread != nil {
		t.Fatalf("reply = %s", r.body)
	}
	expectStatus(t, c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": clientMsgID, "body": "返信", "thread_root_id": root.ID}), http.StatusOK)
	// 返信への返信（入れ子）は 422。
	p := expectProblem(t, c.as(alice, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "x", "thread_root_id": reply.ID}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "thread_root_id" {
		t.Errorf("errors = %+v", p.Errors)
	}

	// チャンネルのタイムラインには返信が出ず、親に返信数が付く。
	r = c.as(owner, http.MethodGet, messages, nil)
	expectStatus(t, r, http.StatusOK)
	for _, m := range decode[messagesBody](t, r).Messages {
		if m.ID == reply.ID {
			t.Errorf("channel timeline has the reply")
		}
		if m.ID == root.ID && (m.Thread == nil || m.Thread.ReplyCount != 1 || m.Thread.LastThreadSeq != 1) {
			t.Errorf("root in the timeline = %+v", m)
		}
	}
	// 差分取得（after_change_seq）には返信も親も含まれる。
	r = c.as(owner, http.MethodGet, messages+"?after_change_seq="+strconv.FormatInt(root.ChangeSeq, 10), nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[messagesBody](t, r).Messages; len(got) != 2 || got[0].ID != reply.ID || got[1].ID != root.ID {
		t.Errorf("changes after root = %s", r.body)
	}

	// スレッドを読む。参加していない人（owner 以外の閲覧者）は last_read_thread_seq が null。
	thread := "/api/v1/rooms/" + room.ID + "/threads/" + root.ID
	r = c.as(owner, http.MethodGet, thread+"/messages", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[threadMessagesBody](t, r); got.Root.ID != root.ID || len(got.Messages) != 1 || got.Messages[0].ID != reply.ID ||
		got.LastReadThreadSeq == nil || *got.LastReadThreadSeq != 0 {
		t.Errorf("thread = %s", r.body)
	}
	expectProblem(t, c.as(owner, http.MethodGet, "/api/v1/rooms/"+room.ID+"/threads/"+reply.ID+"/messages", nil), http.StatusNotFound, "not-found")
	expectProblem(t, c.as(owner, http.MethodGet, thread+"/messages?before_seq=x", nil), http.StatusBadRequest, "bad-request")

	// 親の投稿者（owner）は参加していて、1 件が未読。サイドバーの一覧にもスレッドの未読の数が載る。
	r = c.as(owner, http.MethodGet, "/api/v1/workspaces/"+ws.ID+"/threads", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[threadListBody](t, r); len(got.Threads) != 1 || got.Threads[0].Root.ID != root.ID || got.Threads[0].UnreadCount != 1 ||
		got.Threads[0].Room.ID != room.ID || got.Threads[0].Room.Name == nil || *got.Threads[0].Room.Name != "雑談" || got.NextCursor != nil {
		t.Errorf("threads = %s", r.body)
	}
	r = c.as(owner, http.MethodGet, "/api/v1/workspaces/"+ws.ID+"/rooms", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[struct {
		UnreadThreadCount int64 `json:"unread_thread_count"`
	}](t, r); got.UnreadThreadCount != 1 {
		t.Errorf("rooms = %s", r.body)
	}

	// 既読: seq を受け取り、未読を返す。
	r = c.as(owner, http.MethodPost, thread+"/read", map[string]int64{"seq": reply.Seq})
	expectStatus(t, r, http.StatusOK)
	if got := decode[struct {
		Following         bool  `json:"following"`
		LastReadThreadSeq int64 `json:"last_read_thread_seq"`
		UnreadCount       int64 `json:"unread_count"`
	}](t, r); !got.Following || got.LastReadThreadSeq != 1 || got.UnreadCount != 0 {
		t.Errorf("thread read = %s", r.body)
	}
	expectProblem(t, c.as(owner, http.MethodPost, thread+"/read", map[string]string{}), http.StatusUnprocessableEntity, "validation-error")

	// 返信の削除で、親の返信数が減る。
	expectStatus(t, c.as(alice, http.MethodDelete, messages+"/"+reply.ID, nil), http.StatusNoContent)
	r = c.as(owner, http.MethodGet, thread+"/messages", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[threadMessagesBody](t, r); got.Root.Thread == nil || got.Root.Thread.ReplyCount != 0 || got.Root.Thread.LastThreadSeq != 1 {
		t.Errorf("root after deleting the reply = %s", r.body)
	}
}

// チャンネルにも投稿する（ADR 0039）: also_in_channel を付けた返信はチャンネルにも出て、フラグが返る。返信でなければ 422。
func TestThreadReplyAlsoInChannel(t *testing.T) {
	c := newAPI(t)
	owner := c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	messages := "/api/v1/rooms/" + room.ID + "/messages"

	r = c.as(owner, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "親"})
	expectStatus(t, r, http.StatusCreated)
	root := decode[messageBody](t, r)
	if root.AlsoInChannel {
		t.Errorf("channel post has also_in_channel: %s", r.body)
	}

	r = c.as(owner, http.MethodPost, messages, map[string]any{
		"client_msg_id": ulid.Make().String(), "body": "チャンネルにも", "thread_root_id": root.ID, "also_in_channel": true,
	})
	expectStatus(t, r, http.StatusCreated)
	reply := decode[messageBody](t, r)
	if !reply.AlsoInChannel || reply.ThreadRootID == nil || *reply.ThreadRootID != root.ID {
		t.Fatalf("reply = %s", r.body)
	}

	r = c.as(owner, http.MethodGet, messages+"?after_seq="+strconv.FormatInt(root.Seq, 10), nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[messagesBody](t, r).Messages; len(got) != 1 || got[0].ID != reply.ID || !got[0].AlsoInChannel {
		t.Errorf("channel after the root = %s", r.body)
	}

	p := expectProblem(t, c.as(owner, http.MethodPost, messages, map[string]any{
		"client_msg_id": ulid.Make().String(), "body": "x", "also_in_channel": true,
	}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "also_in_channel" || p.Errors[0].Reason != "invalid_value" {
		t.Errorf("errors = %+v", p.Errors)
	}
}
