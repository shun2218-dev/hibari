package chat_test

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// スレッド（ADR 0036）。

func reply(t *testing.T, env *chattest.Env, actor, roomID, rootID ulid.ULID, body string) chat.Message {
	t.Helper()
	msg, created, err := env.Service.SendMessage(t.Context(), actor, roomID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: body, ThreadRootID: &rootID})
	if err != nil || !created {
		t.Fatalf("reply: created=%v err=%v", created, err)
	}
	return msg
}

// rootOf はスレッドの親を読み直す（返信数の確認用）。
func rootOf(t *testing.T, env *chattest.Env, actor, roomID, rootID ulid.ULID) chat.Message {
	t.Helper()
	page, err := env.Service.ListThreadMessages(t.Context(), actor, roomID, rootID, chat.ThreadQuery{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	return page.Root
}

func threadsOf(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID) []chat.FollowedThread {
	t.Helper()
	page, err := env.Service.ListThreads(t.Context(), actor, workspaceID, chat.PageRequest{})
	if err != nil {
		t.Fatal(err)
	}
	return page.Items
}

func unreadThreads(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID) int64 {
	t.Helper()
	n, err := env.Service.UnreadThreadCount(t.Context(), actor, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSendThreadReply(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.JoinRoom(t.Context(), r.admin, room.ID); err != nil {
		t.Fatal(err)
	}
	root := send(t, env, r.member, room.ID, "親")
	before, err := env.Service.GetRoom(t.Context(), r.admin, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	baseSeq, baseChange := roomLastMessageSeq(t, env, room.ID), roomLastChangeSeq(t, env, room.ID)

	env.Clock.Advance(time.Minute)
	first := reply(t, env, r.member2, room.ID, root.ID, "返信 1")
	second := reply(t, env, r.member2, room.ID, root.ID, "返信 2")

	t.Run("replies use the room seq and change_seq", func(t *testing.T) {
		// 返信は seq を 1 つ、change_seq を 2 つ（返信と親）使う。
		if first.Seq != baseSeq+1 || first.ChangeSeq != baseChange+1 || second.Seq != baseSeq+2 || second.ChangeSeq != baseChange+3 {
			t.Errorf("seq/change_seq = (%d,%d) (%d,%d), want (%d,%d) (%d,%d)",
				first.Seq, first.ChangeSeq, second.Seq, second.ChangeSeq, baseSeq+1, baseChange+1, baseSeq+2, baseChange+3)
		}
		if first.ThreadRootID == nil || *first.ThreadRootID != root.ID || first.ThreadSeq == nil || *first.ThreadSeq != 1 || *second.ThreadSeq != 2 {
			t.Errorf("thread fields = %v/%v, %v", first.ThreadRootID, first.ThreadSeq, second.ThreadSeq)
		}
		if first.Thread != nil {
			t.Errorf("a reply must not have a thread summary: %+v", first.Thread)
		}
	})

	t.Run("the root carries the summary and moves in the change stream", func(t *testing.T) {
		got := rootOf(t, env, r.member, room.ID, root.ID)
		if got.Thread == nil || got.Thread.ReplyCount != 2 || got.Thread.LastThreadSeq != 2 || !got.Thread.LastReplyAt.Equal(env.Clock.Now()) {
			t.Fatalf("root thread = %+v", got.Thread)
		}
		if got.ChangeSeq != baseChange+4 {
			t.Errorf("root change_seq = %d, want %d", got.ChangeSeq, baseChange+4)
		}
		// 再接続の差分取得（after_change_seq）には、返信も親も含まれる。
		changed := changesAfter(t, env, r.admin, room.ID, baseChange)
		var ids []ulid.ULID
		for _, m := range changed.Messages {
			ids = append(ids, m.ID)
		}
		if len(ids) != 3 || ids[0] != first.ID || ids[1] != second.ID || ids[2] != root.ID {
			t.Errorf("changed after = %v, want [first second root]", ids)
		}
	})

	t.Run("replies are not on the channel timeline", func(t *testing.T) {
		page, err := env.Service.ListMessages(t.Context(), r.admin, room.ID, chat.MessageQuery{})
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range page.Messages {
			if m.ThreadRootID != nil {
				t.Errorf("channel timeline has a reply: %+v", m)
			}
		}
		after, err := env.Service.ListMessages(t.Context(), r.admin, room.ID, chat.MessageQuery{AfterSeq: ptr(root.Seq)})
		if err != nil {
			t.Fatal(err)
		}
		if len(after.Messages) != 0 {
			t.Errorf("after_seq returned %d messages, want none (replies are hidden)", len(after.Messages))
		}
	})

	t.Run("replies do not touch channel unread, the last message or the sidebar order", func(t *testing.T) {
		after, err := env.Service.GetRoom(t.Context(), r.admin, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		if after.UnreadCount != before.UnreadCount || after.LastUserSeq != before.LastUserSeq {
			t.Errorf("unread %d -> %d, last_user_seq %d -> %d", before.UnreadCount, after.UnreadCount, before.LastUserSeq, after.LastUserSeq)
		}
		if after.LastMessage == nil || after.LastMessage.ID != root.ID {
			t.Errorf("last message = %+v, want the root", after.LastMessage)
		}
		if !equalTime(after.LastMessageAt, before.LastMessageAt) {
			t.Errorf("last_message_at %v -> %v", before.LastMessageAt, after.LastMessageAt)
		}
	})

	t.Run("the replier and the root sender follow the thread", func(t *testing.T) {
		// 返信した人は自分の返信まで既読、親の投稿者は最初の返信から未読。
		replier := threadsOf(t, env, r.member2, r.ws.ID)
		if len(replier) != 1 || replier[0].Root.ID != root.ID || replier[0].UnreadCount != 0 || replier[0].ReplyCount != 2 {
			t.Errorf("replier threads = %+v", replier)
		}
		author := threadsOf(t, env, r.member, r.ws.ID)
		if len(author) != 1 || author[0].UnreadCount != 2 || author[0].Room.ID != room.ID || author[0].Room.Name != "public" {
			t.Errorf("author threads = %+v", author)
		}
		if unreadThreads(t, env, r.member, r.ws.ID) != 1 || unreadThreads(t, env, r.member2, r.ws.ID) != 0 {
			t.Errorf("unread threads = %d / %d, want 1 / 0", unreadThreads(t, env, r.member, r.ws.ID), unreadThreads(t, env, r.member2, r.ws.ID))
		}
		// 見ているだけの人は参加しない。
		if got := threadsOf(t, env, r.admin, r.ws.ID); len(got) != 0 {
			t.Errorf("bystander threads = %+v", got)
		}
	})
}

func equalTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

func TestSendThreadReplyInvalidRoot(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	other := createRoom(t, env, r.member, r.ws.ID, "public", "other")
	root := send(t, env, r.member, room.ID, "親")
	child := reply(t, env, r.member, room.ID, root.ID, "返信")
	foreign := send(t, env, r.member, other.ID, "別のルーム")
	system := systemLog(t, env, r.member, room.ID)[0]

	before, beforeChange := roomLastMessageSeq(t, env, room.ID), roomLastChangeSeq(t, env, room.ID)
	for name, rootID := range map[string]ulid.ULID{
		"another room":   foreign.ID,
		"unknown":        env.IDs.New(),
		"a reply":        child.ID, // 入れ子にしない
		"system message": system.ID,
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x", ThreadRootID: &rootID})
			expectValidation(t, err, "thread_root_id", chat.ReasonInvalidValue)
			// 拒否された送信は seq も change_seq も消費しない。
			if roomLastMessageSeq(t, env, room.ID) != before || roomLastChangeSeq(t, env, room.ID) != beforeChange {
				t.Errorf("seq/change_seq moved to %d/%d", roomLastMessageSeq(t, env, room.ID), roomLastChangeSeq(t, env, room.ID))
			}
		})
	}
}

func TestSendThreadReplyToDeletedRoot(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	root := send(t, env, r.member, room.ID, "親")
	reply(t, env, r.member, room.ID, root.ID, "前の返信")
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, root.ID); err != nil {
		t.Fatal(err)
	}
	// 削除と返信は並行して起きうるので、削除済みの親にも返信できる（ADR 0036）。スレッドは残る。
	reply(t, env, r.member, room.ID, root.ID, "遅れた返信")
	page, err := env.Service.ListThreadMessages(t.Context(), r.member, room.ID, root.ID, chat.ThreadQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Root.DeletedAt == nil || page.Root.Body != "" || len(page.Replies) != 2 || page.Root.Thread == nil || page.Root.Thread.ReplyCount != 2 {
		t.Errorf("thread of deleted root = root %+v, %d replies", page.Root, len(page.Replies))
	}
}

func TestSendThreadReplyIdempotent(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	root := send(t, env, r.member, room.ID, "親")
	in := chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "返信", ThreadRootID: &root.ID}

	// 同じ client_msg_id の再送で、スレッドに二重投稿されない（Phase 6.5 の DoD）。
	const n = 10
	var wg sync.WaitGroup
	var mu sync.Mutex
	created := 0
	for range n {
		wg.Go(func() {
			_, c, err := env.Service.SendMessage(t.Context(), r.member, room.ID, in)
			if err != nil {
				t.Errorf("SendMessage() error = %v", err)
				return
			}
			if c {
				mu.Lock()
				created++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	got := rootOf(t, env, r.member, room.ID, root.ID)
	if created != 1 || got.Thread == nil || got.Thread.ReplyCount != 1 || got.Thread.LastThreadSeq != 1 {
		t.Errorf("created = %d, thread = %+v; want one reply", created, got.Thread)
	}
}

// 50 goroutine で同じスレッドに同時に返信しても、thread_seq に欠番も重複もない（Phase 6.5 の DoD）。
func TestSendThreadReplyConcurrent(t *testing.T) {
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

	const n = 50
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range n {
		wg.Go(func() {
			<-start
			if _, _, err := env.Service.SendMessage(t.Context(), users[i%len(users)], room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "並行", ThreadRootID: &root.ID}); err != nil {
				t.Errorf("SendMessage() error = %v", err)
			}
		})
	}
	close(start)
	wg.Wait()

	rows, err := env.Pool.Query(t.Context(), `SELECT thread_seq FROM messages WHERE thread_root_id = $1 ORDER BY seq`, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var want int64
	for rows.Next() {
		var seq int64
		if err := rows.Scan(&seq); err != nil {
			t.Fatal(err)
		}
		want++
		// seq の順と thread_seq の順は一致する（どちらも親の行ロックの中で採番する）。
		if seq != want {
			t.Fatalf("thread_seq %d found where %d was expected (gap, duplicate or out of order)", seq, want)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	got := rootOf(t, env, users[0], room.ID, root.ID)
	if want != n || got.Thread == nil || got.Thread.LastThreadSeq != n || got.Thread.ReplyCount != n {
		t.Errorf("replies = %d, thread = %+v; want %d", want, got.Thread, n)
	}
}

// 返信の削除と、同じ親への返信・親の編集が並行しても、デッドロックにならず、返信数が合う。
func TestDeleteThreadReplyConcurrent(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	root := send(t, env, r.member, room.ID, "親")
	const n = 20
	replies := make([]chat.Message, n)
	for i := range replies {
		replies[i] = reply(t, env, r.member, room.ID, root.ID, "消される")
	}

	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, replies[i].ID); err != nil {
				t.Errorf("DeleteMessage() error = %v", err)
			}
		})
		wg.Go(func() {
			if _, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "新しい", ThreadRootID: &root.ID}); err != nil {
				t.Errorf("SendMessage() error = %v", err)
			}
		})
		wg.Go(func() {
			if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, root.ID, env.IDs.New().String()); err != nil {
				t.Errorf("EditMessage() error = %v", err)
			}
		})
	}
	wg.Wait()

	got := rootOf(t, env, r.member, room.ID, root.ID)
	// 表示用の返信数は削除で減り、未読のカウンタは減らない。
	if got.Thread == nil || got.Thread.ReplyCount != n || got.Thread.LastThreadSeq != 2*n {
		t.Errorf("thread = %+v, want reply_count %d and last_thread_seq %d", got.Thread, n, 2*n)
	}
}

func TestDeleteThreadReply(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	root := send(t, env, r.member, room.ID, "親")
	first := reply(t, env, r.member, room.ID, root.ID, "返信 1")
	reply(t, env, r.member, room.ID, root.ID, "返信 2")
	baseChange := roomLastChangeSeq(t, env, room.ID)

	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	// 削除した返信と親の 2 つの change_seq を使う。親の返信数の変化も同期に載る。
	changed := changesAfter(t, env, r.member, room.ID, baseChange)
	if len(changed.Messages) != 2 || changed.Messages[0].ID != first.ID || changed.Messages[0].DeletedAt == nil || changed.Messages[1].ID != root.ID {
		t.Fatalf("changed after delete = %+v", changed.Messages)
	}
	if th := changed.Messages[1].Thread; th == nil || th.ReplyCount != 1 || th.LastThreadSeq != 2 {
		t.Errorf("root thread after delete = %+v", th)
	}
	// 削除済みへの削除は冪等で、返信数をもう一度減らさない。
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if th := rootOf(t, env, r.member, room.ID, root.ID).Thread; th.ReplyCount != 1 {
		t.Errorf("reply_count after second delete = %d, want 1", th.ReplyCount)
	}
}

func TestListThreadMessages(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	root := send(t, env, r.member, public.ID, "親")
	var replies []chat.Message
	for range 5 {
		replies = append(replies, reply(t, env, r.member, public.ID, root.ID, "返信"))
	}
	privateRoot := send(t, env, r.member, private.ID, "非公開の親")

	t.Run("pages by seq", func(t *testing.T) {
		page, err := env.Service.ListThreadMessages(t.Context(), r.member, public.ID, root.ID, chat.ThreadQuery{Limit: 2})
		if err != nil {
			t.Fatal(err)
		}
		if page.Root.ID != root.ID || !page.HasMore || !equalSeqs(seqsOf(page.Replies), replies[3].Seq, replies[4].Seq) {
			t.Fatalf("latest page = root %s, has_more %v, seqs %v", page.Root.ID, page.HasMore, seqsOf(page.Replies))
		}
		older, err := env.Service.ListThreadMessages(t.Context(), r.member, public.ID, root.ID, chat.ThreadQuery{BeforeSeq: ptr(replies[3].Seq), Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		if older.HasMore || !equalSeqs(seqsOf(older.Replies), replies[0].Seq, replies[1].Seq, replies[2].Seq) {
			t.Errorf("older page = has_more %v, seqs %v", older.HasMore, seqsOf(older.Replies))
		}
		newer, err := env.Service.ListThreadMessages(t.Context(), r.member, public.ID, root.ID, chat.ThreadQuery{AfterSeq: ptr(replies[3].Seq)})
		if err != nil {
			t.Fatal(err)
		}
		if newer.HasMore || !equalSeqs(seqsOf(newer.Replies), replies[4].Seq) {
			t.Errorf("newer page = has_more %v, seqs %v", newer.HasMore, seqsOf(newer.Replies))
		}
		if page.LastReadThreadSeq == nil || *page.LastReadThreadSeq != 5 {
			t.Errorf("last_read_thread_seq = %v, want 5 (own replies)", page.LastReadThreadSeq)
		}
	})

	t.Run("anyone who can read the room can read the thread, but only members can reply", func(t *testing.T) {
		// public は参加していなくても読める（スレッドのための権限は持たない）。
		page, err := env.Service.ListThreadMessages(t.Context(), r.member2, public.ID, root.ID, chat.ThreadQuery{})
		if err != nil || len(page.Replies) != 5 || page.LastReadThreadSeq != nil {
			t.Errorf("non-member read = %d replies, last read %v, err %v", len(page.Replies), page.LastReadThreadSeq, err)
		}
		_, _, err = env.Service.SendMessage(t.Context(), r.member2, public.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x", ThreadRootID: &root.ID})
		if !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("non-member reply error = %v, want ErrForbidden", err)
		}
		if _, err := env.Service.ListThreadMessages(t.Context(), r.member2, private.ID, privateRoot.ID, chat.ThreadQuery{}); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("private thread read by outsider error = %v, want ErrNotFound", err)
		}
	})

	t.Run("a reply or a system message is not a thread", func(t *testing.T) {
		for name, id := range map[string]ulid.ULID{"reply": replies[0].ID, "system": systemLog(t, env, r.member, public.ID)[0].ID, "unknown": env.IDs.New()} {
			if _, err := env.Service.ListThreadMessages(t.Context(), r.member, public.ID, id, chat.ThreadQuery{}); !errors.Is(err, chat.ErrNotFound) {
				t.Errorf("%s: error = %v, want ErrNotFound", name, err)
			}
		}
		// 別のルームの ID で親を指定しても見つからない。
		if _, err := env.Service.ListThreadMessages(t.Context(), r.member, private.ID, root.ID, chat.ThreadQuery{}); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("root in another room error = %v, want ErrNotFound", err)
		}
	})

	t.Run("rejects conflicting cursors", func(t *testing.T) {
		_, err := env.Service.ListThreadMessages(t.Context(), r.member, public.ID, root.ID, chat.ThreadQuery{BeforeSeq: ptr[int64](1), AfterSeq: ptr[int64](1)})
		expectValidation(t, err, "before_seq", chat.ReasonInvalidValue)
	})
}

func TestMarkThreadRead(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.JoinRoom(t.Context(), r.admin, room.ID); err != nil {
		t.Fatal(err)
	}
	root := send(t, env, r.member, room.ID, "親")
	first := reply(t, env, r.member2, room.ID, root.ID, "返信 1")
	reply(t, env, r.member2, room.ID, root.ID, "返信 2")
	// 返信の間にチャンネルの投稿が挟まっても、seq から thread_seq を正しく引く。
	channel := send(t, env, r.member2, room.ID, "チャンネル")
	last := reply(t, env, r.member2, room.ID, root.ID, "返信 3")

	st, err := env.Service.MarkThreadRead(t.Context(), r.member, room.ID, root.ID, first.Seq)
	if err != nil || !st.Following || st.LastReadThreadSeq != 1 || st.UnreadCount != 2 {
		t.Errorf("read to first = %+v, %v", st, err)
	}
	st, err = env.Service.MarkThreadRead(t.Context(), r.member, room.ID, root.ID, channel.Seq)
	if err != nil || st.LastReadThreadSeq != 2 || st.UnreadCount != 1 {
		t.Errorf("read to channel seq = %+v, %v", st, err)
	}
	// 後退させない。
	st, err = env.Service.MarkThreadRead(t.Context(), r.member, room.ID, root.ID, 0)
	if err != nil || st.LastReadThreadSeq != 2 {
		t.Errorf("read backwards = %+v, %v", st, err)
	}
	st, err = env.Service.MarkThreadRead(t.Context(), r.member, room.ID, root.ID, last.Seq)
	if err != nil || st.UnreadCount != 0 || unreadThreads(t, env, r.member, r.ws.ID) != 0 {
		t.Errorf("read to last = %+v, %v", st, err)
	}
	// 参加していない人が開いても、エラーにせず何もしない。
	st, err = env.Service.MarkThreadRead(t.Context(), r.admin, room.ID, root.ID, last.Seq)
	if err != nil || st.Following {
		t.Errorf("non-follower read = %+v, %v", st, err)
	}
	// スレッドの既読はチャンネルの既読を動かさない。
	if got := lastReadSeq(t, env, room.ID, r.member); got >= channel.Seq {
		t.Errorf("channel last_read_seq = %d, want it to stay before %d", got, channel.Seq)
	}
}

func TestThreadFollowGoneWhenLeavingRoom(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	if err := env.Service.AddRoomMember(t.Context(), r.member, room.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	root := send(t, env, r.member, room.ID, "親")
	reply(t, env, r.member2, room.ID, root.ID, "返信")
	if len(threadsOf(t, env, r.member2, r.ws.ID)) != 1 {
		t.Fatal("member2 should follow the thread")
	}
	// ルームから外れると、そのルームのスレッドは参加中の一覧と未読から消える（room_members への FK の CASCADE）。
	if err := env.Service.RemoveRoomMember(t.Context(), r.member2, room.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	if got := threadsOf(t, env, r.member2, r.ws.ID); len(got) != 0 {
		t.Errorf("threads after leaving = %+v", got)
	}
	// 親の投稿者が抜けた後の最初の返信では、投稿者は参加しない。
	other := send(t, env, r.member, room.ID, "別の親")
	if err := env.Service.AddRoomMember(t.Context(), r.member, room.ID, r.admin); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.RemoveRoomMember(t.Context(), r.member, room.ID, r.member); err != nil {
		t.Fatal(err)
	}
	reply(t, env, r.admin, room.ID, other.ID, "抜けた人の投稿への返信")
	if got := threadsOf(t, env, r.member, r.ws.ID); len(got) != 0 {
		t.Errorf("threads of a sender who left = %+v", got)
	}
}

func TestListThreads(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	var roots []chat.Message
	for i := range 3 {
		env.Clock.Advance(time.Minute)
		roots = append(roots, send(t, env, r.member, room.ID, "親"))
		reply(t, env, r.member, room.ID, roots[i].ID, "返信")
	}
	env.Clock.Advance(time.Minute)
	dmRoot := send(t, env, r.member, dm.ID, "DM の親")
	reply(t, env, r.member2, dm.ID, dmRoot.ID, "DM の返信")
	// 古いスレッドに返信があると、先頭に来る。
	env.Clock.Advance(time.Minute)
	reply(t, env, r.member, room.ID, roots[0].ID, "また返信")

	first, err := env.Service.ListThreads(t.Context(), r.member, r.ws.ID, chat.PageRequest{Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 3 || first.NextCursor == nil ||
		first.Items[0].Root.ID != roots[0].ID || first.Items[1].Root.ID != dmRoot.ID || first.Items[2].Root.ID != roots[2].ID {
		t.Fatalf("first page = %+v (next %v)", first.Items, first.NextCursor)
	}
	if dmItem := first.Items[1]; dmItem.Room.Kind != "dm" || dmItem.Room.DMPeer == nil || dmItem.Room.DMPeer.ID != r.member2 || dmItem.UnreadCount != 1 {
		t.Errorf("dm thread = %+v", dmItem)
	}
	second, err := env.Service.ListThreads(t.Context(), r.member, r.ws.ID, chat.PageRequest{After: *first.NextCursor, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 1 || second.Items[0].Root.ID != roots[1].ID || second.NextCursor != nil {
		t.Errorf("second page = %+v (next %v)", second.Items, second.NextCursor)
	}
	// ワークスペースのメンバーでなければ見つからない。
	if _, err := env.Service.ListThreads(t.Context(), r.outsider, r.ws.ID, chat.PageRequest{}); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("outsider error = %v, want ErrNotFound", err)
	}
}
