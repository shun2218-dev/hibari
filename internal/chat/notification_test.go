package chat_test

import (
	"errors"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

func TestNotificationLevel(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	env.Deliveries.Take()

	t.Run("未設定なら mentions（Slack の既定と同じ）", func(t *testing.T) {
		got, err := env.Service.NotificationLevel(t.Context(), r.member, r.ws.ID)
		if err != nil || got != chat.NotifyMentions {
			t.Fatalf("NotificationLevel = %q, %v; want mentions", got, err)
		}
	})

	t.Run("変えると本人のすべての接続に notifications.updated を配る", func(t *testing.T) {
		got, err := env.Service.SetNotificationLevel(t.Context(), r.member, r.ws.ID, chat.NotifyAll)
		if err != nil || got != chat.NotifyAll {
			t.Fatalf("SetNotificationLevel = %q, %v; want all", got, err)
		}
		if got, _ := env.Service.NotificationLevel(t.Context(), r.member, r.ws.ID); got != chat.NotifyAll {
			t.Errorf("読み直した値 = %q, want all", got)
		}
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventNotificationsUpdated {
			t.Fatalf("events = %+v, want notifications.updated 1 件", evs)
		}
		if to := evs[0].To; len(to.Users) != 1 || to.Users[0] != r.member || len(to.Rooms)+len(to.Workspaces) != 0 {
			t.Errorf("宛先 = %+v, want 本人だけ", to)
		}
		if d := evs[0].Data.(chat.NotificationsUpdated); d.WorkspaceID != r.ws.ID || d.Level != chat.NotifyAll {
			t.Errorf("data = %+v", d)
		}
	})

	t.Run("ワークスペースごとに別（ADR 0055 決定 2）", func(t *testing.T) {
		second := env.CreateWorkspace(t, r.member)
		if got, _ := env.Service.NotificationLevel(t.Context(), r.member, second.ID); got != chat.NotifyMentions {
			t.Errorf("2 つ目のワークスペース = %q, want mentions（未設定）", got)
		}
	})

	t.Run("ほかの人の設定は変わらない", func(t *testing.T) {
		if got, _ := env.Service.NotificationLevel(t.Context(), r.member2, r.ws.ID); got != chat.NotifyMentions {
			t.Errorf("member2 = %q, want mentions", got)
		}
	})

	t.Run("メンバーでなければ ErrNotFound", func(t *testing.T) {
		if _, err := env.Service.NotificationLevel(t.Context(), r.outsider, r.ws.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("get: err = %v, want ErrNotFound", err)
		}
		if _, err := env.Service.SetNotificationLevel(t.Context(), r.outsider, r.ws.ID, chat.NotifyAll); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("set: err = %v, want ErrNotFound", err)
		}
	})

	t.Run("知らない値は 422", func(t *testing.T) {
		_, err := env.Service.SetNotificationLevel(t.Context(), r.member, r.ws.ID, "loud")
		var ve *chat.ValidationError
		if !errors.As(err, &ve) || ve.Fields[0].Field != "level" {
			t.Errorf("err = %v, want level の ValidationError", err)
		}
	})
}

func TestSetRoomNotifications(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "notify")
	env.Deliveries.Take()
	all := chat.NotifyAll

	t.Run("参加する前は設定を持てない（public は読めるが 403）", func(t *testing.T) {
		if got := roomOf(t, env, r.member2, r.ws.ID, room.ID); got.Notifications != nil {
			t.Errorf("notifications = %+v, want nil（参加していない）", got.Notifications)
		}
		_, err := env.Service.SetRoomNotifications(t.Context(), r.member2, room.ID, chat.RoomNotifications{Muted: true})
		if !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("err = %v, want ErrForbidden", err)
		}
	})

	t.Run("参加していれば既定（上書きなし・ミュートなし）", func(t *testing.T) {
		n := roomOf(t, env, r.member, r.ws.ID, room.ID).Notifications
		if n == nil || n.Level != nil || n.Muted || n.MutedUntil != nil {
			t.Errorf("notifications = %+v, want 既定", n)
		}
	})

	t.Run("置き換えると一覧と 1 件の両方に出て、本人に room.notifications_updated を配る", func(t *testing.T) {
		got, err := env.Service.SetRoomNotifications(t.Context(), r.member, room.ID, chat.RoomNotifications{Level: &all, Muted: true})
		if err != nil || got.Level == nil || *got.Level != chat.NotifyAll || !got.Muted {
			t.Fatalf("SetRoomNotifications = %+v, %v", got, err)
		}
		if n := roomOf(t, env, r.member, r.ws.ID, room.ID).Notifications; n == nil || !n.Muted || n.Level == nil {
			t.Errorf("一覧 = %+v, want all でミュート", n)
		}
		one, err := env.Service.GetRoom(t.Context(), r.member, room.ID)
		if err != nil || one.Notifications == nil || !one.Notifications.Muted {
			t.Errorf("GetRoom = %+v, %v", one.Notifications, err)
		}
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventRoomNotificationsUpdated {
			t.Fatalf("events = %+v, want room.notifications_updated 1 件", evs)
		}
		if to := evs[0].To; len(to.Users) != 1 || to.Users[0] != r.member || len(to.Rooms)+len(to.Workspaces) != 0 {
			t.Errorf("宛先 = %+v, want 本人だけ（設定はほかのメンバーに関係ない）", to)
		}
		if d := evs[0].Data.(chat.RoomNotificationsUpdated); d.RoomID != room.ID || d.WorkspaceID != r.ws.ID || !d.Notifications.Muted {
			t.Errorf("data = %+v", d)
		}
	})

	t.Run("ミュートしても未読数は数える（見せ方だけを変える。決定 1）", func(t *testing.T) {
		if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
			t.Fatalf("join: %v", err)
		}
		send(t, env, r.member2, room.ID, "ミュート中の投稿")
		if got := roomOf(t, env, r.member, r.ws.ID, room.ID); got.UnreadCount != 1 {
			t.Errorf("unread = %d, want 1", got.UnreadCount)
		}
		env.Deliveries.Take()
	})

	t.Run("一時的なミュートは期限が来たら、読むときにしていないものとして返す", func(t *testing.T) {
		until := env.Clock.Now().Add(time.Hour)
		got, err := env.Service.SetRoomNotifications(t.Context(), r.member, room.ID, chat.RoomNotifications{Muted: true, MutedUntil: &until})
		if err != nil || got.MutedUntil == nil || !got.MutedUntil.Equal(until) {
			t.Fatalf("SetRoomNotifications = %+v, %v", got, err)
		}
		env.Clock.Advance(time.Hour)
		defer env.Clock.Advance(-time.Hour)
		if n := roomOf(t, env, r.member, r.ws.ID, room.ID).Notifications; n.Muted || n.MutedUntil != nil {
			t.Errorf("期限の後 = %+v, want ミュートなし", n)
		}
		env.Deliveries.Take()
	})

	t.Run("解除すると期限も消える", func(t *testing.T) {
		got, err := env.Service.SetRoomNotifications(t.Context(), r.member, room.ID, chat.RoomNotifications{})
		if err != nil || got.Muted || got.MutedUntil != nil || got.Level != nil {
			t.Errorf("SetRoomNotifications = %+v, %v; want 既定", got, err)
		}
		env.Deliveries.Take()
	})

	t.Run("組み合わせが合わなければ 422", func(t *testing.T) {
		dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
		none := chat.NotifyNone
		past := env.Clock.Now().Add(-time.Minute)
		future := env.Clock.Now().Add(time.Hour)
		tests := []struct {
			name   string
			roomID ulid.ULID
			in     chat.RoomNotifications
			field  string
		}{
			{"ルームでは none を選べない（止めるならミュート）", room.ID, chat.RoomNotifications{Level: &none}, "level"},
			{"ミュートしていないのに期限がある", room.ID, chat.RoomNotifications{MutedUntil: &future}, "muted_until"},
			{"過ぎた期限", room.ID, chat.RoomNotifications{Muted: true, MutedUntil: &past}, "muted_until"},
			{"DM では通知する内容を上書きしない", dm.ID, chat.RoomNotifications{Level: &all}, "level"},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				_, err := env.Service.SetRoomNotifications(t.Context(), r.member, tt.roomID, tt.in)
				var ve *chat.ValidationError
				if !errors.As(err, &ve) || ve.Fields[0].Field != tt.field {
					t.Errorf("err = %v, want %s の ValidationError", err, tt.field)
				}
			})
		}
		t.Run("DM はミュートだけならできる", func(t *testing.T) {
			if _, err := env.Service.SetRoomNotifications(t.Context(), r.member, dm.ID, chat.RoomNotifications{Muted: true}); err != nil {
				t.Errorf("err = %v", err)
			}
		})
		env.Deliveries.Take()
	})

	t.Run("読めないルームは ErrNotFound（存在を明かさない）", func(t *testing.T) {
		private := createRoom(t, env, r.member, r.ws.ID, "private", "secret")
		for _, actor := range []ulid.ULID{r.member2, r.outsider} {
			_, err := env.Service.SetRoomNotifications(t.Context(), actor, private.ID, chat.RoomNotifications{Muted: true})
			if !errors.Is(err, chat.ErrNotFound) {
				t.Errorf("err = %v, want ErrNotFound", err)
			}
		}
		env.Deliveries.Take()
	})

	t.Run("抜けて入り直すと既定に戻る（行ごと消える）", func(t *testing.T) {
		if _, err := env.Service.SetRoomNotifications(t.Context(), r.member2, room.ID, chat.RoomNotifications{Muted: true}); err != nil {
			t.Fatal(err)
		}
		if err := env.Service.RemoveRoomMember(t.Context(), r.member2, room.ID, r.member2); err != nil {
			t.Fatalf("leave: %v", err)
		}
		if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
			t.Fatalf("join: %v", err)
		}
		if n := roomOf(t, env, r.member2, r.ws.ID, room.ID).Notifications; n == nil || n.Muted {
			t.Errorf("入り直した後 = %+v, want 既定", n)
		}
	})
}

// roomOf はルームの一覧から 1 件を取り出す（一覧の応答に本人の設定が載ることを確かめるため）。
func roomOf(t *testing.T, env *chattest.Env, actor, workspaceID, roomID ulid.ULID) chat.Room {
	t.Helper()
	rooms, err := env.Service.ListRooms(t.Context(), actor, workspaceID)
	if err != nil {
		t.Fatalf("ListRooms: %v", err)
	}
	for _, room := range rooms {
		if room.ID == roomID {
			return room
		}
	}
	t.Fatalf("room %s が一覧にない", roomID)
	return chat.Room{}
}
