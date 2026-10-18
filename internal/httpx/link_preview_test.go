package httpx_test

import (
	"encoding/json/v2"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

// 外部のリンクのプレビューの API（ADR 0065）。

type linkPreviewBody struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	SiteName    string `json:"site_name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       *struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"image"`
	HasIcon bool `json:"has_icon"`
}

type messageWithPreviewsBody struct {
	ID           string            `json:"id"`
	ChangeSeq    int64             `json:"change_seq"`
	LinkPreviews []linkPreviewBody `json:"link_previews"`
}

type signedURLBody struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"`
}

// previewURL は取れる URL（chattest.Fetcher が画像とアイコンつきで返す）。実行ごとに一意にする。
func previewURL() string {
	return fmt.Sprintf("https://%s.ok.test/post?image=1&icon=1", strings.ToLower(ulid.Make().String()))
}

func TestLinkPreviewAPI(t *testing.T) {
	c := newAPI(t)
	owner, alice, bob := c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "プレビュー"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	c.joinViaInvite(owner, ws.ID, bob)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "記事"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	for _, u := range []apiUser{alice, bob} {
		expectStatus(t, c.as(u, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)
	}
	roomID, err := ulid.ParseStrict(room.ID)
	if err != nil {
		t.Fatal(err)
	}

	u := previewURL()
	r = c.as(alice, http.MethodPost, "/api/v1/rooms/"+room.ID+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": "読んで " + u})
	expectStatus(t, r, http.StatusCreated)
	msg := decode[messageWithPreviewsBody](t, r)
	t.Run("送信の直後は空配列（null にしない）", func(t *testing.T) {
		if msg.LinkPreviews == nil || len(msg.LinkPreviews) != 0 {
			t.Errorf("link_previews = %s", r.body)
		}
	})

	c.chat.ProcessLinkPreviews(t.Context(), &roomID)
	var preview linkPreviewBody
	t.Run("取れたら一覧に載る", func(t *testing.T) {
		r := c.as(bob, http.MethodGet, "/api/v1/rooms/"+room.ID+"/messages", nil)
		expectStatus(t, r, http.StatusOK)
		page := decode[struct {
			Messages []messageWithPreviewsBody `json:"messages"`
		}](t, r)
		for _, m := range page.Messages {
			if m.ID == msg.ID && len(m.LinkPreviews) == 1 {
				preview = m.LinkPreviews[0]
			}
		}
		if preview.URL != u || preview.SiteName != "OK Test" || preview.Image == nil || preview.Image.Width == 0 || !preview.HasIcon {
			t.Fatalf("preview = %+v (%s)", preview, r.body)
		}
	})

	base := "/api/v1/rooms/" + room.ID + "/messages/" + msg.ID + "/link-previews/" + preview.ID
	t.Run("画像とアイコンの署名付き URL", func(t *testing.T) {
		r := c.as(bob, http.MethodGet, base+"/urls", nil)
		expectStatus(t, r, http.StatusOK)
		urls := decode[struct {
			Image *signedURLBody `json:"image"`
			Icon  *signedURLBody `json:"icon"`
		}](t, r)
		if urls.Image == nil || urls.Icon == nil || urls.Image.URL == "" || urls.Image.ExpiresAt == "" {
			t.Errorf("urls = %s", r.body)
		}
	})
	t.Run("本人以外は消せない", func(t *testing.T) {
		expectStatus(t, c.as(bob, http.MethodDelete, base, nil), http.StatusForbidden)
	})
	t.Run("本人は消せて 204、何度でも 204", func(t *testing.T) {
		expectStatus(t, c.as(alice, http.MethodDelete, base, nil), http.StatusNoContent)
		expectStatus(t, c.as(alice, http.MethodDelete, base, nil), http.StatusNoContent)
		expectStatus(t, c.as(bob, http.MethodGet, base+"/urls", nil), http.StatusNotFound)
	})
	t.Run("ID が読めなければ 404", func(t *testing.T) {
		expectStatus(t, c.as(alice, http.MethodDelete, "/api/v1/rooms/"+room.ID+"/messages/"+msg.ID+"/link-previews/nope", nil), http.StatusNotFound)
	})
}

func TestPreviewLinkAPI(t *testing.T) {
	c := newAPI(t)
	owner, alice := c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "入力欄"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "下書き"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	path := "/api/v1/rooms/" + room.ID + "/link-previews"

	type previewResp struct {
		Preview *struct {
			URL      string `json:"url"`
			SiteName string `json:"site_name"`
			Title    string `json:"title"`
			Image    *struct {
				Width  int    `json:"width"`
				Height int    `json:"height"`
				URL    string `json:"url"`
			} `json:"image"`
			Icon *signedURLBody `json:"icon"`
		} `json:"preview"`
	}

	t.Run("取れたらカードを返す", func(t *testing.T) {
		u := previewURL()
		r := c.as(owner, http.MethodPost, path, map[string]string{"url": u})
		expectStatus(t, r, http.StatusOK)
		p := decode[previewResp](t, r).Preview
		if p == nil || p.URL != u || p.Image == nil || p.Image.URL == "" || p.Icon == nil {
			t.Fatalf("body = %s", r.body)
		}
		// 入力欄で消した URL は、送ってもカードにならない
		r = c.as(owner, http.MethodPost, "/api/v1/rooms/"+room.ID+"/messages", map[string]any{
			"client_msg_id": ulid.Make().String(), "body": u, "suppressed_link_preview_urls": []string{u},
		})
		expectStatus(t, r, http.StatusCreated)
		if m := decode[messageWithPreviewsBody](t, r); len(m.LinkPreviews) != 0 {
			t.Errorf("link_previews = %s", r.body)
		}
	})
	t.Run("取れたカードは、送った時点で付いている", func(t *testing.T) {
		u := previewURL()
		expectStatus(t, c.as(owner, http.MethodPost, path, map[string]string{"url": u}), http.StatusOK)
		r := c.as(owner, http.MethodPost, "/api/v1/rooms/"+room.ID+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": u})
		expectStatus(t, r, http.StatusCreated)
		if m := decode[messageWithPreviewsBody](t, r); len(m.LinkPreviews) != 1 {
			t.Errorf("link_previews = %s", r.body)
		}
	})
	t.Run("カードにならなければ preview が null", func(t *testing.T) {
		r := c.as(owner, http.MethodPost, path, map[string]string{"url": "https://" + strings.ToLower(ulid.Make().String()) + ".fail.test/"})
		expectStatus(t, r, http.StatusOK)
		if string(r.body) != `{"preview":null}` {
			t.Errorf("body = %s", r.body)
		}
	})
	t.Run("http でない URL は 422", func(t *testing.T) {
		expectStatus(t, c.as(owner, http.MethodPost, path, map[string]string{"url": "file:///etc/passwd"}), http.StatusUnprocessableEntity)
	})
	t.Run("投稿できないルーム（参加していない public）では 403", func(t *testing.T) {
		expectStatus(t, c.as(alice, http.MethodPost, path, map[string]string{"url": previewURL()}), http.StatusForbidden)
	})
	t.Run("回数の上限を超えたら 429 と Retry-After", func(t *testing.T) {
		expectStatus(t, c.as(alice, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)
		var last response
		for range 31 {
			last = c.as(alice, http.MethodPost, path, map[string]string{"url": "https://" + strings.ToLower(ulid.Make().String()) + ".fail.test/"})
		}
		expectStatus(t, last, http.StatusTooManyRequests)
		if last.header.Get("Retry-After") == "" {
			t.Error("Retry-After がない")
		}
	})
}

// 取得の結果と本人の削除は、専用のイベントではなく message.updated で届く（ADR 0065 決定 1・5）。
// 2 台目のインスタンスの接続にも Redis Pub/Sub 経由で届く（ADR 0016）。
func TestWSDeliversLinkPreviews(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	other := c.newInstance()
	bob := other.dialWS(f.bob)
	bob.subscribe("room_id", f.public.ID)
	roomID, err := ulid.ParseStrict(f.public.ID)
	if err != nil {
		t.Fatal(err)
	}

	msg := decode[messageWithPreviewsBody](t, c.sendMessage(f.alice, f.public.ID, "読んで "+previewURL()))
	bob.sync()

	c.chat.ProcessLinkPreviews(t.Context(), &roomID)
	events := eventsOfType(bob.sync(), "message.updated")
	if len(events) != 1 {
		t.Fatalf("message.updated = %d 件, want 1", len(events))
	}
	var got messageWithPreviewsBody
	if err := json.Unmarshal(events[0].Data, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.LinkPreviews) != 1 || got.ChangeSeq <= msg.ChangeSeq {
		t.Fatalf("配信された link_previews = %s", events[0].Data)
	}

	path := "/api/v1/rooms/" + f.public.ID + "/messages/" + msg.ID + "/link-previews/" + got.LinkPreviews[0].ID
	expectStatus(t, c.as(f.alice, http.MethodDelete, path, nil), http.StatusNoContent)
	events = eventsOfType(bob.sync(), "message.updated")
	if len(events) != 1 {
		t.Fatalf("消した後の message.updated = %d 件, want 1", len(events))
	}
	var after messageWithPreviewsBody
	if err := json.Unmarshal(events[0].Data, &after); err != nil {
		t.Fatal(err)
	}
	if len(after.LinkPreviews) != 0 || after.ChangeSeq <= got.ChangeSeq {
		t.Errorf("消した後の link_previews = %s", events[0].Data)
	}
}
