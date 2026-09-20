package httpx_test

import (
	"net/http"
	"net/url"
	"slices"
	"testing"

	"github.com/oklog/ulid/v2"
)

// 絵文字のリアクションの API（ロードマップ Phase 6.7 / ADR 0044）。

type reactionBody struct {
	Emoji string   `json:"emoji"`
	Count int64    `json:"count"`
	Me    *bool    `json:"me"`
	Users []string `json:"users"`
}

type messageWithReactionsBody struct {
	ID        string         `json:"id"`
	ChangeSeq int64          `json:"change_seq"`
	Seq       int64          `json:"seq"`
	EditedAt  *string        `json:"edited_at"`
	Reactions []reactionBody `json:"reactions"`
}

// reactionPath は絵文字をパーセントエンコードして PUT / DELETE のパスを組み立てる（ADR 0044 決定 4）。
func reactionPath(roomID, messageID, emoji string) string {
	return "/api/v1/rooms/" + roomID + "/messages/" + messageID + "/reactions/" + url.PathEscape(emoji)
}

func reactionOf(m messageWithReactionsBody, emoji string) (reactionBody, bool) {
	i := slices.IndexFunc(m.Reactions, func(r reactionBody) bool { return r.Emoji == emoji })
	if i < 0 {
		return reactionBody{}, false
	}
	return m.Reactions[i], true
}

// ロードマップ Phase 6.7 の DoD のうち、REST で確かめられるもの。
func TestReactionFlow(t *testing.T) {
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
		map[string]string{"client_msg_id": ulid.Make().String(), "body": "これどうでしょう"})
	expectStatus(t, r, http.StatusCreated)
	msg := decode[messageWithReactionsBody](t, r)
	if msg.Reactions == nil || len(msg.Reactions) != 0 {
		t.Fatalf("送信直後の reactions = %v, want 空配列（null にしない）", msg.Reactions)
	}
	path := reactionPath(room.ID, msg.ID, "👍")

	var afterPut messageWithReactionsBody
	t.Run("PUT で付く", func(t *testing.T) {
		r := c.as(bob, http.MethodPut, path, nil)
		expectStatus(t, r, http.StatusOK)
		afterPut = decode[messageWithReactionsBody](t, r)
		re, ok := reactionOf(afterPut, "👍")
		if !ok || re.Count != 1 || re.Me == nil || !*re.Me || !slices.Equal(re.Users, []string{bob.id}) {
			t.Fatalf("reactions = %s", r.body)
		}
		// change_seq だけが進み、順序（seq）と「（編集済み）」は動かない（ADR 0044 決定 2）
		if afterPut.ChangeSeq <= msg.ChangeSeq || afterPut.Seq != msg.Seq || afterPut.EditedAt != nil {
			t.Errorf("change_seq, seq, edited_at = %d, %d, %v", afterPut.ChangeSeq, afterPut.Seq, afterPut.EditedAt)
		}
	})

	t.Run("同じ PUT をもう一度でも 200 で、数は増えない", func(t *testing.T) {
		r := c.as(bob, http.MethodPut, path, nil)
		expectStatus(t, r, http.StatusOK)
		again := decode[messageWithReactionsBody](t, r)
		re, _ := reactionOf(again, "👍")
		if re.Count != 1 || again.ChangeSeq != afterPut.ChangeSeq {
			t.Errorf("count, change_seq = %d, %d; want 1, %d", re.Count, again.ChangeSeq, afterPut.ChangeSeq)
		}
	})

	t.Run("他の人から見ると me が false", func(t *testing.T) {
		r := c.as(alice, http.MethodGet, "/api/v1/rooms/"+room.ID+"/messages", nil)
		expectStatus(t, r, http.StatusOK)
		list := decode[struct {
			Messages []messageWithReactionsBody `json:"messages"`
		}](t, r)
		i := slices.IndexFunc(list.Messages, func(m messageWithReactionsBody) bool { return m.ID == msg.ID })
		if i < 0 {
			t.Fatalf("メッセージが一覧に無い: %s", r.body)
		}
		re, _ := reactionOf(list.Messages[i], "👍")
		if re.Count != 1 || re.Me == nil || *re.Me {
			t.Errorf("alice から見た reaction = %+v, want count 1 / me false", re)
		}
	})

	t.Run("DELETE で外れる。付いていなくても 200", func(t *testing.T) {
		r := c.as(bob, http.MethodDelete, path, nil)
		expectStatus(t, r, http.StatusOK)
		if _, ok := reactionOf(decode[messageWithReactionsBody](t, r), "👍"); ok {
			t.Errorf("外した後の reactions = %s", r.body)
		}
		expectStatus(t, c.as(bob, http.MethodDelete, path, nil), http.StatusOK)
	})

	t.Run("絵文字でない値は 422", func(t *testing.T) {
		p := expectProblem(t, c.as(bob, http.MethodPut, reactionPath(room.ID, msg.ID, ":+1:"), nil),
			http.StatusUnprocessableEntity, "validation-error")
		if len(p.Errors) != 1 || p.Errors[0].Field != "emoji" || p.Errors[0].Reason != "invalid_value" {
			t.Errorf("errors = %+v, want emoji: invalid_value", p.Errors)
		}
	})

	t.Run("参加していない public ルームからは付けられない", func(t *testing.T) {
		// public ルームは参加しなくても読めるが、投稿はできないので付けられない（ADR 0044 決定 6）
		expectStatus(t, c.as(carol, http.MethodGet, "/api/v1/rooms/"+room.ID+"/messages", nil), http.StatusOK)
		expectProblem(t, c.as(carol, http.MethodPut, path, nil), http.StatusForbidden, "forbidden")
	})

	t.Run("ワークスペースの外の人には見えない", func(t *testing.T) {
		expectProblem(t, c.as(c.registerUser(), http.MethodPut, path, nil), http.StatusNotFound, "not-found")
	})

	t.Run("削除済みのメッセージは、存在しないのと区別しない", func(t *testing.T) {
		r := c.as(alice, http.MethodPost, "/api/v1/rooms/"+room.ID+"/messages",
			map[string]string{"client_msg_id": ulid.Make().String(), "body": "消す"})
		expectStatus(t, r, http.StatusCreated)
		gone := decode[messageWithReactionsBody](t, r)
		expectStatus(t, c.as(alice, http.MethodDelete, "/api/v1/rooms/"+room.ID+"/messages/"+gone.ID, nil), http.StatusNoContent)

		expectProblem(t, c.as(bob, http.MethodPut, reactionPath(room.ID, gone.ID, "👍"), nil), http.StatusNotFound, "not-found")
		expectProblem(t, c.as(bob, http.MethodPut, reactionPath(room.ID, ulid.Make().String(), "👍"), nil), http.StatusNotFound, "not-found")
	})
}
