package chat_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// 外部のリンクのプレビュー（ADR 0065）。
//
// 取りに行くのは chattest.Fetcher（URL から結果が決まり、ネットワークに出ない）。
// URL はテストごとに一意にする（取得の結果を 30 分使い回すので、ほかのテストと同じ URL だと結果を共有してしまう）。

// okURL は取れる URL（画像とアイコンつき）。
func okURL(env *chattest.Env) string {
	return fmt.Sprintf("https://%s.ok.test/post?image=1&icon=1", strings.ToLower(env.IDs.New().String()))
}

// failURL はカードにならない URL。
func failURL(env *chattest.Env) string {
	return fmt.Sprintf("https://%s.fail.test/post", strings.ToLower(env.IDs.New().String()))
}

// previewRoom は member・member2 が参加した public ルームを作る。
func previewRoom(t *testing.T, env *chattest.Env) (roles, chat.Room) {
	t.Helper()
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "previews")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	env.Deliveries.Take()
	return r, room
}

func process(t *testing.T, env *chattest.Env, roomID ulid.ULID) int {
	t.Helper()
	return env.Service.ProcessLinkPreviews(t.Context(), &roomID)
}

func TestLinkPreviewAfterSend(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	u := okURL(env)

	msg := send(t, env, r.member, room.ID, "これ見て "+u)

	t.Run("送信の時点ではまだ付いていない", func(t *testing.T) {
		if len(msg.LinkPreviews) != 0 {
			t.Errorf("link previews = %+v", msg.LinkPreviews)
		}
	})
	env.Deliveries.Take()

	if n := process(t, env, room.ID); n != 1 {
		t.Fatalf("processed = %d, want 1", n)
	}

	got := getMessage(t, env, r.member2, room.ID, msg.ID)
	t.Run("取れたら付く", func(t *testing.T) {
		if len(got.LinkPreviews) != 1 {
			t.Fatalf("link previews = %+v", got.LinkPreviews)
		}
		p := got.LinkPreviews[0]
		if p.URL != u || p.SiteName != "OK Test" || p.Title != "/post のタイトル" || p.Description != "/post の説明" || !p.HasIcon {
			t.Errorf("preview = %+v", p)
		}
		if p.Image == nil || p.Image.Width != chattest.PreviewImageWidth || p.Image.Height != chattest.PreviewImageHeight {
			t.Errorf("image = %+v", p.Image)
		}
	})
	t.Run("change_seq だけが進み、編集済みにはならない", func(t *testing.T) {
		if got.ChangeSeq <= msg.ChangeSeq || got.Seq != msg.Seq || got.UserSeq != msg.UserSeq || got.EditedAt != nil {
			t.Errorf("got change_seq=%d seq=%d user_seq=%d edited=%v, sent change_seq=%d", got.ChangeSeq, got.Seq, got.UserSeq, got.EditedAt, msg.ChangeSeq)
		}
	})
	t.Run("message.updated を配る", func(t *testing.T) {
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventMessageUpdated {
			t.Fatalf("events = %+v", evs)
		}
		m, ok := evs[0].Data.(chat.Message)
		if !ok || len(m.LinkPreviews) != 1 || m.ChangeSeq != got.ChangeSeq {
			t.Errorf("event data = %+v", evs[0].Data)
		}
	})
	t.Run("差分の同期（after_change_seq）でも揃う", func(t *testing.T) {
		after := msg.ChangeSeq
		page, err := env.Service.ListMessages(t.Context(), r.member2, room.ID, chat.MessageQuery{AfterChangeSeq: &after})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Messages) != 1 || len(page.Messages[0].LinkPreviews) != 1 {
			t.Errorf("changed = %+v", page.Messages)
		}
	})
	t.Run("画像とアイコンは自前のストレージに置いてあり、署名付き URL で読める", func(t *testing.T) {
		image, icon, err := env.Service.LinkPreviewURLs(t.Context(), r.member2, room.ID, msg.ID, got.LinkPreviews[0].ID)
		if err != nil {
			t.Fatal(err)
		}
		if image == nil || icon == nil || image.URL == "" || icon.URL == "" {
			t.Fatalf("image = %+v icon = %+v", image, icon)
		}
		if strings.Contains(image.URL, ".ok.test") {
			t.Error("相手のサイトの URL をそのまま返してはいけない")
		}
		if !image.ExpiresAt.Equal(env.Clock.Now().Add(5 * time.Minute)) {
			t.Errorf("expires_at = %v", image.ExpiresAt)
		}
	})
	t.Run("もう一度処理しても何もしない", func(t *testing.T) {
		if n := process(t, env, room.ID); n != 0 {
			t.Errorf("processed = %d", n)
		}
	})
}

func TestLinkPreviewFailure(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	u := failURL(env)
	msg := send(t, env, r.member, room.ID, u)
	env.Deliveries.Take()

	process(t, env, room.ID)
	got := getMessage(t, env, r.member, room.ID, msg.ID)
	if len(got.LinkPreviews) != 0 || got.ChangeSeq != msg.ChangeSeq {
		t.Errorf("previews = %+v change_seq = %d (sent %d)", got.LinkPreviews, got.ChangeSeq, msg.ChangeSeq)
	}
	// 見た目が変わらないので配らない
	if evs := env.Deliveries.Take(); len(evs) != 0 {
		t.Errorf("events = %+v", evs)
	}
	// 失敗も 30 分覚える（取り直さない。決定 2）
	send(t, env, r.member2, room.ID, u)
	process(t, env, room.ID)
	if n := env.Fetcher.Calls(u); n != 1 {
		t.Errorf("fetch calls = %d, want 1", n)
	}
}

func TestLinkPreviewReuse(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	u := okURL(env)
	send(t, env, r.member, room.ID, u)
	process(t, env, room.ID)

	t.Run("30 分以内の同じ URL は取り直さず、送信の時点で付く", func(t *testing.T) {
		env.Clock.Advance(29 * time.Minute)
		msg := send(t, env, r.member2, room.ID, "同じ記事 "+u)
		if len(msg.LinkPreviews) != 1 {
			t.Errorf("link previews = %+v", msg.LinkPreviews)
		}
		if n := env.Fetcher.Calls(u); n != 1 {
			t.Errorf("fetch calls = %d, want 1", n)
		}
	})
	t.Run("30 分を過ぎたら取り直す", func(t *testing.T) {
		env.Clock.Advance(2 * time.Minute)
		msg := send(t, env, r.member2, room.ID, "もう一度 "+u)
		if len(msg.LinkPreviews) != 0 {
			t.Errorf("link previews = %+v", msg.LinkPreviews)
		}
		process(t, env, room.ID)
		if n := env.Fetcher.Calls(u); n != 2 {
			t.Errorf("fetch calls = %d, want 2", n)
		}
		if got := getMessage(t, env, r.member, room.ID, msg.ID); len(got.LinkPreviews) != 1 {
			t.Errorf("link previews = %+v", got.LinkPreviews)
		}
	})
}

func TestLinkPreviewCandidates(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)

	tests := []struct {
		name string
		body func() string
		want int
	}{
		{"URL ごとに並ぶ", func() string { return okURL(env) + " と " + okURL(env) }, 2},
		{"同じ URL は 1 枚", func() string { u := okURL(env); return u + " " + u }, 1},
		{"コードの中の URL は展開しない", func() string { return "`" + okURL(env) + "`" }, 0},
		{"自分のアプリの URL は展開しない", func() string { return chattest.AppBaseURL.String() + "/w/x/r/y?m=z" }, 0},
		{"6 つ以上あればどれも展開しない", func() string {
			var us []string
			for range 6 {
				us = append(us, okURL(env))
			}
			return strings.Join(us, " ")
		}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg := send(t, env, r.member, room.ID, tt.body())
			process(t, env, room.ID)
			if got := getMessage(t, env, r.member, room.ID, msg.ID); len(got.LinkPreviews) != tt.want {
				t.Errorf("link previews = %d, want %d", len(got.LinkPreviews), tt.want)
			}
		})
	}

	t.Run("並びは本文に出てきた順", func(t *testing.T) {
		a, b := okURL(env), okURL(env)
		msg := send(t, env, r.member, room.ID, b+" "+a)
		process(t, env, room.ID)
		got := getMessage(t, env, r.member, room.ID, msg.ID)
		if len(got.LinkPreviews) != 2 || got.LinkPreviews[0].URL != b || got.LinkPreviews[1].URL != a {
			t.Errorf("link previews = %+v", got.LinkPreviews)
		}
	})
}

func TestRemoveLinkPreview(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	msg := send(t, env, r.member, room.ID, okURL(env))
	process(t, env, room.ID)
	before := getMessage(t, env, r.member, room.ID, msg.ID)
	previewID := before.LinkPreviews[0].ID
	env.Deliveries.Take()

	t.Run("本人以外は消せない", func(t *testing.T) {
		for _, actor := range []ulid.ULID{r.member2, r.admin, r.owner} {
			if err := env.Service.RemoveLinkPreview(t.Context(), actor, room.ID, msg.ID, previewID); !errors.Is(err, chat.ErrForbidden) {
				t.Errorf("RemoveLinkPreview by %s = %v, want ErrForbidden", actor, err)
			}
		}
	})
	t.Run("本人は消せて、全員に配る", func(t *testing.T) {
		if err := env.Service.RemoveLinkPreview(t.Context(), r.member, room.ID, msg.ID, previewID); err != nil {
			t.Fatal(err)
		}
		got := getMessage(t, env, r.member2, room.ID, msg.ID)
		if len(got.LinkPreviews) != 0 || got.ChangeSeq <= before.ChangeSeq {
			t.Errorf("previews = %+v change_seq = %d", got.LinkPreviews, got.ChangeSeq)
		}
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventMessageUpdated {
			t.Errorf("events = %+v", evs)
		}
	})
	t.Run("もう一度消しても成功し、配らない", func(t *testing.T) {
		if err := env.Service.RemoveLinkPreview(t.Context(), r.member, room.ID, msg.ID, previewID); err != nil {
			t.Fatal(err)
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v", evs)
		}
	})
	t.Run("消したカードの画像の URL は取れない", func(t *testing.T) {
		if _, _, err := env.Service.LinkPreviewURLs(t.Context(), r.member, room.ID, msg.ID, previewID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
	t.Run("編集しても戻らない（URL を消して書き戻しても）", func(t *testing.T) {
		u := before.LinkPreviews[0].URL
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, "URL を消した"); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, "書き戻した "+u); err != nil {
			t.Fatal(err)
		}
		process(t, env, room.ID)
		if got := getMessage(t, env, r.member, room.ID, msg.ID); len(got.LinkPreviews) != 0 {
			t.Errorf("link previews = %+v", got.LinkPreviews)
		}
	})
	t.Run("存在しないプレビューは見つからない", func(t *testing.T) {
		if err := env.Service.RemoveLinkPreview(t.Context(), r.member, room.ID, msg.ID, env.IDs.New()); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
}

func TestRemoveLinkPreviewWhilePending(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	msg := send(t, env, r.member, room.ID, okURL(env))

	// 取得待ちの行の ID を読む（まだ誰にも見えていない）
	var previewID ulid.ULID
	if err := env.Pool.QueryRow(t.Context(), `SELECT id FROM message_link_previews WHERE message_id = $1`, msg.ID).Scan(&previewID); err != nil {
		t.Fatal(err)
	}
	env.Deliveries.Take()
	if err := env.Service.RemoveLinkPreview(t.Context(), r.member, room.ID, msg.ID, previewID); err != nil {
		t.Fatal(err)
	}
	// 見えていなかったので番号を使わず、配らない
	if evs := env.Deliveries.Take(); len(evs) != 0 {
		t.Errorf("events = %+v", evs)
	}
	// 消した行は取りに行かない
	if n := process(t, env, room.ID); n != 0 {
		t.Errorf("processed = %d", n)
	}
	if got := getMessage(t, env, r.member, room.ID, msg.ID); len(got.LinkPreviews) != 0 || got.ChangeSeq != msg.ChangeSeq {
		t.Errorf("previews = %+v change_seq = %d", got.LinkPreviews, got.ChangeSeq)
	}
}

func TestLinkPreviewSuppressedInComposer(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	kept, suppressed := okURL(env), okURL(env)

	msg, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{
		ClientMsgID: env.IDs.New(), Body: kept + " " + suppressed, SuppressedLinkPreviewURLs: []string{suppressed},
	})
	if err != nil {
		t.Fatal(err)
	}
	process(t, env, room.ID)
	if n := env.Fetcher.Calls(suppressed); n != 0 {
		t.Errorf("入力欄で消した URL を取りに行った（%d 回）", n)
	}
	got := getMessage(t, env, r.member, room.ID, msg.ID)
	if len(got.LinkPreviews) != 1 || got.LinkPreviews[0].URL != kept {
		t.Errorf("link previews = %+v", got.LinkPreviews)
	}
	// 編集しても戻らない（決定 4 が効く）
	if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, suppressed+" "+kept+" 編集"); err != nil {
		t.Fatal(err)
	}
	process(t, env, room.ID)
	got = getMessage(t, env, r.member, room.ID, msg.ID)
	if len(got.LinkPreviews) != 1 || got.LinkPreviews[0].URL != kept {
		t.Errorf("編集の後 link previews = %+v", got.LinkPreviews)
	}

	t.Run("6 件以上は受け付けない", func(t *testing.T) {
		_, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{
			ClientMsgID: env.IDs.New(), Body: "x", SuppressedLinkPreviewURLs: []string{"https://1", "https://2", "https://3", "https://4", "https://5", "https://6"},
		})
		var verr *chat.ValidationError
		if !errors.As(err, &verr) || verr.Fields[0].Field != "suppressed_link_preview_urls" {
			t.Errorf("err = %v", err)
		}
	})
}

func TestLinkPreviewEdit(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	a, b := okURL(env), okURL(env)
	msg := send(t, env, r.member, room.ID, a)
	process(t, env, room.ID)

	t.Run("増えた URL は取りに行き、残った URL は取り直さない", func(t *testing.T) {
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, b+" と "+a); err != nil {
			t.Fatal(err)
		}
		process(t, env, room.ID)
		got := getMessage(t, env, r.member, room.ID, msg.ID)
		if len(got.LinkPreviews) != 2 || got.LinkPreviews[0].URL != b || got.LinkPreviews[1].URL != a {
			t.Errorf("link previews = %+v", got.LinkPreviews)
		}
		if env.Fetcher.Calls(a) != 1 || env.Fetcher.Calls(b) != 1 {
			t.Errorf("fetch calls a=%d b=%d", env.Fetcher.Calls(a), env.Fetcher.Calls(b))
		}
	})
	t.Run("無くなった URL のカードは消える", func(t *testing.T) {
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, "a だけ "+a); err != nil {
			t.Fatal(err)
		}
		got := getMessage(t, env, r.member, room.ID, msg.ID)
		if len(got.LinkPreviews) != 1 || got.LinkPreviews[0].URL != a {
			t.Errorf("link previews = %+v", got.LinkPreviews)
		}
	})
	t.Run("取得の間に編集で URL が消えたら、結果を書かない", func(t *testing.T) {
		c := okURL(env)
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, a+" "+c); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, a); err != nil {
			t.Fatal(err)
		}
		env.Deliveries.Take()
		process(t, env, room.ID)
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v", evs)
		}
	})
}

func TestLinkPreviewDeletedMessage(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)

	t.Run("削除したら画像の URL も取れない", func(t *testing.T) {
		msg := send(t, env, r.member, room.ID, okURL(env))
		process(t, env, room.ID)
		previewID := getMessage(t, env, r.member, room.ID, msg.ID).LinkPreviews[0].ID
		if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
			t.Fatal(err)
		}
		if _, _, err := env.Service.LinkPreviewURLs(t.Context(), r.member, room.ID, msg.ID, previewID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
	t.Run("取得待ちのまま削除されたら、取りに行かない", func(t *testing.T) {
		msg := send(t, env, r.member, room.ID, okURL(env))
		if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
			t.Fatal(err)
		}
		if n := process(t, env, room.ID); n != 0 {
			t.Errorf("processed = %d", n)
		}
	})
}

func TestLinkPreviewThreadReply(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	root := send(t, env, r.member, room.ID, "親")
	reply, _, err := env.Service.SendMessage(t.Context(), r.member2, room.ID, chat.SendMessageInput{
		ClientMsgID: env.IDs.New(), Body: "返信 " + okURL(env), ThreadRootID: &root.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	process(t, env, room.ID)
	page, err := env.Service.ListThreadMessages(t.Context(), r.member, room.ID, root.ID, chat.ThreadQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range page.Replies {
		if m.ID == reply.ID && len(m.LinkPreviews) == 1 {
			return
		}
	}
	t.Errorf("replies = %+v", page.Replies)
}

func TestLinkPreviewURLsAuthz(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "open")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "secret")
	for _, room := range []chat.Room{public, private} {
		msg := send(t, env, r.member, room.ID, okURL(env))
		process(t, env, room.ID)
		previewID := getMessage(t, env, r.member, room.ID, msg.ID).LinkPreviews[0].ID

		// public は参加していなくても読める。private はメンバーだけ。ワークスペースの外は読めない
		wantOK := map[ulid.ULID]bool{r.member: true, r.member2: room.ID == public.ID, r.outsider: false}
		for actor, ok := range wantOK {
			_, _, err := env.Service.LinkPreviewURLs(t.Context(), actor, room.ID, msg.ID, previewID)
			if ok && err != nil || !ok && !errors.Is(err, chat.ErrNotFound) {
				t.Errorf("room %s actor %s: err = %v, want ok=%v", room.Kind, actor, err, ok)
			}
		}
	}
}

func TestPreviewLink(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)

	t.Run("取れたら署名付き URL つきで返し、送信でそのまま使う", func(t *testing.T) {
		u := okURL(env)
		p, err := env.Service.PreviewLink(t.Context(), r.member, room.ID, u)
		if err != nil {
			t.Fatal(err)
		}
		if p == nil || p.Title != "/post のタイトル" || p.Image == nil || p.Image.URL == "" || p.Icon == nil || p.Icon.URL == "" {
			t.Fatalf("preview = %+v", p)
		}
		msg := send(t, env, r.member, room.ID, u)
		if len(msg.LinkPreviews) != 1 {
			t.Errorf("送信の時点で付いていない: %+v", msg.LinkPreviews)
		}
		if n := env.Fetcher.Calls(u); n != 1 {
			t.Errorf("fetch calls = %d, want 1", n)
		}
	})
	t.Run("カードにならなければ nil", func(t *testing.T) {
		p, err := env.Service.PreviewLink(t.Context(), r.member, room.ID, failURL(env))
		if err != nil || p != nil {
			t.Errorf("preview = %+v err = %v", p, err)
		}
	})
	t.Run("自分のアプリの URL は nil（取りに行かない）", func(t *testing.T) {
		u := chattest.AppBaseURL.String() + "/w/a/r/b"
		p, err := env.Service.PreviewLink(t.Context(), r.member, room.ID, u)
		if err != nil || p != nil || env.Fetcher.Calls(u) != 0 {
			t.Errorf("preview = %+v err = %v calls = %d", p, err, env.Fetcher.Calls(u))
		}
	})
	t.Run("http でない URL は 422", func(t *testing.T) {
		for _, u := range []string{"javascript:alert(1)", "file:///etc/passwd", "not a url", "https://" + strings.Repeat("a", 2100) + ".ok.test/"} {
			var verr *chat.ValidationError
			if _, err := env.Service.PreviewLink(t.Context(), r.member, room.ID, u); !errors.As(err, &verr) {
				t.Errorf("PreviewLink(%.30q) err = %v", u, err)
			}
		}
	})
	t.Run("投稿できないルームでは使えない", func(t *testing.T) {
		// 参加していない public ルームは読めるが投稿できない
		if _, err := env.Service.PreviewLink(t.Context(), r.admin, room.ID, okURL(env)); !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("not joined: err = %v, want ErrForbidden", err)
		}
		if _, err := env.Service.PreviewLink(t.Context(), r.outsider, room.ID, okURL(env)); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("outsider: err = %v, want ErrNotFound", err)
		}
	})
	t.Run("1 人あたり 1 分に 30 回まで", func(t *testing.T) {
		// 回数は時計の分で区切る。ほかのサブテストの回数が残らないよう、次の窓に進める
		env.Clock.Advance(time.Minute)
		for i := range 30 {
			if _, err := env.Service.PreviewLink(t.Context(), r.member2, room.ID, failURL(env)); err != nil {
				t.Fatalf("%d 回目: %v", i+1, err)
			}
		}
		var rerr *chat.RateLimitedError
		if _, err := env.Service.PreviewLink(t.Context(), r.member2, room.ID, failURL(env)); !errors.As(err, &rerr) {
			t.Errorf("31 回目: err = %v, want RateLimitedError", err)
		}
		// ほかの人は数えない
		if _, err := env.Service.PreviewLink(t.Context(), r.member, room.ID, failURL(env)); err != nil {
			t.Errorf("別の人: %v", err)
		}
	})
}

func TestLinkPreviewArchivedRoom(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	msg := send(t, env, r.member, room.ID, okURL(env))
	process(t, env, room.ID)
	previewID := getMessage(t, env, r.member, room.ID, msg.ID).LinkPreviews[0].ID
	if _, err := env.Service.ArchiveRoom(t.Context(), r.member, room.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.RemoveLinkPreview(t.Context(), r.member, room.ID, msg.ID, previewID); !errors.Is(err, chat.ErrRoomArchived) {
		t.Errorf("err = %v, want ErrRoomArchived", err)
	}
}

// 取得の結果と本人の削除が同時に起きても、消したカードが付き直らない。
func TestLinkPreviewRemoveRacesWithCompletion(t *testing.T) {
	env := chattest.New(t)
	r, room := previewRoom(t, env)
	for range 20 {
		msg := send(t, env, r.member, room.ID, okURL(env))
		var previewID ulid.ULID
		if err := env.Pool.QueryRow(t.Context(), `SELECT id FROM message_link_previews WHERE message_id = $1`, msg.ID).Scan(&previewID); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Go(func() { process(t, env, room.ID) })
		wg.Go(func() {
			if err := env.Service.RemoveLinkPreview(t.Context(), r.member, room.ID, msg.ID, previewID); err != nil {
				t.Error(err)
			}
		})
		wg.Wait()
		if got := getMessage(t, env, r.member, room.ID, msg.ID); len(got.LinkPreviews) != 0 {
			t.Fatalf("消したのに付いている: %+v", got.LinkPreviews)
		}
	}
}

func TestCleanupLinkPreviews(t *testing.T) {
	// 掃除はテスト用 DB の「時計で見て古い」結果を全部消すので、ほかのテストより十分に過去から始める（添付の掃除のテストと同じ）
	env := chattest.New(t, chattest.WithClockStart(time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)))
	r, room := previewRoom(t, env)

	kept := send(t, env, r.member, room.ID, okURL(env))
	process(t, env, room.ID)
	// 入力欄で取っただけで送らなかった結果（どのメッセージからも指されない）
	orphan := okURL(env)
	if _, err := env.Service.PreviewLink(t.Context(), r.member, room.ID, orphan); err != nil {
		t.Fatal(err)
	}
	var orphanKeys []string
	if err := env.Pool.QueryRow(t.Context(), `SELECT array[image_object_key, icon_object_key] FROM link_previews WHERE url = $1`, orphan).Scan(&orphanKeys); err != nil {
		t.Fatal(err)
	}

	env.Clock.Advance(3 * time.Hour)
	if _, err := env.Service.CleanupLinkPreviews(t.Context()); err != nil {
		t.Fatal(err)
	}

	var n int
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM link_previews WHERE url = $1`, orphan).Scan(&n); err != nil || n != 0 {
		t.Errorf("orphan rows = %d, err = %v", n, err)
	}
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM storage_deletions WHERE object_key = ANY($1)`, orphanKeys).Scan(&n); err != nil || n != 2 {
		t.Errorf("enqueued keys = %d, err = %v", n, err)
	}
	// メッセージから指されている結果は残る
	if got := getMessage(t, env, r.member, room.ID, kept.ID); len(got.LinkPreviews) != 1 {
		t.Errorf("kept previews = %+v", got.LinkPreviews)
	}
}

func TestRunLinkPreviewsStops(t *testing.T) {
	env := chattest.New(t)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		env.Service.RunLinkPreviews(ctx, time.Hour)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RunLinkPreviews did not stop after cancel")
	}
}
