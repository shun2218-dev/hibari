package chat_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

func listActivity(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID, q chat.ActivityQuery) chat.ActivityPage {
	t.Helper()
	page, err := env.Service.ListActivity(t.Context(), actor, workspaceID, q)
	if err != nil {
		t.Fatalf("ListActivity: %v", err)
	}
	return page
}

func unreadActivity(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID) int64 {
	t.Helper()
	n, err := env.Service.CountUnreadActivity(t.Context(), actor, workspaceID)
	if err != nil {
		t.Fatalf("CountUnreadActivity: %v", err)
	}
	return n
}

// messageIDs は一覧のメッセージの ID を並びのまま返す（リアクションはリアクションの付いたメッセージ）。
func messageIDs(items []chat.ActivityItem) []ulid.ULID {
	ids := make([]ulid.ULID, len(items))
	for i := range items {
		ids[i] = items[i].Message.ID
	}
	return ids
}

func TestListActivity(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)

	t.Run("メッセージ単位で新しい順に並び、同じチャンネルの通知も 1 件ずつ出る（決定 2）", func(t *testing.T) {
		first := send(t, env, r.member2, room.ID, at(r.member)+" 1 件目")
		second := send(t, env, r.member2, room.ID, at(r.member)+" 2 件目")
		send(t, env, r.member2, room.ID, "メンションのない投稿は出ない")

		page := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{})
		if got := messageIDs(page.Items); len(got) != 2 || got[0] != second.ID || got[1] != first.ID {
			t.Fatalf("items = %v, want [%s %s]", got, second.ID, first.ID)
		}
		it := page.Items[0]
		if it.Type != chat.ActivityItemMessage || !it.Unread || it.Room.ID != room.ID || it.Message.Sender.ID != r.member2 {
			t.Errorf("item = %+v", it)
		}
	})

	t.Run("ルームを読むと既読になり、未読の件数が減る（決定 5）", func(t *testing.T) {
		if got := unreadActivity(t, env, r.member, r.ws.ID); got != 2 {
			t.Fatalf("unread = %d, want 2", got)
		}
		markRead(t, env, r.member, room.ID)
		if got := unreadActivity(t, env, r.member, r.ws.ID); got != 0 {
			t.Errorf("unread = %d, want 0", got)
		}
		page := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{})
		for _, it := range page.Items {
			if it.Unread {
				t.Errorf("%s は既読のはず", it.Key)
			}
		}
		// 読んだものも一覧には残る。未読だけにすると出ない
		if len(page.Items) != 2 {
			t.Errorf("items = %d, want 2", len(page.Items))
		}
		if got := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{UnreadOnly: true}); len(got.Items) != 0 {
			t.Errorf("unread only = %d, want 0", len(got.Items))
		}
	})

	t.Run("削除されたメッセージは出ない", func(t *testing.T) {
		m := send(t, env, r.member2, room.ID, at(r.member)+" 消します")
		if err := env.Service.DeleteMessage(t.Context(), r.member2, room.ID, m.ID); err != nil {
			t.Fatal(err)
		}
		for _, id := range messageIDs(listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{}).Items) {
			if id == m.ID {
				t.Error("削除したメッセージが出た")
			}
		}
	})

	t.Run("ワークスペースのメンバーでなければ ErrNotFound", func(t *testing.T) {
		if _, err := env.Service.ListActivity(t.Context(), r.outsider, r.ws.ID, chat.ActivityQuery{}); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("ListActivity err = %v, want ErrNotFound", err)
		}
		if _, err := env.Service.CountUnreadActivity(t.Context(), r.outsider, r.ws.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("CountUnreadActivity err = %v, want ErrNotFound", err)
		}
	})

	t.Run("タブとカーソルが正しくなければ検証エラー", func(t *testing.T) {
		for _, q := range []chat.ActivityQuery{{Filter: "everything"}, {Before: "not-a-cursor"}} {
			var ve *chat.ValidationError
			if _, err := env.Service.ListActivity(t.Context(), r.member, r.ws.ID, q); !errors.As(err, &ve) {
				t.Errorf("ListActivity(%+v) err = %v, want ValidationError", q, err)
			}
		}
	})
}

// TestActivityHidesUnreadableRooms は DoD の「読めなくなったルームのメッセージはアクティビティに出ない」（決定 4）。
func TestActivityHidesUnreadableRooms(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	private := createRoom(t, env, r.admin, r.ws.ID, "private", "secret")
	if err := env.Service.AddRoomMember(t.Context(), r.admin, private.ID, r.member); err != nil {
		t.Fatal(err)
	}
	m := send(t, env, r.admin, private.ID, at(r.member)+" 非公開の話")
	if got := messageIDs(listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{}).Items); len(got) != 1 || got[0] != m.ID {
		t.Fatalf("before removal = %v, want [%s]", got, m.ID)
	}

	t.Run("非公開のルームから外されたら出ない", func(t *testing.T) {
		if err := env.Service.RemoveRoomMember(t.Context(), r.admin, private.ID, r.member); err != nil {
			t.Fatal(err)
		}
		if got := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{}); len(got.Items) != 0 {
			t.Errorf("items = %v, want none", messageIDs(got.Items))
		}
		if got := unreadActivity(t, env, r.member, r.ws.ID); got != 0 {
			t.Errorf("unread = %d, want 0", got)
		}
	})

	t.Run("ワークスペースから外されたら、一覧そのものが読めない", func(t *testing.T) {
		public := createRoom(t, env, r.admin, r.ws.ID, "public", "open")
		if _, err := env.Service.JoinRoom(t.Context(), r.member2, public.ID); err != nil {
			t.Fatal(err)
		}
		send(t, env, r.admin, public.ID, at(r.member2)+" 公開の話")
		if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.member2); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.ListActivity(t.Context(), r.member2, r.ws.ID, chat.ActivityQuery{}); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("参加していない public ルームのメッセージは出ない", func(t *testing.T) {
		public := createRoom(t, env, r.admin, r.ws.ID, "public", "not-joined")
		send(t, env, r.admin, public.ID, "<!channel> 参加していない人には出ない")
		if got := listActivity(t, env, r.admin2, r.ws.ID, chat.ActivityQuery{}); len(got.Items) != 0 {
			t.Errorf("items = %v, want none", messageIDs(got.Items))
		}
	})
}

func TestActivityPaging(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)
	var want []ulid.ULID
	for i := range 5 {
		m := send(t, env, r.member2, room.ID, fmt.Sprintf("%s %d", at(r.member), i))
		want = append([]ulid.ULID{m.ID}, want...)
		// 同じ時刻の行もカーソルで取りこぼさない（並びの 2 つ目のキーで決める）
		if i%2 == 1 {
			env.Clock.Advance(time.Millisecond)
		}
	}

	var got []ulid.ULID
	q := chat.ActivityQuery{Limit: 2}
	for range 5 {
		page := listActivity(t, env, r.member, r.ws.ID, q)
		got = append(got, messageIDs(page.Items)...)
		if !page.HasMore {
			if page.NextCursor != "" {
				t.Errorf("next cursor without more: %q", page.NextCursor)
			}
			break
		}
		q.Before = page.NextCursor
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("paged = %v, want %v", got, want)
	}
}

func TestActivityFilter(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)
	dm, _ := createDM(t, env, r.member2, r.ws.ID, r.member)
	mention := send(t, env, r.member2, room.ID, at(r.member)+" メンション")
	direct := send(t, env, r.member2, dm.ID, "DM")
	mine := send(t, env, r.member, room.ID, "自分の投稿")
	if _, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, mine.ID, "👍"); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		filter chat.ActivityFilter
		want   []ulid.ULID
	}{
		{chat.ActivityFilterAll, []ulid.ULID{mine.ID, direct.ID, mention.ID}},
		{chat.ActivityFilterMention, []ulid.ULID{mention.ID}},
		{chat.ActivityFilterDM, []ulid.ULID{direct.ID}},
		{chat.ActivityFilterThread, nil},
		{chat.ActivityFilterReaction, []ulid.ULID{mine.ID}},
	} {
		t.Run(string(tc.filter), func(t *testing.T) {
			got := messageIDs(listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{Filter: tc.filter}).Items)
			if fmt.Sprint(got) != fmt.Sprint(tc.want) {
				t.Errorf("items = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestActivityReactions は、自分のメッセージへのリアクションが一覧に並び、送信者にだけイベントが届くこと（決定 2・9）。
func TestActivityReactions(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)
	mine := send(t, env, r.member, room.ID, "リアクションしてください")
	env.Deliveries.Take()

	t.Run("ほかの人が付けたら並び、送信者にだけ activity.reaction_added が届く", func(t *testing.T) {
		if _, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, mine.ID, "🎉"); err != nil {
			t.Fatal(err)
		}
		page := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{Filter: chat.ActivityFilterReaction})
		if len(page.Items) != 1 {
			t.Fatalf("items = %d, want 1", len(page.Items))
		}
		it := page.Items[0]
		if it.Type != chat.ActivityItemReaction || it.Unread || it.Reaction == nil || it.Reaction.Emoji != "🎉" || it.Reaction.User.ID != r.member2 {
			t.Errorf("item = %+v", it)
		}

		var added *chat.ActivityReactionAdded
		for _, ev := range env.Deliveries.Take() {
			if ev.Type != chat.EventActivityReactionAdded {
				continue
			}
			if len(ev.To.Users) != 1 || ev.To.Users[0] != r.member || len(ev.To.Rooms) != 0 {
				t.Errorf("audience = %+v, want 送信者だけ", ev.To)
			}
			d := ev.Data.(chat.ActivityReactionAdded)
			added = &d
		}
		if added == nil || added.WorkspaceID != r.ws.ID || added.Item.Key != it.Key || added.Item.Reaction.User.ID != r.member2 {
			t.Fatalf("activity.reaction_added = %+v, want the listed item %s", added, it.Key)
		}
	})

	t.Run("外したら一覧から消え、activity.reaction_removed の id は一覧の id と同じ", func(t *testing.T) {
		key := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{Filter: chat.ActivityFilterReaction}).Items[0].Key
		if _, err := env.Service.RemoveReaction(t.Context(), r.member2, room.ID, mine.ID, "🎉"); err != nil {
			t.Fatal(err)
		}
		if got := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{Filter: chat.ActivityFilterReaction}); len(got.Items) != 0 {
			t.Errorf("items = %d, want 0", len(got.Items))
		}
		var removed bool
		for _, ev := range env.Deliveries.Take() {
			if ev.Type == chat.EventActivityReactionRemoved {
				removed = ev.Data.(chat.ActivityReactionRemoved).Key == key
			}
		}
		if !removed {
			t.Errorf("activity.reaction_removed with id %s was not delivered", key)
		}
	})

	t.Run("自分で付けたリアクションは並ばず、イベントも出ない", func(t *testing.T) {
		if _, err := env.Service.AddReaction(t.Context(), r.member, room.ID, mine.ID, "👀"); err != nil {
			t.Fatal(err)
		}
		if got := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{Filter: chat.ActivityFilterReaction}); len(got.Items) != 0 {
			t.Errorf("items = %d, want 0", len(got.Items))
		}
		for _, ev := range env.Deliveries.Take() {
			if ev.Type == chat.EventActivityReactionAdded {
				t.Error("自分のリアクションで activity.reaction_added が出た")
			}
		}
	})

	t.Run("ミュートしたルームでは並ばず、イベントも出ない", func(t *testing.T) {
		if _, err := env.Service.SetRoomNotifications(t.Context(), r.member, room.ID, chat.RoomNotifications{Muted: true}); err != nil {
			t.Fatal(err)
		}
		env.Deliveries.Take()
		if _, err := env.Service.AddReaction(t.Context(), r.admin, room.ID, mine.ID, "🙏"); err != nil {
			t.Fatal(err)
		}
		if got := listActivity(t, env, r.member, r.ws.ID, chat.ActivityQuery{Filter: chat.ActivityFilterReaction}); len(got.Items) != 0 {
			t.Errorf("items = %d, want 0", len(got.Items))
		}
		for _, ev := range env.Deliveries.Take() {
			if ev.Type == chat.EventActivityReactionAdded {
				t.Error("ミュートしたルームで activity.reaction_added が出た")
			}
		}
	})
}

// TestCountUnreadActivityCaps は、未読の件数を上限で打ち切ること（メニューのバッジは「99+」。決定 5）。
func TestCountUnreadActivityCaps(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	dm, _ := createDM(t, env, r.member2, r.ws.ID, r.member)
	for i := range chat.MaxUnreadActivityCount + 5 {
		send(t, env, r.member2, dm.ID, fmt.Sprintf("DM %d", i))
	}
	if got := unreadActivity(t, env, r.member, r.ws.ID); got != chat.MaxUnreadActivityCount {
		t.Errorf("unread = %d, want %d", got, chat.MaxUnreadActivityCount)
	}
}
