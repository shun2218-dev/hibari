package httpx_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

// メッセージの検索の API（ロードマップ Phase 6.16 / ADR 0061 決定 8）。

type searchBody struct {
	Items []struct {
		ID     string `json:"id"`
		RoomID string `json:"room_id"`
		Seq    int64  `json:"seq"`
		Room   struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
			Name string `json:"name"`
		} `json:"room"`
		Sender struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"sender"`
		Body            string  `json:"body"`
		ThreadRootID    *string `json:"thread_root_id"`
		AttachmentCount int64   `json:"attachment_count"`
	} `json:"items"`
	NextCursor *string  `json:"next_cursor"`
	Terms      []string `json:"terms"`
}

func TestSearchAPI(t *testing.T) {
	c := newAPI(t)
	owner, alice := c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)

	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "private", "name": "採用"})
	expectStatus(t, r, http.StatusCreated)
	secret := decode[roomBody](t, r)

	post := func(roomID, body string) string {
		t.Helper()
		r := c.as(owner, http.MethodPost, "/api/v1/rooms/"+roomID+"/messages",
			map[string]string{"client_msg_id": ulid.Make().String(), "body": body})
		expectStatus(t, r, http.StatusCreated)
		return decode[messageWithPinBody](t, r).ID
	}
	open := post(room.ID, "明日の面談の資料を共有します")
	post(secret.ID, "採用の面談の日程")

	search := func(user apiUser, query string) response {
		t.Helper()
		return c.as(user, http.MethodGet, "/api/v1/workspaces/"+ws.ID+"/search/messages?"+query, nil)
	}

	t.Run("読めるルームのメッセージだけを新しい順に返す", func(t *testing.T) {
		r := search(owner, "q="+url.QueryEscape("面談"))
		expectStatus(t, r, http.StatusOK)
		page := decode[searchBody](t, r)
		if len(page.Items) != 2 {
			t.Fatalf("owner の結果 = %s, want 2 件", r.body)
		}

		// alice は private に入っていないので public の 1 件だけ
		r = search(alice, "q="+url.QueryEscape("面談"))
		expectStatus(t, r, http.StatusOK)
		page = decode[searchBody](t, r)
		if len(page.Items) != 1 || page.Items[0].ID != open {
			t.Fatalf("alice の結果 = %s, want public の 1 件だけ", r.body)
		}
		it := page.Items[0]
		if it.Room.Name != "雑談" || it.Sender.ID == "" || it.Body == "" || it.Seq == 0 {
			t.Errorf("item = %+v（ルーム・送信者・本文・seq が揃っていない）", it)
		}
	})

	t.Run("塗る語を返す（除外した語は入れない）", func(t *testing.T) {
		r := search(owner, "q="+url.QueryEscape(`面談 -採用`))
		expectStatus(t, r, http.StatusOK)
		page := decode[searchBody](t, r)
		if len(page.Terms) != 1 || page.Terms[0] != "面談" {
			t.Errorf("terms = %v, want [面談]", page.Terms)
		}
		if len(page.Items) != 1 || page.Items[0].ID != open {
			t.Errorf("items = %s, want 除外が効いて 1 件", r.body)
		}
	})

	t.Run("ルームと送信者で絞れる（ID で渡す。名前は受け取らない）", func(t *testing.T) {
		r := search(owner, "q="+url.QueryEscape("面談")+"&room_id="+secret.ID)
		expectStatus(t, r, http.StatusOK)
		if page := decode[searchBody](t, r); len(page.Items) != 1 || page.Items[0].RoomID != secret.ID {
			t.Errorf("room_id で絞った結果 = %s", r.body)
		}
		r = search(owner, "q="+url.QueryEscape("面談")+"&sender_id="+ulid.Make().String())
		expectStatus(t, r, http.StatusOK)
		if page := decode[searchBody](t, r); len(page.Items) != 0 {
			t.Errorf("知らない送信者で絞った結果 = %s, want 0 件", r.body)
		}
	})

	t.Run("カーソルで続きを読める", func(t *testing.T) {
		r := search(owner, "q="+url.QueryEscape("面談")+"&limit=1")
		expectStatus(t, r, http.StatusOK)
		first := decode[searchBody](t, r)
		if len(first.Items) != 1 || first.NextCursor == nil {
			t.Fatalf("1 ページ目 = %s, want 1 件と next_cursor", r.body)
		}
		r = search(owner, "q="+url.QueryEscape("面談")+"&limit=1&cursor="+url.QueryEscape(*first.NextCursor))
		expectStatus(t, r, http.StatusOK)
		second := decode[searchBody](t, r)
		if len(second.Items) != 1 || second.Items[0].ID == first.Items[0].ID {
			t.Fatalf("2 ページ目 = %s, want 別の 1 件", r.body)
		}
		if second.NextCursor != nil {
			t.Errorf("next_cursor = %v, want nil（もう続きがない）", *second.NextCursor)
		}
	})

	t.Run("総件数は返さない（ADR 0061 決定 4）", func(t *testing.T) {
		r := search(owner, "q="+url.QueryEscape("面談"))
		expectStatus(t, r, http.StatusOK)
		if strings.Contains(string(r.body), `"total`) || strings.Contains(string(r.body), `"count`) {
			t.Errorf("body に件数が入っている: %s", r.body)
		}
	})

	t.Run("入力が正しくなければ 422、形が違えば 400", func(t *testing.T) {
		for _, q := range []string{"q=", "q=" + url.QueryEscape("-面談"), "q=" + url.QueryEscape("面談") + "&limit=51"} {
			expectStatus(t, search(owner, q), http.StatusUnprocessableEntity)
		}
		for _, q := range []string{
			"q=" + url.QueryEscape("面談") + "&limit=abc",
			"q=" + url.QueryEscape("面談") + "&room_id=not-a-ulid",
			"q=" + url.QueryEscape("面談") + "&after=yesterday",
		} {
			expectStatus(t, search(owner, q), http.StatusBadRequest)
		}
	})

	t.Run("ワークスペースの外の人には 404", func(t *testing.T) {
		outsider := c.registerUser()
		expectStatus(t, search(outsider, "q="+url.QueryEscape("面談")), http.StatusNotFound)
	})
}
