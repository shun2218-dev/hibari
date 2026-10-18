package httpx_test

import (
	"net/http"
	"testing"

	"github.com/oklog/ulid/v2"
)

// 本文に貼られたメッセージへのリンクのカード（ロードマップ Phase 6.11a / ADR 0040）。

type linkBody struct {
	RoomID    string `json:"room_id"`
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	Workspace *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"workspace"`
	Room *struct {
		ID     string `json:"id"`
		Kind   string `json:"kind"`
		Name   string `json:"name"`
		DMPeer *struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"dm_peer"`
	} `json:"room"`
	Message *struct {
		ID     string `json:"id"`
		Seq    int64  `json:"seq"`
		Body   string `json:"body"`
		Sender struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"sender"`
		ThreadRootID    *string `json:"thread_root_id"`
		AttachmentCount int     `json:"attachment_count"`
		DeletedAt       *string `json:"deleted_at"`
	} `json:"message"`
}

type linksBody struct {
	Links []linkBody `json:"links"`
}

func linkRef(roomID, messageID string) map[string]string {
	return map[string]string{"room_id": roomID, "message_id": messageID}
}

// ロードマップ Phase 6.11a の DoD: 読めないルームのメッセージのリンクは中身を返さない。
func TestMessageLinkFlow(t *testing.T) {
	c := newAPI(t)
	owner, alice, stranger := c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)

	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	public := decode[roomBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "private", "name": "役員室"})
	expectStatus(t, r, http.StatusCreated)
	private := decode[roomBody](t, r)

	r = c.as(owner, http.MethodPost, "/api/v1/rooms/"+public.ID+"/messages",
		map[string]any{"client_msg_id": ulid.Make().String(), "body": "ここを見てほしい"})
	expectStatus(t, r, http.StatusCreated)
	pub := decode[messageBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/rooms/"+private.ID+"/messages",
		map[string]any{"client_msg_id": ulid.Make().String(), "body": "役員だけの話"})
	expectStatus(t, r, http.StatusCreated)
	priv := decode[messageBody](t, r)

	// alice は public を読めるが、private には入っていない。
	r = c.as(alice, http.MethodPost, "/api/v1/messages/links", map[string]any{"links": []any{
		linkRef(public.ID, pub.ID),
		linkRef(private.ID, priv.ID),
		linkRef(public.ID, ulid.Make().String()),
		linkRef("not-a-ulid", "not-a-ulid-either"),
	}})
	expectStatus(t, r, http.StatusOK)
	got := decode[linksBody](t, r)
	if len(got.Links) != 4 {
		t.Fatalf("links = %d, want 4（リクエストと同じ件数）", len(got.Links))
	}

	ok := got.Links[0]
	if ok.Status != "ok" || ok.Message == nil || ok.Room == nil || ok.Workspace == nil {
		t.Fatalf("public のリンク = %+v, want ok に中身つき", ok)
	}
	if ok.Message.Body != "ここを見てほしい" || ok.Message.Sender.ID != owner.id {
		t.Errorf("message = %+v, want 本文と送信者", ok.Message)
	}
	if ok.Room.Name != "雑談" || ok.Room.Kind != "public" || ok.Workspace.Name != "山と印刷" {
		t.Errorf("room / workspace = %+v / %+v", ok.Room, ok.Workspace)
	}
	if ok.Message.ThreadRootID != nil || ok.Message.AttachmentCount != 0 || ok.Message.DeletedAt != nil {
		t.Errorf("チャンネルの投稿 = %+v, want スレッド・添付・削除なし", ok.Message)
	}

	// 読めない・存在しない・ULID として読めない、のどれも同じ形で返る（ADR 0040）。
	for i, what := range []string{"読めない private", "存在しないメッセージ", "ULID ではない ID"} {
		l := got.Links[i+1]
		if l.Status != "unavailable" || l.Workspace != nil || l.Room != nil || l.Message != nil {
			t.Errorf("%s = %+v, want unavailable で中身なし", what, l)
		}
	}
	// ID は送った文字列のまま返る（クライアントが自分の送った値で引き当てられるように）。
	if got.Links[3].RoomID != "not-a-ulid" || got.Links[3].MessageID != "not-a-ulid-either" {
		t.Errorf("読めない ID の返り = %+v, want 送った文字列のまま", got.Links[3])
	}

	// ワークスペースの外の人には、public のリンクも見えない。
	r = c.as(stranger, http.MethodPost, "/api/v1/messages/links", map[string]any{"links": []any{linkRef(public.ID, pub.ID)}})
	expectStatus(t, r, http.StatusOK)
	if l := decode[linksBody](t, r).Links[0]; l.Status != "unavailable" || l.Message != nil {
		t.Errorf("外の人から見た public = %+v, want unavailable", l)
	}

	// 認証が要る。
	expectStatus(t, c.do(request{method: http.MethodPost, path: "/api/v1/messages/links",
		body: map[string]any{"links": []any{linkRef(public.ID, pub.ID)}}}), http.StatusUnauthorized)

	// 上限を超えたら 422。
	many := make([]any, 21)
	for i := range many {
		many[i] = linkRef(public.ID, pub.ID)
	}
	r = c.as(alice, http.MethodPost, "/api/v1/messages/links", map[string]any{"links": many})
	expectStatus(t, r, http.StatusUnprocessableEntity)
}

// TestMessageLinkDeletedAndThread は、削除済みとスレッドの返信のリンクの返り方を確かめる。
func TestMessageLinkDeletedAndThread(t *testing.T) {
	c := newAPI(t)
	owner := c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	messages := "/api/v1/rooms/" + room.ID + "/messages"

	r = c.as(owner, http.MethodPost, messages, map[string]any{"client_msg_id": ulid.Make().String(), "body": "親"})
	expectStatus(t, r, http.StatusCreated)
	root := decode[messageBody](t, r)
	r = c.as(owner, http.MethodPost, messages,
		map[string]any{"client_msg_id": ulid.Make().String(), "body": "返信", "thread_root_id": root.ID})
	expectStatus(t, r, http.StatusCreated)
	reply := decode[messageBody](t, r)
	r = c.as(owner, http.MethodPost, messages, map[string]any{"client_msg_id": ulid.Make().String(), "body": "消す"})
	expectStatus(t, r, http.StatusCreated)
	gone := decode[messageBody](t, r)
	expectStatus(t, c.as(owner, http.MethodDelete, messages+"/"+gone.ID, nil), http.StatusNoContent)

	r = c.as(owner, http.MethodPost, "/api/v1/messages/links", map[string]any{"links": []any{
		linkRef(room.ID, reply.ID),
		linkRef(room.ID, gone.ID),
	}})
	expectStatus(t, r, http.StatusOK)
	got := decode[linksBody](t, r)

	// スレッドの返信は親の ID を返す。カードを押したときに開くパネルを決めるのに使う。
	if l := got.Links[0]; l.Status != "ok" || l.Message == nil || l.Message.ThreadRootID == nil || *l.Message.ThreadRootID != root.ID {
		t.Errorf("返信のリンク = %+v, want thread_root_id = %s", l.Message, root.ID)
	}
	// 削除済みは tombstone（本文は空、deleted_at が入る）。表示の判断はクライアント（ADR 0038 / 0040）。
	l := got.Links[1]
	if l.Status != "ok" || l.Message == nil {
		t.Fatalf("削除済みのリンク = %+v, want ok の tombstone", l)
	}
	if l.Message.DeletedAt == nil || l.Message.Body != "" {
		t.Errorf("削除済み = %+v, want 本文が空で deleted_at が入る", l.Message)
	}
}
