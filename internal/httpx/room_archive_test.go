package httpx_test

import (
	"net/http"
	"testing"

	"github.com/oklog/ulid/v2"
)

// チャンネルのアーカイブと削除の API（ロードマップ Phase 6.15 / ADR 0059）。

type archivedRoomBody struct {
	ID         string  `json:"id"`
	IsDefault  bool    `json:"is_default"`
	ArchivedAt *string `json:"archived_at"`
}

func TestRoomArchiveFlow(t *testing.T) {
	c := newAPI(t)
	owner, alice, carol := c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	c.joinViaInvite(owner, ws.ID, carol)

	r = c.as(alice, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "旧案"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	roomPath := "/api/v1/rooms/" + room.ID

	t.Run("参加していない member はアーカイブできない", func(t *testing.T) {
		expectProblem(t, c.as(carol, http.MethodPost, roomPath+"/archive", nil), http.StatusForbidden, "forbidden")
	})

	t.Run("メンバーがアーカイブすると archived_at が入る", func(t *testing.T) {
		r := c.as(alice, http.MethodPost, roomPath+"/archive", nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[archivedRoomBody](t, r); got.ArchivedAt == nil {
			t.Fatalf("archived_at = null: %s", r.body)
		}
		// 一覧もアーカイブ済みを archived_at 付きで返す（サイドバーの検索で探すため）
		r = c.as(carol, http.MethodGet, "/api/v1/workspaces/"+ws.ID+"/rooms", nil)
		expectStatus(t, r, http.StatusOK)
		list := decode[struct {
			Rooms []archivedRoomBody `json:"rooms"`
		}](t, r)
		found := false
		for _, x := range list.Rooms {
			if x.ID == room.ID {
				found = x.ArchivedAt != nil
			}
		}
		if !found {
			t.Errorf("一覧にアーカイブ済みのルームが無い: %s", r.body)
		}
	})

	t.Run("アーカイブ中の投稿は 409 room-archived", func(t *testing.T) {
		r := c.as(alice, http.MethodPost, roomPath+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": "まだ話したい"})
		expectProblem(t, r, http.StatusConflict, "room-archived")
		expectProblem(t, c.as(alice, http.MethodPost, roomPath+"/archive", nil), http.StatusConflict, "room-archived")
	})

	t.Run("復元すると投稿できる。アーカイブされていなければ 409 room-not-archived", func(t *testing.T) {
		r := c.as(alice, http.MethodPost, roomPath+"/unarchive", nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[archivedRoomBody](t, r); got.ArchivedAt != nil {
			t.Fatalf("archived_at = %v, want null", *got.ArchivedAt)
		}
		expectProblem(t, c.as(alice, http.MethodPost, roomPath+"/unarchive", nil), http.StatusConflict, "room-not-archived")
		r = c.as(alice, http.MethodPost, roomPath+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": "戻りました"})
		expectStatus(t, r, http.StatusCreated)
	})

	t.Run("既定のルームは 422 room-protected", func(t *testing.T) {
		r := c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "全体"})
		expectStatus(t, r, http.StatusCreated)
		general := decode[roomBody](t, r)
		expectStatus(t, c.as(owner, http.MethodPatch, "/api/v1/rooms/"+general.ID, map[string]bool{"is_default": true}), http.StatusOK)
		expectProblem(t, c.as(owner, http.MethodPost, "/api/v1/rooms/"+general.ID+"/archive", nil), http.StatusUnprocessableEntity, "room-protected")
		expectProblem(t, c.as(owner, http.MethodDelete, "/api/v1/rooms/"+general.ID, nil), http.StatusUnprocessableEntity, "room-protected")
	})

	t.Run("削除は admin 以上だけ。消したら 204 で、以後は 404", func(t *testing.T) {
		expectProblem(t, c.as(alice, http.MethodDelete, roomPath, nil), http.StatusForbidden, "forbidden")
		r := c.as(owner, http.MethodDelete, roomPath, nil)
		expectStatus(t, r, http.StatusNoContent)
		expectProblem(t, c.as(alice, http.MethodGet, roomPath, nil), http.StatusNotFound, "not-found")
		expectProblem(t, c.as(owner, http.MethodDelete, roomPath, nil), http.StatusNotFound, "not-found")
	})
}
