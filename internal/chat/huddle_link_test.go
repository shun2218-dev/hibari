package chat_test

import (
	"errors"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// 本文に貼られたハドルのリンク（ADR 0067 決定 2）と、ハドルのメッセージを「後で」に保存する例外（決定 6）。

func TestResolveHuddleLinks(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	me := r.member

	live := createRoom(t, env, r.admin, r.ws.ID, "public", "live")
	if _, err := env.Service.JoinRoom(t.Context(), me, live.ID); err != nil {
		t.Fatal(err)
	}
	joinHuddle(t, env, r.admin, live.ID)
	notJoined := createRoom(t, env, r.admin, r.ws.ID, "public", "not-joined")
	secret := createRoom(t, env, r.admin, r.ws.ID, "private", "secret")
	archived := createRoom(t, env, r.admin, r.ws.ID, "public", "archived")
	if _, err := env.Service.JoinRoom(t.Context(), me, archived.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.ArchiveRoom(t.Context(), r.admin, archived.ID); err != nil {
		t.Fatal(err)
	}
	dm, _ := createDM(t, env, r.admin, r.ws.ID, me)
	missing := env.IDs.New()

	ids := []ulid.ULID{live.ID, notJoined.ID, secret.ID, archived.ID, dm.ID, missing, live.ID}
	got, err := env.Service.ResolveHuddleLinks(t.Context(), me, ids)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(ids) {
		t.Fatalf("len = %d", len(got))
	}

	tests := []struct {
		name    string
		at      int
		status  chat.MessageLinkStatus
		huddle  bool
		canJoin bool
	}{
		{"進行中で入れる", 0, chat.MessageLinkOK, true, true},
		{"参加していない public は読めるが入れない", 1, chat.MessageLinkOK, false, false},
		{"読めない private は unavailable", 2, chat.MessageLinkUnavailable, false, false},
		{"アーカイブは読めるが入れない", 3, chat.MessageLinkOK, false, false},
		{"DM は相手の名前で出て入れる", 4, chat.MessageLinkOK, false, true},
		{"ないルームは読めないのと区別しない", 5, chat.MessageLinkUnavailable, false, false},
		{"同じルームへのリンクが重なっても、同じ順で同じ結果", 6, chat.MessageLinkOK, true, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := got[tt.at]
			if res.RoomID != ids[tt.at] || res.Status != tt.status || (res.Huddle != nil) != tt.huddle || res.CanJoin != tt.canJoin {
				t.Errorf("result = %+v", res)
			}
			if tt.status == chat.MessageLinkUnavailable && (res.Room != nil || res.Workspace != nil) {
				t.Errorf("unavailable なのに中身がある: %+v", res)
			}
		})
	}
	if res := got[0]; res.Workspace == nil || res.Workspace.ID != r.ws.ID || res.Room.Name != "live" || len(res.Huddle.Participants) != 1 {
		t.Errorf("live = %+v", res)
	}
	if res := got[4]; res.Room.DMPeer == nil || res.Room.DMPeer.ID != r.admin {
		t.Errorf("dm = %+v", res.Room)
	}

	t.Run("21 件以上は 422", func(t *testing.T) {
		var verr *chat.ValidationError
		if _, err := env.Service.ResolveHuddleLinks(t.Context(), me, make([]ulid.ULID, chat.MaxHuddleLinks+1)); !errors.As(err, &verr) {
			t.Errorf("err = %v", err)
		}
	})
}

func TestSaveHuddleMessage(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	joined := joinHuddle(t, env, r.member, room.ID)

	if _, err := env.Service.SaveMessage(t.Context(), r.member2, room.ID, joined.Huddle.MessageID); err != nil {
		t.Fatalf("ハドルのメッセージは保存できる: %v", err)
	}
	page, err := env.Service.ListSaved(t.Context(), r.member2, r.ws.ID, chat.SavedQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Status != chat.SavedItemOK || page.Items[0].Message == nil || page.Items[0].Message.Huddle == nil ||
		page.Items[0].Message.Huddle.ID != joined.Huddle.ID {
		t.Errorf("saved = %+v", page.Items)
	}
}
