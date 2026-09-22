package httpx_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/oklog/ulid/v2"
)

// 「後で」の API（ロードマップ Phase 6.12 / ADR 0054 決定 9）。

type savedItemBody struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	MessageID   string `json:"message_id"`
	State       string `json:"state"`
	ChangeSeq   int64  `json:"change_seq"`
	Status      string `json:"status"`
	Room        *struct {
		Name string `json:"name"`
	} `json:"room"`
	Message *struct {
		ID    string `json:"id"`
		Body  string `json:"body"`
		Saved *bool  `json:"saved"`
	} `json:"message"`
}

type savedListBody struct {
	Items           []savedItemBody `json:"items"`
	InProgressCount int64           `json:"in_progress_count"`
	LastChangeSeq   int64           `json:"last_change_seq"`
	HasMore         bool            `json:"has_more"`
}

func TestSavedFlow(t *testing.T) {
	c := newAPI(t)
	owner, alice := c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)

	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/rooms/"+room.ID+"/messages",
		map[string]string{"client_msg_id": ulid.Make().String(), "body": "あとで読む"})
	expectStatus(t, r, http.StatusCreated)
	msg := decode[messageWithPinBody](t, r)
	savePath := "/api/v1/rooms/" + room.ID + "/messages/" + msg.ID + "/saved"
	itemPath := "/api/v1/workspaces/" + ws.ID + "/saved/" + msg.ID
	listPath := "/api/v1/workspaces/" + ws.ID + "/saved"

	t.Run("参加していない public ルームのメッセージも PUT で保存でき、2 回目も 200", func(t *testing.T) {
		r := c.as(alice, http.MethodPut, savePath, nil)
		expectStatus(t, r, http.StatusOK)
		item := decode[savedItemBody](t, r)
		if item.State != "in_progress" || item.Status != "ok" || item.WorkspaceID != ws.ID || item.Room == nil || item.Room.Name != "雑談" ||
			item.Message == nil || item.Message.Saved == nil || !*item.Message.Saved {
			t.Fatalf("item = %s", r.body)
		}
		expectStatus(t, c.as(alice, http.MethodPut, savePath, nil), http.StatusOK)
	})

	t.Run("履歴のメッセージに、本人から見たときだけ saved が付く", func(t *testing.T) {
		for _, tc := range []struct {
			user apiUser
			want bool
		}{{alice, true}, {owner, false}} {
			r := c.as(tc.user, http.MethodGet, "/api/v1/rooms/"+room.ID+"/messages?around_message_id="+msg.ID, nil)
			expectStatus(t, r, http.StatusOK)
			page := decode[struct {
				Messages []struct {
					ID    string `json:"id"`
					Saved *bool  `json:"saved"`
				} `json:"messages"`
			}](t, r)
			for _, m := range page.Messages {
				if m.ID == msg.ID && (m.Saved == nil || *m.Saved != tc.want) {
					t.Errorf("saved = %v, want %v", m.Saved, tc.want)
				}
			}
		}
	})

	var cursor int64
	t.Run("一覧に件数と差分のカーソルが付く", func(t *testing.T) {
		r := c.as(alice, http.MethodGet, listPath, nil)
		expectStatus(t, r, http.StatusOK)
		list := decode[savedListBody](t, r)
		if len(list.Items) != 1 || list.InProgressCount != 1 || list.LastChangeSeq != 1 || list.HasMore {
			t.Errorf("list = %s", r.body)
		}
		cursor = list.LastChangeSeq
	})

	t.Run("PATCH でタブを動かす", func(t *testing.T) {
		r := c.as(alice, http.MethodPatch, itemPath, map[string]string{"state": "archived"})
		expectStatus(t, r, http.StatusOK)
		if item := decode[savedItemBody](t, r); item.State != "archived" {
			t.Errorf("state = %q", item.State)
		}
		p := expectProblem(t, c.as(alice, http.MethodPatch, itemPath, map[string]string{"state": "removed"}),
			http.StatusUnprocessableEntity, "validation-error")
		if len(p.Errors) != 1 || p.Errors[0].Field != "state" {
			t.Errorf("errors = %+v", p.Errors)
		}
	})

	t.Run("DELETE で外し、2 回目も 204。差分には外した行が出る", func(t *testing.T) {
		expectStatus(t, c.as(alice, http.MethodDelete, itemPath, nil), http.StatusNoContent)
		expectStatus(t, c.as(alice, http.MethodDelete, itemPath, nil), http.StatusNoContent)
		r := c.as(alice, http.MethodGet, listPath+"?after_change_seq="+strconv.FormatInt(cursor, 10), nil)
		expectStatus(t, r, http.StatusOK)
		diff := decode[savedListBody](t, r)
		if len(diff.Items) != 1 || diff.Items[0].State != "removed" || diff.LastChangeSeq != cursor+2 {
			t.Errorf("diff = %s", r.body)
		}
	})

	t.Run("タブと差分を一緒に指定すると 422、知らないタブも 422", func(t *testing.T) {
		expectProblem(t, c.as(alice, http.MethodGet, listPath+"?state=archived&after_change_seq=0", nil),
			http.StatusUnprocessableEntity, "validation-error")
		expectProblem(t, c.as(alice, http.MethodGet, listPath+"?state=removed", nil),
			http.StatusUnprocessableEntity, "validation-error")
	})

	t.Run("ワークスペースの外の人には見えない", func(t *testing.T) {
		stranger := c.registerUser()
		expectProblem(t, c.as(stranger, http.MethodGet, listPath, nil), http.StatusNotFound, "not-found")
		expectProblem(t, c.as(stranger, http.MethodPut, savePath, nil), http.StatusNotFound, "not-found")
	})
}
