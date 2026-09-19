package chat_test

import (
	"context"
	"sync"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
	"github.com/shun2218-dev/hibari/internal/chat/mention"
)

// メンション（ADR 0041）。

// at はメンションのトークンを組み立てる。本文には表示名ではなく ID を入れる。
func at(id ulid.ULID) string { return "<@" + id.String() + ">" }

// mentionCount は actor から見たルームのメンションの件数。
func mentionCount(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID) int64 {
	t.Helper()
	room, err := env.Service.GetRoom(t.Context(), actor, roomID)
	if err != nil {
		t.Fatalf("GetRoom: %v", err)
	}
	return room.MentionCount
}

// markRead は actor の既読位置をルームの最新まで進める。
func markRead(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID) chat.ReadState {
	t.Helper()
	room, err := env.Service.GetRoom(t.Context(), actor, roomID)
	if err != nil {
		t.Fatalf("GetRoom: %v", err)
	}
	st, err := env.Service.MarkRoomRead(t.Context(), actor, roomID, room.LastMessageSeq)
	if err != nil {
		t.Fatalf("MarkRoomRead: %v", err)
	}
	return st
}

// mentionRoom は member・member2・admin が参加した public ルームを作る。
func mentionRoom(t *testing.T, env *chattest.Env) (roles, chat.Room) {
	t.Helper()
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "mentions")
	for _, u := range []ulid.ULID{r.member2, r.admin} {
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	return r, room
}

func TestMentionCountsAndClearsOnRead(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)

	send(t, env, r.member, room.ID, "やあ "+at(r.member2))

	t.Run("mentioned member has a count", func(t *testing.T) {
		if got := mentionCount(t, env, r.member2, room.ID); got != 1 {
			t.Errorf("mention_count = %d, want 1", got)
		}
	})
	t.Run("others do not", func(t *testing.T) {
		if got := mentionCount(t, env, r.admin, room.ID); got != 0 {
			t.Errorf("admin's mention_count = %d, want 0", got)
		}
	})
	// 送信で自分の既読位置が進むので、自分の発言は自分の件数にならない（ADR 0012 / 0041）。
	t.Run("the sender's own mention does not count", func(t *testing.T) {
		send(t, env, r.member, room.ID, "独り言 "+at(r.member))
		if got := mentionCount(t, env, r.member, room.ID); got != 0 {
			t.Errorf("sender's mention_count = %d, want 0", got)
		}
	})
	t.Run("reading the room clears it", func(t *testing.T) {
		st := markRead(t, env, r.member2, room.ID)
		if st.MentionCount != 0 {
			t.Errorf("read state mention_count = %d, want 0", st.MentionCount)
		}
		if got := mentionCount(t, env, r.member2, room.ID); got != 0 {
			t.Errorf("mention_count after read = %d, want 0", got)
		}
	})
	t.Run("a mention after reading counts again", func(t *testing.T) {
		send(t, env, r.member, room.ID, at(r.member2)+" もう一度")
		if got := mentionCount(t, env, r.member2, room.ID); got != 1 {
			t.Errorf("mention_count = %d, want 1", got)
		}
	})
}

func TestMentionChannelAndHere(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)

	t.Run("@channel counts for every member", func(t *testing.T) {
		send(t, env, r.member, room.ID, "<!channel> 集合")
		for _, u := range []ulid.ULID{r.member2, r.admin} {
			if got := mentionCount(t, env, u, room.ID); got != 1 {
				t.Errorf("mention_count for %s = %d, want 1", u, got)
			}
		}
		// 送信者は自分の発言で既読位置が進むので数えない。
		if got := mentionCount(t, env, r.member, room.ID); got != 0 {
			t.Errorf("sender's mention_count = %d, want 0", got)
		}
	})
	t.Run("@channel does not reach a non-member", func(t *testing.T) {
		// outsider はワークスペースのメンバーですらないので、そもそもルームを読めない。
		// public ルームに参加していない admin2（ワークスペースのメンバー）で確かめる。
		if got := mentionCount(t, env, r.admin2, room.ID); got != 0 {
			t.Errorf("non-member's mention_count = %d, want 0", got)
		}
	})

}

// @here は「送った瞬間にオンラインのルームのメンバー」。誰がオンラインかを固定して確かめる（Redis の TTL に依存させない）。
func TestMentionHere(t *testing.T) {
	// 誰がオンラインかは Env を作るときに決めるので、先にユーザーを作る Env とは分けられない。
	// chattest.OnlineUsers はスライスなので、後から中身を入れ替えられるポインタを使う。
	online := &onlineSet{}
	env := chattest.New(t, chattest.WithPresenceReader(online))
	r, room := mentionRoom(t, env)
	online.set(r.member2)

	send(t, env, r.member, room.ID, "<!here> いまいる人")

	if got := mentionCount(t, env, r.member2, room.ID); got != 1 {
		t.Errorf("online member's mention_count = %d, want 1", got)
	}
	if got := mentionCount(t, env, r.admin, room.ID); got != 0 {
		t.Errorf("offline member's mention_count = %d, want 0", got)
	}

	t.Run("nobody online means nobody is counted", func(t *testing.T) {
		markRead(t, env, r.member2, room.ID)
		online.set()
		send(t, env, r.member, room.ID, "<!here> 誰もいない")
		if got := mentionCount(t, env, r.member2, room.ID); got != 0 {
			t.Errorf("mention_count = %d, want 0", got)
		}
	})
}

// onlineSet は、テストの途中でオンラインの顔ぶれを変えられる chat.PresenceReader。
type onlineSet struct {
	mu  sync.Mutex
	ids []ulid.ULID
}

func (o *onlineSet) set(ids ...ulid.ULID) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.ids = ids
}

func (o *onlineSet) Online(ctx context.Context, userIDs []ulid.ULID) (map[ulid.ULID]bool, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return chattest.OnlineUsers(o.ids).Online(ctx, userIDs)
}

func TestMentionNonMemberIsNotCountedButStillShown(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)

	// admin2 はワークスペースのメンバーだが、このルームには参加していない。
	msg := send(t, env, r.member, room.ID, at(r.admin2)+" 見てる？")

	if got := mentionCount(t, env, r.admin2, room.ID); got != 0 {
		t.Errorf("non-member's mention_count = %d, want 0", got)
	}
	// 数えないが、名前は出す（表示は本文から作るため。ADR 0041）。
	if len(msg.Mentions) != 1 || msg.Mentions[0].Kind != mention.KindUser || msg.Mentions[0].User == nil ||
		msg.Mentions[0].User.ID != r.admin2 {
		t.Errorf("mentions = %+v, want the non-member's profile", msg.Mentions)
	}

	t.Run("joining does not resurrect the old mention", func(t *testing.T) {
		if _, err := env.Service.JoinRoom(t.Context(), r.admin2, room.ID); err != nil {
			t.Fatal(err)
		}
		if got := mentionCount(t, env, r.admin2, room.ID); got != 0 {
			t.Errorf("mention_count after joining = %d, want 0", got)
		}
	})
}

func TestMentionRowsFollowTheBody(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)

	msg := send(t, env, r.member, room.ID, at(r.member2)+" と "+at(r.admin))
	if got := mentionCount(t, env, r.member2, room.ID); got != 1 {
		t.Fatalf("mention_count = %d, want 1", got)
	}

	t.Run("editing out a mention removes the count", func(t *testing.T) {
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, at(r.admin)+" だけ"); err != nil {
			t.Fatal(err)
		}
		if got := mentionCount(t, env, r.member2, room.ID); got != 0 {
			t.Errorf("mention_count after edit = %d, want 0", got)
		}
		if got := mentionCount(t, env, r.admin, room.ID); got != 1 {
			t.Errorf("remaining mention_count = %d, want 1", got)
		}
	})
	t.Run("editing a mention in counts while the message is unread", func(t *testing.T) {
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, at(r.member2)+" やっぱり"); err != nil {
			t.Fatal(err)
		}
		if got := mentionCount(t, env, r.member2, room.ID); got != 1 {
			t.Errorf("mention_count = %d, want 1", got)
		}
	})
	// 既読位置から導いているので、読まれた後に足したメンションは未読にならない（ADR 0041 のトレードオフ）。
	t.Run("editing a mention into an already read message does not count", func(t *testing.T) {
		markRead(t, env, r.admin, room.ID)
		if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, at(r.admin)+" 読んだ後に足す"); err != nil {
			t.Fatal(err)
		}
		if got := mentionCount(t, env, r.admin, room.ID); got != 0 {
			t.Errorf("mention_count = %d, want 0", got)
		}
	})
	t.Run("deleting the message removes the count", func(t *testing.T) {
		msg2 := send(t, env, r.member, room.ID, at(r.member2)+" 消す前")
		if got := mentionCount(t, env, r.member2, room.ID); got == 0 {
			t.Fatal("mention_count = 0 before delete")
		}
		if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg2.ID); err != nil {
			t.Fatal(err)
		}
		// 直前の編集で msg の member2 宛ては消えているので、消した msg2 が最後の 1 件だった。
		if got := mentionCount(t, env, r.member2, room.ID); got != 0 {
			t.Errorf("mention_count after delete = %d, want 0", got)
		}
	})
}

func TestMentionLeavingRoomClearsTheCount(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)

	send(t, env, r.member, room.ID, at(r.member2)+" ねえ")
	if got := mentionCount(t, env, r.member2, room.ID); got != 1 {
		t.Fatalf("mention_count = %d, want 1", got)
	}
	// 行は room_members への FK を持つので、抜けたら DB が消す（ADR 0041）。
	if err := env.Service.RemoveRoomMember(t.Context(), r.member2, room.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	if got := mentionCount(t, env, r.member2, room.ID); got != 0 {
		t.Errorf("mention_count after rejoining = %d, want 0", got)
	}
}

func TestMentionInThread(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)
	root := send(t, env, r.member, room.ID, "親")
	markRead(t, env, r.admin, room.ID)
	markRead(t, env, r.member2, room.ID)

	t.Run("a personal mention in a thread reply counts and joins the thread", func(t *testing.T) {
		reply(t, env, r.member, room.ID, root.ID, at(r.admin)+" これ見て")
		if got := mentionCount(t, env, r.admin, room.ID); got != 1 {
			t.Errorf("mention_count = %d, want 1", got)
		}
		threads, err := env.Service.ListThreads(t.Context(), r.admin, r.ws.ID, chat.PageRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if len(threads.Items) != 1 || threads.Items[0].Root.ID != root.ID {
			t.Fatalf("followed threads = %+v, want the mentioned thread", threads.Items)
		}
		// 既読位置はその返信の 1 つ前なので、メンションされた返信だけが未読になる。
		if threads.Items[0].UnreadCount != 1 {
			t.Errorf("thread unread = %d, want 1", threads.Items[0].UnreadCount)
		}
	})

	// スレッドだけの返信の @channel / @here は誰にも通知しない（Slack と同じ。ADR 0041）。
	t.Run("@channel in a thread-only reply counts for nobody", func(t *testing.T) {
		reply(t, env, r.member, room.ID, root.ID, "<!channel> <!here> スレッドの中")
		if got := mentionCount(t, env, r.member2, room.ID); got != 0 {
			t.Errorf("member2's mention_count = %d, want 0", got)
		}
	})

	t.Run("@channel in a reply that also goes to the channel counts for everyone", func(t *testing.T) {
		broadcastReply(t, env, r.member, room.ID, root.ID, "<!channel> チャンネルにも")
		if got := mentionCount(t, env, r.member2, room.ID); got != 1 {
			t.Errorf("member2's mention_count = %d, want 1", got)
		}
	})
}

// 同じルームに多数の goroutine が同時に @channel を送っても、件数がずれずデッドロックしない
// （ロードマップ Phase 6.13 の DoD）。行を積む形なので、増やすために取り合う行がない。
func TestSendChannelMentionConcurrent(t *testing.T) {
	env := chattest.New(t)
	r, room := mentionRoom(t, env)

	const n = 50
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, errs[i] = env.Service.SendMessage(t.Context(), r.member, room.ID,
				chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "<!channel> 一斉"})
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("send %d: %v", i, err)
		}
	}
	if got := mentionCount(t, env, r.member2, room.ID); got != n {
		t.Errorf("mention_count = %d, want %d", got, n)
	}
	if got := mentionCount(t, env, r.member, room.ID); got != 0 {
		t.Errorf("sender's mention_count = %d, want 0", got)
	}
}
