package chat_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// followedThread は actor の参加中のスレッドから rootID を探す。参加していなければ nil。
func followedThread(t *testing.T, env *chattest.Env, actor, workspaceID, rootID ulid.ULID) *chat.FollowedThread {
	t.Helper()
	page, err := env.Service.ListThreads(t.Context(), actor, workspaceID, chat.PageRequest{})
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	for i := range page.Items {
		if page.Items[i].Root.ID == rootID {
			return &page.Items[i]
		}
	}
	return nil
}

func TestSetThreadNotifications(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)
	root := send(t, env, r.member, room.ID, "親")
	reply(t, env, r.member2, room.ID, root.ID, "最初の返信")
	env.Deliveries.Take()

	t.Run("オフにしても参加は残り、未読も数えるが、バッジには数えない（決定 1・2）", func(t *testing.T) {
		got, err := env.Service.SetThreadNotifications(t.Context(), r.member, room.ID, root.ID, false)
		if err != nil || got.NotifyReplies || got.LastReadThreadSeq == nil {
			t.Fatalf("SetThreadNotifications = %+v, %v", got, err)
		}
		reply(t, env, r.member2, room.ID, root.ID, "オフの後の返信")

		th := followedThread(t, env, r.member, r.ws.ID, root.ID)
		if th == nil || th.NotifyReplies || th.UnreadCount != 2 {
			t.Fatalf("thread = %+v, want 参加中・オフ・未読 2", th)
		}
		if got := unreadThreads(t, env, r.member, r.ws.ID); got != 0 {
			t.Errorf("unread_thread_count = %d, want 0（オフのスレッドは数えない）", got)
		}
	})

	t.Run("オフでも、自分宛てのメンションがあればバッジに数え、@N を出す", func(t *testing.T) {
		reply(t, env, r.member2, room.ID, root.ID, at(r.member)+" これだけ見て")
		if got := unreadThreads(t, env, r.member, r.ws.ID); got != 1 {
			t.Errorf("unread_thread_count = %d, want 1", got)
		}
		if th := followedThread(t, env, r.member, r.ws.ID, root.ID); th.MentionCount != 1 {
			t.Errorf("mention_count = %d, want 1", th.MentionCount)
		}
		// メンションで参加し直しても、オフのまま（決定 1）
		if th := followedThread(t, env, r.member, r.ws.ID, root.ID); th.NotifyReplies {
			t.Error("メンションで通知がオンに戻った")
		}
	})

	t.Run("自分で返信してもオフのまま", func(t *testing.T) {
		reply(t, env, r.member, room.ID, root.ID, "返信する")
		if th := followedThread(t, env, r.member, r.ws.ID, root.ID); th.NotifyReplies {
			t.Error("返信で通知がオンに戻った")
		}
		env.Deliveries.Take()
	})

	t.Run("本人のすべての接続に thread.notifications_updated を配る", func(t *testing.T) {
		if _, err := env.Service.SetThreadNotifications(t.Context(), r.member, room.ID, root.ID, true); err != nil {
			t.Fatal(err)
		}
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventThreadNotificationsUpdated {
			t.Fatalf("events = %+v, want thread.notifications_updated だけ（参加済みなので thread.followed はない）", evs)
		}
		if to := evs[0].To; len(to.Users) != 1 || to.Users[0] != r.member || len(to.Rooms) != 0 {
			t.Errorf("宛先 = %+v, want 本人だけ", to)
		}
		if d := evs[0].Data.(chat.ThreadNotificationsUpdated); d.ThreadRootID != root.ID || !d.NotifyReplies || d.WorkspaceID != r.ws.ID {
			t.Errorf("data = %+v", d)
		}
	})

	t.Run("参加していないスレッドをフォローすると、押した時点までを既読にして参加する（決定 5）", func(t *testing.T) {
		if followedThread(t, env, r.admin, r.ws.ID, root.ID) != nil {
			t.Fatal("admin はまだ参加していないはず")
		}
		got, err := env.Service.SetThreadNotifications(t.Context(), r.admin, room.ID, root.ID, true)
		if err != nil || !got.NotifyReplies {
			t.Fatalf("SetThreadNotifications = %+v, %v", got, err)
		}
		th := followedThread(t, env, r.admin, r.ws.ID, root.ID)
		if th == nil || th.UnreadCount != 0 || !th.NotifyReplies {
			t.Fatalf("thread = %+v, want 参加・未読 0", th)
		}
		types := []chat.EventType{}
		for _, ev := range env.Deliveries.Take() {
			types = append(types, ev.Type)
		}
		if len(types) != 2 || types[0] != chat.EventThreadFollowed || types[1] != chat.EventThreadNotificationsUpdated {
			t.Errorf("events = %v, want thread.followed → thread.notifications_updated", types)
		}
		reply(t, env, r.member2, room.ID, root.ID, "フォローの後")
		if th := followedThread(t, env, r.admin, r.ws.ID, root.ID); th.UnreadCount != 1 {
			t.Errorf("フォローの後の返信の未読 = %d, want 1", th.UnreadCount)
		}
		env.Deliveries.Take()
	})

	t.Run("参加していないスレッドを「オフ」にしても、エラーにせず何もしない", func(t *testing.T) {
		other := createRoom(t, env, r.member, r.ws.ID, "public", "other")
		if _, err := env.Service.JoinRoom(t.Context(), r.admin, other.ID); err != nil {
			t.Fatal(err)
		}
		root2 := send(t, env, r.member, other.ID, "別の親")
		reply(t, env, r.member, other.ID, root2.ID, "自分の返信")
		env.Deliveries.Take()

		got, err := env.Service.SetThreadNotifications(t.Context(), r.admin, other.ID, root2.ID, false)
		if err != nil || got.NotifyReplies || got.LastReadThreadSeq != nil {
			t.Errorf("SetThreadNotifications = %+v, %v; want オフ・参加なし", got, err)
		}
		if followedThread(t, env, r.admin, r.ws.ID, root2.ID) != nil {
			t.Error("オフで参加してしまった")
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v, want なし", evs)
		}
	})

	t.Run("設定できない相手と親", func(t *testing.T) {
		noReplies := send(t, env, r.member, room.ID, "返信のない親")
		aReply := reply(t, env, r.member2, room.ID, root.ID, "返信")
		private := createRoom(t, env, r.member, r.ws.ID, "private", "secret")
		privateRoot := send(t, env, r.member, private.ID, "非公開の親")
		reply(t, env, r.member, private.ID, privateRoot.ID, "返信")
		tests := []struct {
			name   string
			actor  ulid.ULID
			roomID ulid.ULID
			rootID ulid.ULID
			want   error
		}{
			{"参加していない public ルーム", r.owner, room.ID, root.ID, chat.ErrForbidden},
			{"読めないルーム", r.member2, private.ID, privateRoot.ID, chat.ErrNotFound},
			{"ワークスペースの外", r.outsider, room.ID, root.ID, chat.ErrNotFound},
			{"返信のない親（一覧に置けない）", r.member2, room.ID, noReplies.ID, chat.ErrNotFound},
			{"返信は親にならない", r.member2, room.ID, aReply.ID, chat.ErrNotFound},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				_, err := env.Service.SetThreadNotifications(t.Context(), tt.actor, tt.roomID, tt.rootID, true)
				if !errors.Is(err, tt.want) {
					t.Errorf("err = %v, want %v", err, tt.want)
				}
			})
		}
	})
}

// 1 対 1 の DM のスレッドは、最初の返信で 2 人とも参加する（Slack の既定。ADR 0056 決定 6）。
func TestDMThreadFollowsBothMembers(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	root := send(t, env, r.member, dm.ID, "親")
	env.Deliveries.Take()

	// 親を書いた本人が返信しても、相手も参加する（これまでは親の投稿者と返信した人だけだった）
	reply(t, env, r.member, dm.ID, root.ID, "自分で補足")

	th := followedThread(t, env, r.member2, r.ws.ID, root.ID)
	if th == nil || th.UnreadCount != 1 {
		t.Fatalf("相手のスレッド = %+v, want 参加・未読 1", th)
	}
	var followed []ulid.ULID
	for _, ev := range env.Deliveries.Take() {
		if ev.Type == chat.EventThreadFollowed {
			followed = append(followed, ev.To.Users...)
		}
	}
	if !slices.Contains(followed, r.member2) {
		t.Errorf("thread.followed の宛先 = %v, want 相手を含む", followed)
	}
}
