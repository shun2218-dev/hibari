package chat_test

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

func send(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID, body string) chat.Message {
	t.Helper()
	msg, created, err := env.Service.SendMessage(t.Context(), actor, roomID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: body})
	if err != nil || !created {
		t.Fatalf("SendMessage(%q) = created %v, error %v", body, created, err)
	}
	return msg
}

// roomLastMessageSeq はルームの last_message_seq を返す。ルームがなければ -1。
func roomLastMessageSeq(t *testing.T, env *chattest.Env, roomID ulid.ULID) int64 {
	t.Helper()
	var seq int64
	if err := env.Pool.QueryRow(t.Context(), `SELECT coalesce((SELECT last_message_seq FROM rooms WHERE id = $1), -1)`, roomID).Scan(&seq); err != nil {
		t.Fatal(err)
	}
	return seq
}

// userMessageCount は人の発言だけを数える。システムメッセージ（ADR 0033）も messages の行なので、
// 「送信が何件増えたか」を見たいときは全行ではなくこちらを数える。
func userMessageCount(t *testing.T, env *chattest.Env, roomID ulid.ULID) int {
	t.Helper()
	var n int
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM messages WHERE room_id = $1 AND kind = 'user'`, roomID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// userMessagesOf は一覧から人の発言だけを取り出す。参加や作成のログ（ADR 0033）が混ざる一覧で、
// 元々の検査の対象だけを見るために使う。
func userMessagesOf(msgs []chat.Message) []chat.Message {
	out := make([]chat.Message, 0, len(msgs))
	for _, m := range msgs {
		if m.Kind == chat.MessageKindUser {
			out = append(out, m)
		}
	}
	return out
}

func seqsOf(msgs []chat.Message) []int64 {
	seqs := make([]int64, len(msgs))
	for i, m := range msgs {
		seqs[i] = m.Seq
	}
	return seqs
}

func equalSeqs(a []int64, b ...int64) bool {
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

func TestSendMessage(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	if _, err := env.Service.JoinRoom(t.Context(), r.admin, public.ID); err != nil {
		t.Fatal(err)
	}
	// ルームの作成と参加のログ（ADR 0033）が seq を消費しているので、以降は base からの相対で見る。
	base := roomLastMessageSeq(t, env, public.ID)
	adminRead := lastReadSeq(t, env, public.ID, r.admin)

	env.Clock.Advance(time.Minute)
	clientMsgID := env.IDs.New()
	msg, created, err := env.Service.SendMessage(t.Context(), r.member, public.ID, chat.SendMessageInput{ClientMsgID: clientMsgID, Body: "  字下げを保つ\n2 行目"})
	if err != nil || !created {
		t.Fatalf("SendMessage() = created %v, error %v", created, err)
	}
	if msg.Seq != base+1 || msg.RoomID != public.ID || msg.Body != "  字下げを保つ\n2 行目" || msg.ClientMsgID != clientMsgID ||
		msg.Sender.ID != r.member || msg.Sender.DisplayName == "" || msg.ThreadRootID != nil || msg.Thread != nil || msg.Kind != chat.MessageKindUser ||
		!msg.CreatedAt.Equal(env.Clock.Now()) || msg.EditedAt != nil || msg.DeletedAt != nil {
		t.Errorf("message = %+v", msg)
	}
	// 送信者の既読位置は自分のメッセージまで進み、他のメンバーには未読になる。
	if got := lastReadSeq(t, env, public.ID, r.member); got != msg.Seq {
		t.Errorf("sender's last_read_seq = %d, want %d", got, msg.Seq)
	}
	if got := lastReadSeq(t, env, public.ID, r.admin); got != adminRead {
		t.Errorf("other member's last_read_seq = %d, want %d (unchanged)", got, adminRead)
	}

	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		room    ulid.ULID
		wantErr error
	}{
		{"public as member", r.admin, public.ID, nil},
		{"public without joining", r.owner, public.ID, chat.ErrForbidden},
		{"private as member", r.member, private.ID, nil},
		{"private as non-member owner", r.owner, private.ID, chat.ErrNotFound},
		{"dm as participant", r.member2, dm.ID, nil},
		{"dm as owner", r.owner, dm.ID, chat.ErrNotFound},
		{"outsider", r.outsider, public.ID, chat.ErrNotFound},
		{"unknown room", r.member, env.IDs.New(), chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before := roomLastMessageSeq(t, env, tt.room)
			_, _, err := env.Service.SendMessage(t.Context(), tt.actor, tt.room, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: tt.name})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("SendMessage() error = %v, want %v", err, tt.wantErr)
			}
			if err != nil && roomLastMessageSeq(t, env, tt.room) != before {
				t.Error("a rejected message consumed a seq")
			}
		})
	}

	// ワークスペースから外れたら、room_members も消えているので投稿できない。
	if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.admin); err != nil {
		t.Fatal(err)
	}
	if _, _, err := env.Service.SendMessage(t.Context(), r.admin, public.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x"}); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("kicked member error = %v, want ErrNotFound", err)
	}

	for _, tt := range []struct {
		name          string
		in            chat.SendMessageInput
		field, reason string
	}{
		{"missing client_msg_id", chat.SendMessageInput{Body: "x"}, "client_msg_id", chat.ReasonRequired},
		{"empty body", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: ""}, "body", chat.ReasonRequired},
		{"whitespace body", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: " \n\t "}, "body", chat.ReasonRequired},
		{"long body", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: strings.Repeat("あ", 4001)}, "body", chat.ReasonTooLong},
		{"control character", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "a\x00b"}, "body", chat.ReasonInvalidFormat},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := env.Service.SendMessage(t.Context(), r.member, public.ID, tt.in)
			expectValidation(t, err, tt.field, tt.reason)
		})
	}
	if _, _, err := env.Service.SendMessage(t.Context(), r.member, public.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: strings.Repeat("あ", 4000)}); err != nil {
		t.Errorf("4000-rune body error = %v", err)
	}
}

// 同じ client_msg_id で 2 回送っても、メッセージは 1 件しか増えず、seq も消費されない（ロードマップ Phase 3b の DoD）。
func TestSendMessageIdempotent(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}

	// ルームの作成と参加のログ（ADR 0033）が seq を消費しているので、以降は base からの相対で見る。
	base := roomLastMessageSeq(t, env, room.ID)

	clientMsgID := env.IDs.New()
	first, created, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: clientMsgID, Body: "1 回目"})
	if err != nil || !created {
		t.Fatalf("first send = created %v, error %v", created, err)
	}
	// 本文が違っても比べずに既存を返す。
	again, created, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: clientMsgID, Body: "2 回目"})
	if err != nil || created || again.ID != first.ID || again.Seq != base+1 || again.Body != "1 回目" {
		t.Fatalf("retry = %+v, created %v, error %v; want the first message", again, created, err)
	}
	if n := userMessageCount(t, env, room.ID); n != 1 || roomLastMessageSeq(t, env, room.ID) != base+1 {
		t.Fatalf("user messages = %d, last_message_seq = %d; want 1, %d", n, roomLastMessageSeq(t, env, room.ID), base+1)
	}
	// 他人が同じ client_msg_id を使っても、他人のメッセージは引き出せず、別のメッセージになる。
	other, created, err := env.Service.SendMessage(t.Context(), r.member2, room.ID, chat.SendMessageInput{ClientMsgID: clientMsgID, Body: "別人"})
	if err != nil || !created || other.ID == first.ID || other.Seq != base+2 {
		t.Errorf("same client_msg_id by another sender = %+v, created %v, error %v", other, created, err)
	}
	// 次の送信は欠番なく続く。
	if next := send(t, env, r.member, room.ID, "次"); next.Seq != base+3 {
		t.Errorf("next seq = %d, want %d", next.Seq, base+3)
	}
}

// 同じ client_msg_id の送信を並行に実行しても、作成は 1 回だけで、全員が同じメッセージを受け取る。
func TestSendMessageIdempotentConcurrent(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	room := createRoom(t, env, owner, ws.ID, "public", "public")
	// ルームの作成のログ（ADR 0033）が seq を 1 つ使っている。
	base := roomLastMessageSeq(t, env, room.ID)

	const n = 50
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		ids     = map[ulid.ULID]bool{}
		created int
		start   = make(chan struct{})
	)
	clientMsgID := env.IDs.New()
	for range n {
		wg.Go(func() {
			<-start
			msg, c, err := env.Service.SendMessage(t.Context(), owner, room.ID, chat.SendMessageInput{ClientMsgID: clientMsgID, Body: "同時"})
			if err != nil {
				t.Errorf("SendMessage() error = %v", err)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			ids[msg.ID] = true
			if c {
				created++
			}
		})
	}
	close(start)
	wg.Wait()

	if len(ids) != 1 || created != 1 || userMessageCount(t, env, room.ID) != 1 || roomLastMessageSeq(t, env, room.ID) != base+1 {
		t.Errorf("distinct ids = %d, created = %d, user messages = %d, last_message_seq = %d; want 1, 1, 1, %d",
			len(ids), created, userMessageCount(t, env, room.ID), roomLastMessageSeq(t, env, room.ID), base+1)
	}
}

// 50 goroutine で同じルームに同時送信しても、seq に欠番も重複もない（ロードマップ Phase 3b の DoD）。
// 再送（同じ client_msg_id）と、スレッドの親の不正でロールバックする送信を混ぜ、どちらも seq を消費しないことも確かめる。
func TestSendMessageConcurrentSeq(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 5)
	ws := env.CreateWorkspace(t, users[0])
	room := createRoom(t, env, users[0], ws.ID, "public", "public")
	otherRoom := createRoom(t, env, users[0], ws.ID, "public", "other")
	foreign := send(t, env, users[0], otherRoom.ID, "別のルーム")
	for _, u := range users[1:] {
		env.AddMember(t, ws.ID, u, authz.RoleMember)
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}

	const n = 50
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		created int
		start   = make(chan struct{})
		// 3 件に 1 件は、先に送った client_msg_id の再送にする。
		retryIDs = make([]ulid.ULID, len(users))
	)
	for i := range retryIDs {
		retryIDs[i] = env.IDs.New()
	}
	for i := range n {
		wg.Go(func() {
			<-start
			u := i % len(users)
			in := chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "並行"}
			switch i % 6 {
			case 0, 3:
				in.ClientMsgID = retryIDs[u]
			case 5:
				in.ThreadRootID = &foreign.ID // 別のルームのメッセージへの返信はロールバックされる
			}
			_, c, err := env.Service.SendMessage(t.Context(), users[u], room.ID, in)
			if in.ThreadRootID != nil {
				var verr *chat.ValidationError
				if !errors.As(err, &verr) {
					t.Errorf("reply to another room error = %v, want ValidationError", err)
				}
				return
			}
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
	close(start)
	wg.Wait()

	// 欠番の検査は全行で行う。システムメッセージ（ルームの作成・参加のログ。ADR 0033）も seq を消費するので、
	// 送信の件数と突き合わせるのは人の発言だけ。
	rows, err := env.Pool.Query(t.Context(), `SELECT seq FROM messages WHERE room_id = $1 ORDER BY seq`, room.ID)
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
		if seq != want {
			t.Fatalf("seq %d found where %d was expected (gap or duplicate)", seq, want)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if roomLastMessageSeq(t, env, room.ID) != want || userMessageCount(t, env, room.ID) != created {
		t.Errorf("messages = %d, user messages = %d, created = %d, last_message_seq = %d; want the last seq to match the row count and the sends",
			want, userMessageCount(t, env, room.ID), created, roomLastMessageSeq(t, env, room.ID))
	}
}

func TestListMessages(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	// base はルームの作成のログ（ADR 0033）の seq。一覧にはそれも含まれるので、人の発言は base+1 から並ぶ。
	base := roomLastMessageSeq(t, env, public.ID)
	for i := range 7 {
		env.Clock.Advance(time.Second)
		send(t, env, r.member, public.ID, strings.Repeat("x", i+1))
	}
	send(t, env, r.member, private.ID, "private")

	seq := func(v int64) *int64 { return &v }
	for _, tt := range []struct {
		name     string
		q        chat.MessageQuery
		wantSeqs []int64
		wantMore bool
	}{
		{"latest", chat.MessageQuery{Limit: 3}, []int64{base + 5, base + 6, base + 7}, true},
		{"latest all", chat.MessageQuery{}, []int64{base, base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7}, false},
		{"before", chat.MessageQuery{BeforeSeq: seq(base + 5), Limit: 3}, []int64{base + 2, base + 3, base + 4}, true},
		{"before exactly the rest", chat.MessageQuery{BeforeSeq: seq(base + 3), Limit: 3}, []int64{base, base + 1, base + 2}, false},
		{"before the first", chat.MessageQuery{BeforeSeq: seq(base)}, []int64{}, false},
		{"before beyond the latest", chat.MessageQuery{BeforeSeq: seq(100), Limit: 2}, []int64{base + 6, base + 7}, true},
		{"after zero", chat.MessageQuery{AfterSeq: seq(0), Limit: 3}, []int64{base, base + 1, base + 2}, true},
		{"after exactly the rest", chat.MessageQuery{AfterSeq: seq(base + 4), Limit: 3}, []int64{base + 5, base + 6, base + 7}, false},
		{"after the latest", chat.MessageQuery{AfterSeq: seq(base + 7)}, []int64{}, false},
		{"after beyond the latest", chat.MessageQuery{AfterSeq: seq(100)}, []int64{}, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			page, err := env.Service.ListMessages(t.Context(), r.owner, public.ID, tt.q)
			if err != nil {
				t.Fatal(err)
			}
			if got := seqsOf(page.Messages); !equalSeqs(got, tt.wantSeqs...) || page.HasMore != tt.wantMore {
				t.Errorf("seqs = %v (has_more %v), want %v (has_more %v)", got, page.HasMore, tt.wantSeqs, tt.wantMore)
			}
		})
	}

	page, err := env.Service.ListMessages(t.Context(), r.member2, public.ID, chat.MessageQuery{AfterSeq: seq(base + 1), Limit: 1})
	if err != nil || len(page.Messages) != 1 {
		t.Fatalf("page = %+v, %v", page, err)
	}
	if m := page.Messages[0]; m.Body != "xx" || m.Sender.ID != r.member || !m.CreatedAt.Equal(chattest.Start.Add(2*time.Second)) {
		t.Errorf("message = %+v", m)
	}

	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		room    ulid.ULID
		wantErr error
	}{
		{"public without joining", r.owner, public.ID, nil},
		{"private as non-member", r.owner, private.ID, chat.ErrNotFound},
		{"outsider", r.outsider, public.ID, chat.ErrNotFound},
	} {
		if _, err := env.Service.ListMessages(t.Context(), tt.actor, tt.room, chat.MessageQuery{}); !errors.Is(err, tt.wantErr) {
			t.Errorf("ListMessages(%s) error = %v, want %v", tt.name, err, tt.wantErr)
		}
	}

	_, err = env.Service.ListMessages(t.Context(), r.member, public.ID, chat.MessageQuery{BeforeSeq: seq(3), AfterSeq: seq(1)})
	expectValidation(t, err, "before_seq", chat.ReasonInvalidValue)
	_, err = env.Service.ListMessages(t.Context(), r.member, public.ID, chat.MessageQuery{AfterSeq: seq(-1)})
	expectValidation(t, err, "after_seq", chat.ReasonOutOfRange)
	_, err = env.Service.ListMessages(t.Context(), r.member, public.ID, chat.MessageQuery{BeforeSeq: seq(-1)})
	expectValidation(t, err, "before_seq", chat.ReasonOutOfRange)
}

func TestListMessagesLimit(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	room := createRoom(t, env, owner, ws.ID, "public", "public")
	// ルームの作成のログ（ADR 0033）がすでに seq を使っているので、その続きから入れる。
	base := roomLastMessageSeq(t, env, room.ID)
	// 送信のユースケースを 120 回通すと遅いので、seq の不変条件を満たす行を SQL で直接入れる。
	_, err := env.Pool.Exec(t.Context(), `
		WITH s AS (SELECT generate_series(1, 120) AS seq)
		INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, created_at)
		SELECT gen_random_uuid(), $1, $4 + s.seq, $4 + s.seq, s.seq, $2, gen_random_uuid(), 'bulk', $3 FROM s`,
		room.ID, owner, env.Clock.Now(), base)
	if err != nil {
		t.Fatal(err)
	}
	setLastMessageSeq(t, env, room.ID, base+120)

	for _, tt := range []struct {
		limit int
		want  int
	}{{0, chat.DefaultMessageLimit}, {-1, chat.DefaultMessageLimit}, {1000, chat.MaxMessageLimit}, {100, 100}, {7, 7}} {
		page, err := env.Service.ListMessages(t.Context(), owner, room.ID, chat.MessageQuery{Limit: tt.limit})
		if err != nil || len(page.Messages) != tt.want || !page.HasMore {
			t.Errorf("limit %d: %d messages (has_more %v), %v; want %d", tt.limit, len(page.Messages), page.HasMore, err, tt.want)
		}
	}
}

// 切断中に送られたメッセージを after_seq で順に取得すると、取りこぼしも重複もない（ADR 0004）。
// 書き込みと並行して差分を取り続け、読み手が seq の欠番を一度も観測しないことも確かめる。
// 欠番が見えないのは、seq を採番したトランザクションがコミットするまで、次の採番が rooms の行ロックで待たされるため（ADR 0002）。
func TestListMessagesAfterSeqSync(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 4)
	ws := env.CreateWorkspace(t, users[0])
	room := createRoom(t, env, users[0], ws.ID, "public", "public")
	for _, u := range users[1:] {
		env.AddMember(t, ws.ID, u, authz.RoleMember)
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	reader := users[0]
	// ルームの作成と参加のログ（ADR 0033）が seq を消費しているので、以降は base からの相対で見る。
	base := roomLastMessageSeq(t, env, room.ID)

	// 接続中に受け取った分。
	for range 3 {
		send(t, env, users[1], room.ID, "接続中")
	}
	page, err := env.Service.ListMessages(t.Context(), reader, room.ID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	lastSeq := page.Messages[len(page.Messages)-1].Seq

	const writers, perWriter = 3, 40
	var (
		wg   sync.WaitGroup
		done = make(chan struct{})
	)
	for w := range writers {
		wg.Go(func() {
			for range perWriter {
				if _, _, err := env.Service.SendMessage(t.Context(), users[w+1], room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "切断中"}); err != nil {
					t.Errorf("SendMessage() error = %v", err)
					return
				}
			}
		})
	}
	go func() {
		wg.Wait()
		close(done)
	}()

	// 書き込みが終わるまで差分を取り続け、終わった後にもう一度、続きがなくなるまで取る。
	finished := false
	for {
		select {
		case <-done:
			finished = true
		default:
		}
		for {
			page, err := env.Service.ListMessages(t.Context(), reader, room.ID, chat.MessageQuery{AfterSeq: &lastSeq, Limit: 7})
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range page.Messages {
				if m.Seq != lastSeq+1 {
					t.Fatalf("received seq %d after %d (gap or duplicate)", m.Seq, lastSeq)
				}
				lastSeq = m.Seq
			}
			if !page.HasMore {
				break
			}
		}
		if finished {
			break
		}
	}
	if want := base + int64(3+writers*perWriter); lastSeq != want {
		t.Errorf("last received seq = %d, want %d", lastSeq, want)
	}
}

func TestEditMessage(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	if _, err := env.Service.JoinRoom(t.Context(), r.owner, public.ID); err != nil {
		t.Fatal(err)
	}
	msg := send(t, env, r.member, public.ID, "元の本文")

	env.Clock.Advance(time.Minute)
	edited, err := env.Service.EditMessage(t.Context(), r.member, public.ID, msg.ID, "直した本文")
	if err != nil {
		t.Fatal(err)
	}
	if edited.Body != "直した本文" || edited.Seq != msg.Seq || edited.EditedAt == nil || !edited.EditedAt.Equal(env.Clock.Now()) || !edited.CreatedAt.Equal(msg.CreatedAt) {
		t.Errorf("edited = %+v", edited)
	}
	// 本文が変わらなければ edited_at は動かない。
	env.Clock.Advance(time.Minute)
	same, err := env.Service.EditMessage(t.Context(), r.member, public.ID, msg.ID, "直した本文")
	if err != nil || !same.EditedAt.Equal(*edited.EditedAt) {
		t.Errorf("no-op edit = %+v, %v; want edited_at unchanged", same, err)
	}

	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		room    ulid.ULID
		message ulid.ULID
		wantErr error
	}{
		{"owner on someone else's message", r.owner, public.ID, msg.ID, chat.ErrForbidden},
		{"non-member admin", r.admin, public.ID, msg.ID, chat.ErrForbidden},
		{"outsider", r.outsider, public.ID, msg.ID, chat.ErrNotFound},
		{"message id in another room", r.member, private.ID, msg.ID, chat.ErrNotFound},
		{"unknown message", r.member, public.ID, env.IDs.New(), chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := env.Service.EditMessage(t.Context(), tt.actor, tt.room, tt.message, "書き換え"); !errors.Is(err, tt.wantErr) {
				t.Errorf("EditMessage() error = %v, want %v", err, tt.wantErr)
			}
		})
	}

	_, err = env.Service.EditMessage(t.Context(), r.member, public.ID, msg.ID, " ")
	expectValidation(t, err, "body", chat.ReasonRequired)

	// ルームを抜けたら、自分のメッセージでも編集できない。
	if err := env.Service.RemoveRoomMember(t.Context(), r.member, public.ID, r.member); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.EditMessage(t.Context(), r.member, public.ID, msg.ID, "抜けた後"); !errors.Is(err, chat.ErrForbidden) {
		t.Errorf("edit after leaving error = %v, want ErrForbidden", err)
	}
	if _, err := env.Service.JoinRoom(t.Context(), r.member, public.ID); err != nil {
		t.Fatal(err)
	}

	if err := env.Service.DeleteMessage(t.Context(), r.member, public.ID, msg.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.EditMessage(t.Context(), r.member, public.ID, msg.ID, "削除の後"); !errors.Is(err, chat.ErrMessageDeleted) {
		t.Errorf("edit deleted message error = %v, want ErrMessageDeleted", err)
	}
}

func TestDeleteMessage(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	departed := env.CreateUser(t)
	env.AddMember(t, r.ws.ID, departed, authz.RoleMember)
	public := createRoom(t, env, r.owner, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	dm, _ := createDM(t, env, r.admin, r.ws.ID, r.member)
	for _, u := range []ulid.ULID{r.admin, r.admin2, r.member, r.member2, departed} {
		if _, err := env.Service.JoinRoom(t.Context(), u, public.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err := env.Service.AddRoomMember(t.Context(), r.member, private.ID, r.admin2); err != nil {
		t.Fatal(err)
	}

	msgs := map[string]chat.Message{
		"owner":    send(t, env, r.owner, public.ID, "owner"),
		"admin":    send(t, env, r.admin, public.ID, "admin"),
		"member":   send(t, env, r.member, public.ID, "member"),
		"departed": send(t, env, departed, public.ID, "departed"),
		"private":  send(t, env, r.member, private.ID, "private"),
		"dm":       send(t, env, r.member, dm.ID, "dm"),
	}
	if err := env.Service.RemoveMember(t.Context(), departed, r.ws.ID, departed); err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		message string
		wantErr error
	}{
		// 他人のメッセージは、送信者より上のロールだけが消せる。
		{"member on member's", r.member2, "member", chat.ErrForbidden},
		{"admin on admin's", r.admin2, "admin", chat.ErrForbidden},
		{"admin on owner's", r.admin, "owner", chat.ErrForbidden},
		{"admin in private on member's", r.admin2, "private", nil},
		{"owner not in private", r.owner, "private", chat.ErrNotFound},
		{"admin on peer's dm", r.admin, "dm", chat.ErrForbidden},
		{"outsider", r.outsider, "member", chat.ErrNotFound},
		{"admin on departed member's", r.admin, "departed", nil},
		{"owner on admin's", r.owner, "admin", nil},
		{"admin on member's", r.admin2, "member", nil},
		{"sender", r.owner, "owner", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			m := msgs[tt.message]
			if err := env.Service.DeleteMessage(t.Context(), tt.actor, m.RoomID, m.ID); !errors.Is(err, tt.wantErr) {
				t.Errorf("DeleteMessage() error = %v, want %v", err, tt.wantErr)
			}
		})
	}

	// 削除すると本文が消え、seq と送信者は tombstone として残る。冪等。
	env.Clock.Advance(time.Minute)
	m := msgs["member"]
	if err := env.Service.DeleteMessage(t.Context(), r.member2, m.RoomID, m.ID); !errors.Is(err, chat.ErrForbidden) {
		t.Errorf("forbidden delete of an already deleted message error = %v, want ErrForbidden", err)
	}
	page, err := env.Service.ListMessages(t.Context(), r.member2, public.ID, chat.MessageQuery{AfterSeq: ptr(m.Seq - 1), Limit: 1})
	if err != nil || len(page.Messages) != 1 {
		t.Fatalf("page = %+v, %v", page, err)
	}
	if got := page.Messages[0]; got.ID != m.ID || got.Body != "" || got.DeletedAt == nil || !got.DeletedAt.Equal(chattest.Start) || got.Sender.ID != r.member {
		t.Errorf("deleted message = %+v", got)
	}
	if err := env.Service.DeleteMessage(t.Context(), r.member, m.RoomID, m.ID); err != nil {
		t.Errorf("repeated delete error = %v", err)
	}
	if err := env.Service.DeleteMessage(t.Context(), r.member, private.ID, m.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("delete with another room id error = %v, want ErrNotFound", err)
	}
}

func TestMarkRoomReadAndUnread(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	var sent []chat.Message
	for range 5 {
		sent = append(sent, send(t, env, r.member, room.ID, "未読"))
	}
	last := sent[len(sent)-1]
	// 人の発言は 6 件目。送信者（member2）の既読位置はここまで進む。
	sent = append(sent, send(t, env, r.member2, room.ID, "自分の送信"))
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, last.ID); err != nil {
		t.Fatal(err)
	}

	// サイドバー: 最終メッセージと、削除済みも数に含めた未読数（ADR 0002）。
	rooms, err := env.Service.ListRooms(t.Context(), r.member, r.ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[ulid.ULID]chat.Room{}
	for _, room := range rooms {
		byID[room.ID] = room
	}
	got := byID[room.ID]
	if got.LastReadSeq == nil || *got.LastReadSeq != last.Seq || got.UnreadCount != 1 || got.LastMessage == nil ||
		got.LastMessage.Sender.ID != r.member2 || got.LastMessage.Body != "自分の送信" || got.LastMessage.Deleted {
		t.Errorf("room in list = %+v (last message %+v)", got, got.LastMessage)
	}
	// 人の発言のない private ルームにも作成のログだけは残る（ADR 0033）。ログは未読に数えない。
	if p := byID[private.ID]; p.LastMessage == nil || p.LastMessage.Kind != chat.MessageKindSystem ||
		p.LastMessage.System == nil || p.LastMessage.System.Type != chat.SystemRoomCreated ||
		p.UnreadCount != 0 || p.LastReadSeq == nil || *p.LastReadSeq != 0 {
		t.Errorf("private room with only the creation log = %+v (last message %+v)", p, p.LastMessage)
	}

	if _, err := env.Service.MarkRoomRead(t.Context(), r.owner, room.ID, 1); !errors.Is(err, chat.ErrForbidden) {
		t.Errorf("public non-member MarkRoomRead() error = %v, want ErrForbidden", err)
	}
	// admin は参加時点の最新を既読にして参加する。0 に戻してから順に進める。
	if _, err := env.Service.JoinRoom(t.Context(), r.admin, room.ID); err != nil {
		t.Fatal(err)
	}
	setLastReadSeq(t, env, room.ID, r.admin, 0)
	// 未読数は人の発言だけで数える（ADR 0033）ので、期待値は送ったメッセージの seq で組み立てる。
	// 最新はルームの最終 seq（admin の参加のログ）。
	latest := roomLastMessageSeq(t, env, room.ID)
	for _, tt := range []struct {
		name       string
		seq        int64
		wantRead   int64
		wantUnread int64
	}{
		{"advance", sent[2].Seq, sent[2].Seq, 3},
		{"never goes backwards", sent[0].Seq, sent[2].Seq, 3},
		{"clamped to the latest", 100, latest, 0},
	} {
		st, err := env.Service.MarkRoomRead(t.Context(), r.admin, room.ID, tt.seq)
		if err != nil || st.LastReadSeq != tt.wantRead || st.UnreadCount != tt.wantUnread {
			t.Errorf("%s: MarkRoomRead(%d) = %+v, %v; want read %d, unread %d", tt.name, tt.seq, st, err, tt.wantRead, tt.wantUnread)
		}
		got, err := env.Service.GetRoom(t.Context(), r.admin, room.ID)
		if err != nil || got.LastReadSeq == nil || *got.LastReadSeq != tt.wantRead || got.UnreadCount != tt.wantUnread {
			t.Errorf("%s: GetRoom() = %+v, %v", tt.name, got, err)
		}
	}

	_, err = env.Service.MarkRoomRead(t.Context(), r.member, room.ID, -1)
	expectValidation(t, err, "seq", chat.ReasonOutOfRange)
	if _, err := env.Service.MarkRoomRead(t.Context(), r.owner, private.ID, 1); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("private non-member error = %v, want ErrNotFound", err)
	}
	if _, err := env.Service.MarkRoomRead(t.Context(), r.outsider, room.ID, 1); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("outsider error = %v, want ErrNotFound", err)
	}
	// 参加していない public のルームは、既読位置も未読数も持たない。
	pub, err := env.Service.GetRoom(t.Context(), r.owner, room.ID)
	if err != nil || pub.LastReadSeq != nil || pub.UnreadCount != 0 || pub.LastMessage == nil {
		t.Errorf("public room as non-member = %+v, %v", pub, err)
	}
}

// setLastReadSeq は既読位置を直接書き換える。未読数の元になる last_read_user_seq（ADR 0033）も、
// その seq 以下の最大の user_seq に揃える（AdvanceLastReadSeq と同じ考え方）。
func setLastReadSeq(t *testing.T, env *chattest.Env, roomID, userID ulid.ULID, seq int64) {
	t.Helper()
	_, err := env.Pool.Exec(t.Context(), `
		UPDATE room_members
		   SET last_read_seq = $3,
		       last_read_user_seq = COALESCE((SELECT max(m.user_seq) FROM messages m WHERE m.room_id = $1 AND m.seq <= $3), 0)
		 WHERE room_id = $1 AND user_id = $2`, roomID, userID, seq)
	if err != nil {
		t.Fatal(err)
	}
}
