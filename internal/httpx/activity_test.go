package httpx_test

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/oklog/ulid/v2"
)

// アクティビティの API（ロードマップ Phase 6.14.5 / ADR 0058 決定 6）。

type activityListBody struct {
	Items []struct {
		ID      string   `json:"id"`
		Type    string   `json:"type"`
		Reasons []string `json:"reasons"`
		Unread  bool     `json:"unread"`
		Room    struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"room"`
		Message struct {
			ID   string `json:"id"`
			Body string `json:"body"`
		} `json:"message"`
		Reaction *struct {
			Emoji string `json:"emoji"`
			User  struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"reaction"`
	} `json:"items"`
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
}

func TestActivityAPI(t *testing.T) {
	c := newAPI(t)
	owner, alice := c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)

	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	expectStatus(t, c.as(alice, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)
	post := func(user apiUser, body string) string {
		t.Helper()
		r := c.as(user, http.MethodPost, "/api/v1/rooms/"+room.ID+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": body})
		expectStatus(t, r, http.StatusCreated)
		return decode[messageWithPinBody](t, r).ID
	}
	listPath := "/api/v1/workspaces/" + ws.ID + "/activity"

	// 自分が送ると自分の既読位置が進むので、alice の投稿を先にする（後のメンションを未読のまま残す）
	mine := post(alice, "リアクションしてください")
	expectStatus(t, c.as(owner, http.MethodPut, "/api/v1/rooms/"+room.ID+"/messages/"+mine+"/reactions/"+url.PathEscape("🎉"), nil), http.StatusOK)
	first := post(owner, "<!channel> 1 件目")
	second := post(owner, "<!channel> 2 件目")

	t.Run("メンションとリアクションが 1 件ずつ、新しい順に並ぶ", func(t *testing.T) {
		r := c.as(alice, http.MethodGet, listPath, nil)
		expectStatus(t, r, http.StatusOK)
		page := decode[activityListBody](t, r)
		if len(page.Items) != 3 || page.HasMore || page.NextCursor != nil {
			t.Fatalf("page = %s", r.body)
		}
		re, m2, m1 := page.Items[0], page.Items[1], page.Items[2]
		if re.Type != "reaction" || re.Message.ID != mine || re.Reaction == nil || re.Reaction.Emoji != "🎉" || re.Reaction.User.ID != owner.id || re.Unread {
			t.Errorf("reaction item = %+v", re)
		}
		if m2.Message.ID != second || m1.Message.ID != first || !m2.Unread || len(m2.Reasons) != 1 || m2.Reasons[0] != "mention" || m2.Room.Name != "雑談" {
			t.Errorf("message items = %+v / %+v", m2, m1)
		}
	})

	t.Run("next_cursor を before に渡すと続きが取れる", func(t *testing.T) {
		r := c.as(alice, http.MethodGet, listPath+"?limit=2", nil)
		expectStatus(t, r, http.StatusOK)
		page := decode[activityListBody](t, r)
		if len(page.Items) != 2 || !page.HasMore || page.NextCursor == nil {
			t.Fatalf("page = %s", r.body)
		}
		r = c.as(alice, http.MethodGet, listPath+"?limit=2&before="+url.QueryEscape(*page.NextCursor), nil)
		expectStatus(t, r, http.StatusOK)
		if rest := decode[activityListBody](t, r); len(rest.Items) != 1 || rest.Items[0].Message.ID != first || rest.HasMore {
			t.Errorf("rest = %s", r.body)
		}
	})

	t.Run("filter と unread で絞り、未読の件数も返す", func(t *testing.T) {
		r := c.as(alice, http.MethodGet, listPath+"?filter=reaction", nil)
		expectStatus(t, r, http.StatusOK)
		if page := decode[activityListBody](t, r); len(page.Items) != 1 || page.Items[0].Type != "reaction" {
			t.Errorf("reaction tab = %s", r.body)
		}
		r = c.as(alice, http.MethodGet, listPath+"?unread=true", nil)
		expectStatus(t, r, http.StatusOK)
		if page := decode[activityListBody](t, r); len(page.Items) != 2 {
			t.Errorf("unread only = %s", r.body)
		}
		r = c.as(alice, http.MethodGet, listPath+"/unread_count", nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[struct {
			Count int64 `json:"count"`
		}](t, r); got.Count != 2 {
			t.Errorf("unread_count = %s", r.body)
		}
	})

	t.Run("正しくない指定は 400 か 422", func(t *testing.T) {
		expectStatus(t, c.as(alice, http.MethodGet, listPath+"?unread=yes", nil), http.StatusBadRequest)
		expectStatus(t, c.as(alice, http.MethodGet, listPath+"?filter=everything", nil), http.StatusUnprocessableEntity)
		expectStatus(t, c.as(alice, http.MethodGet, listPath+"?before=%21", nil), http.StatusUnprocessableEntity)
	})

	t.Run("ワークスペースのメンバーでなければ 404", func(t *testing.T) {
		outsider := c.registerUser()
		expectStatus(t, c.as(outsider, http.MethodGet, listPath, nil), http.StatusNotFound)
		expectStatus(t, c.as(outsider, http.MethodGet, listPath+"/unread_count", nil), http.StatusNotFound)
	})
}
