package chat_test

import (
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// チャンネルにも投稿する（ADR 0039）。

func broadcastReply(t *testing.T, env *chattest.Env, actor, roomID, rootID ulid.ULID, body string) chat.Message {
	t.Helper()
	msg, created, err := env.Service.SendMessage(t.Context(), actor, roomID,
		chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: body, ThreadRootID: &rootID, AlsoInChannel: true})
	if err != nil || !created {
		t.Fatalf("broadcast reply: created=%v err=%v", created, err)
	}
	return msg
}

func idsOf(msgs []chat.Message) []ulid.ULID {
	ids := make([]ulid.ULID, len(msgs))
	for i, m := range msgs {
		ids[i] = m.ID
	}
	return ids
}

func equalIDs(a []ulid.ULID, b ...ulid.ULID) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestSendThreadReplyAlsoInChannel(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	for _, u := range []ulid.ULID{r.member2, r.admin} {
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	root := send(t, env, r.member, room.ID, "親")
	before, err := env.Service.GetRoom(t.Context(), r.admin, room.ID)
	if err != nil {
		t.Fatal(err)
	}

	env.Clock.Advance(time.Minute)
	broadcast := broadcastReply(t, env, r.member2, room.ID, root.ID, "チャンネルにも")
	broadcastAt := env.Clock.Now()
	env.Clock.Advance(time.Minute)
	plain := reply(t, env, r.member2, room.ID, root.ID, "スレッドだけ")

	t.Run("only the broadcast reply carries the flag", func(t *testing.T) {
		if !broadcast.AlsoInChannel || plain.AlsoInChannel || root.AlsoInChannel {
			t.Errorf("also_in_channel = broadcast %v, plain %v, root %v", broadcast.AlsoInChannel, plain.AlsoInChannel, root.AlsoInChannel)
		}
		if broadcast.ThreadRootID == nil || *broadcast.ThreadRootID != root.ID || broadcast.ThreadSeq == nil || *broadcast.ThreadSeq != 1 {
			t.Errorf("broadcast thread fields = %v / %v", broadcast.ThreadRootID, broadcast.ThreadSeq)
		}
	})

	t.Run("the channel timeline has the broadcast reply but not the plain one", func(t *testing.T) {
		latest, err := env.Service.ListMessages(t.Context(), r.admin, room.ID, chat.MessageQuery{})
		if err != nil {
			t.Fatal(err)
		}
		msgs := userMessagesOf(latest.Messages)
		if !equalIDs(idsOf(msgs), root.ID, broadcast.ID) || !msgs[1].AlsoInChannel {
			t.Errorf("latest page = %v, want [root broadcast]", idsOf(msgs))
		}
		after, err := env.Service.ListMessages(t.Context(), r.admin, room.ID, chat.MessageQuery{AfterSeq: ptr(root.Seq)})
		if err != nil {
			t.Fatal(err)
		}
		if !equalIDs(idsOf(after.Messages), broadcast.ID) {
			t.Errorf("after_seq = %v, want [broadcast]", idsOf(after.Messages))
		}
		older, err := env.Service.ListMessages(t.Context(), r.admin, room.ID, chat.MessageQuery{BeforeSeq: ptr(plain.Seq + 1), Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		if !equalIDs(idsOf(older.Messages), broadcast.ID) {
			t.Errorf("before_seq = %v, want [broadcast]", idsOf(older.Messages))
		}
	})

	t.Run("both replies are in the thread", func(t *testing.T) {
		page, err := env.Service.ListThreadMessages(t.Context(), r.admin, room.ID, root.ID, chat.ThreadQuery{})
		if err != nil {
			t.Fatal(err)
		}
		if !equalIDs(idsOf(page.Replies), broadcast.ID, plain.ID) || page.Root.Thread == nil || page.Root.Thread.ReplyCount != 2 {
			t.Errorf("thread = %v (root %+v)", idsOf(page.Replies), page.Root.Thread)
		}
	})

	t.Run("the broadcast reply counts as a channel post", func(t *testing.T) {
		after, err := env.Service.GetRoom(t.Context(), r.admin, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		// 未読・サイドバーの並び・最後の 1 行は、流した返信の分だけ動き、スレッドだけの返信では動かない。
		if after.LastUserSeq != before.LastUserSeq+1 || after.UnreadCount != before.UnreadCount+1 {
			t.Errorf("last_user_seq %d -> %d, unread %d -> %d", before.LastUserSeq, after.LastUserSeq, before.UnreadCount, after.UnreadCount)
		}
		if broadcast.UserSeq != after.LastUserSeq || plain.UserSeq != after.LastUserSeq {
			t.Errorf("user_seq = broadcast %d, plain %d; want both %d", broadcast.UserSeq, plain.UserSeq, after.LastUserSeq)
		}
		if after.LastMessageAt == nil || !after.LastMessageAt.Equal(broadcastAt) {
			t.Errorf("last_message_at = %v, want %v", after.LastMessageAt, broadcastAt)
		}
		if after.LastMessage == nil || after.LastMessage.ID != broadcast.ID {
			t.Errorf("last message = %+v, want the broadcast reply", after.LastMessage)
		}
	})

	t.Run("the sender has read the channel up to the broadcast reply", func(t *testing.T) {
		if got := lastReadSeq(t, env, room.ID, r.member2); got != broadcast.Seq {
			t.Errorf("sender's last_read_seq = %d, want %d", got, broadcast.Seq)
		}
		sender, err := env.Service.GetRoom(t.Context(), r.member2, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		if sender.UnreadCount != 0 {
			t.Errorf("sender's unread = %d, want 0", sender.UnreadCount)
		}
	})

	t.Run("thread unread counts the broadcast reply as usual", func(t *testing.T) {
		author := threadsOf(t, env, r.member, r.ws.ID)
		if len(author) != 1 || author[0].UnreadCount != 2 {
			t.Errorf("author threads = %+v", author)
		}
		if replier := threadsOf(t, env, r.member2, r.ws.ID); len(replier) != 1 || replier[0].UnreadCount != 0 {
			t.Errorf("replier threads = %+v", replier)
		}
	})

	t.Run("deleting the broadcast reply takes it out of the sidebar", func(t *testing.T) {
		if err := env.Service.DeleteMessage(t.Context(), r.member2, room.ID, broadcast.ID); err != nil {
			t.Fatal(err)
		}
		got, err := env.Service.GetRoom(t.Context(), r.admin, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		// 削除されていない最後のチャンネルの行（ADR 0038）に戻る。スレッドだけの返信は出てこない。
		if got.LastMessage == nil || got.LastMessage.ID != root.ID {
			t.Errorf("last message = %+v, want the root", got.LastMessage)
		}
		if r := rootOf(t, env, r.member, room.ID, root.ID); r.Thread == nil || r.Thread.ReplyCount != 1 {
			t.Errorf("root thread = %+v, want 1 reply left", r.Thread)
		}
	})
}

// 親を削除しても、チャンネルに流した返信は残る（返信には触らない。ADR 0036 / 0039）。
func TestBroadcastReplyStaysWhenRootIsDeleted(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	root := send(t, env, r.member, room.ID, "親")
	broadcast := broadcastReply(t, env, r.member, room.ID, root.ID, "チャンネルにも")
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, root.ID); err != nil {
		t.Fatal(err)
	}
	page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AfterSeq: ptr(root.Seq - 1)})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 2 || page.Messages[0].DeletedAt == nil || page.Messages[1].ID != broadcast.ID || page.Messages[1].DeletedAt != nil {
		t.Errorf("channel = %+v, want [deleted root, broadcast]", page.Messages)
	}
	got, err := env.Service.GetRoom(t.Context(), r.member, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastMessage == nil || got.LastMessage.ID != broadcast.ID {
		t.Errorf("last message = %+v, want the broadcast reply", got.LastMessage)
	}
}

func TestSendAlsoInChannelRequiresThread(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	before, beforeChange := roomLastMessageSeq(t, env, room.ID), roomLastChangeSeq(t, env, room.ID)

	_, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x", AlsoInChannel: true})
	expectValidation(t, err, "also_in_channel", chat.ReasonInvalidValue)
	if roomLastMessageSeq(t, env, room.ID) != before || roomLastChangeSeq(t, env, room.ID) != beforeChange {
		t.Errorf("seq/change_seq moved to %d/%d", roomLastMessageSeq(t, env, room.ID), roomLastChangeSeq(t, env, room.ID))
	}
}

// フラグは最初の送信で決まる。同じ client_msg_id で also_in_channel だけ変えた再送は、最初の行を返す（ADR 0039）。
func TestBroadcastReplyIdempotent(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	root := send(t, env, r.member, room.ID, "親")
	in := chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "返信", ThreadRootID: &root.ID, AlsoInChannel: true}
	first, created, err := env.Service.SendMessage(t.Context(), r.member, room.ID, in)
	if err != nil || !created {
		t.Fatalf("first = created %v, error %v", created, err)
	}
	lastUserSeq := first.UserSeq

	in.AlsoInChannel = false
	again, created, err := env.Service.SendMessage(t.Context(), r.member, room.ID, in)
	if err != nil || created || again.ID != first.ID || !again.AlsoInChannel {
		t.Fatalf("retry = %+v, created %v, error %v; want the first reply", again, created, err)
	}
	got, err := env.Service.GetRoom(t.Context(), r.member, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastUserSeq != lastUserSeq {
		t.Errorf("last_user_seq = %d, want %d (the retry must not count again)", got.LastUserSeq, lastUserSeq)
	}
}

// チャンネルの投稿・流す返信・スレッドだけの返信を並行して送っても、user_seq は流す返信とチャンネルの投稿の分だけ、欠番も重複もなく進む。
func TestBroadcastReplyConcurrent(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 5)
	ws := env.CreateWorkspace(t, users[0])
	room := createRoom(t, env, users[0], ws.ID, "public", "public")
	for _, u := range users[1:] {
		env.AddMember(t, ws.ID, u, "member")
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	root := send(t, env, users[0], room.ID, "親")
	base, err := env.Service.GetRoom(t.Context(), users[0], room.ID)
	if err != nil {
		t.Fatal(err)
	}

	const n = 50
	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		inChannel []chat.Message
	)
	for i := range n {
		wg.Go(func() {
			in := chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x"}
			switch i % 3 {
			case 1:
				in.ThreadRootID = &root.ID
				in.AlsoInChannel = true
			case 2:
				in.ThreadRootID = &root.ID
			}
			msg, _, err := env.Service.SendMessage(t.Context(), users[i%len(users)], room.ID, in)
			if err != nil {
				t.Errorf("SendMessage() error = %v", err)
				return
			}
			if msg.ThreadRootID == nil || msg.AlsoInChannel {
				mu.Lock()
				inChannel = append(inChannel, msg)
				mu.Unlock()
			}
		})
	}
	wg.Wait()

	got, err := env.Service.GetRoom(t.Context(), users[0], room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastUserSeq != base.LastUserSeq+int64(len(inChannel)) {
		t.Errorf("last_user_seq = %d, want %d", got.LastUserSeq, base.LastUserSeq+int64(len(inChannel)))
	}
	seen := make(map[int64]bool)
	for _, m := range inChannel {
		if m.UserSeq <= base.LastUserSeq || m.UserSeq > got.LastUserSeq || seen[m.UserSeq] {
			t.Errorf("user_seq %d is out of range or duplicated", m.UserSeq)
		}
		seen[m.UserSeq] = true
	}
	page, err := env.Service.ListMessages(t.Context(), users[0], room.ID, chat.MessageQuery{AfterSeq: ptr(root.Seq), Limit: chat.MaxMessageLimit})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != len(inChannel) {
		t.Errorf("channel has %d messages after the root, want %d", len(page.Messages), len(inChannel))
	}
}
