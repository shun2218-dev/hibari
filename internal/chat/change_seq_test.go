package chat_test

import (
	"errors"
	"math/rand/v2"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

func roomLastChangeSeq(t *testing.T, env *chattest.Env, roomID ulid.ULID) int64 {
	t.Helper()
	var seq int64
	if err := env.Pool.QueryRow(t.Context(), `SELECT last_change_seq FROM rooms WHERE id = $1`, roomID).Scan(&seq); err != nil {
		t.Fatal(err)
	}
	return seq
}

func changesAfter(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID, after int64) chat.MessagePage {
	t.Helper()
	page, err := env.Service.ListMessages(t.Context(), actor, roomID, chat.MessageQuery{AfterChangeSeq: &after})
	if err != nil {
		t.Fatal(err)
	}
	return page
}

// 作成・編集・削除のたびに change_seq が 1 ずつ進み、seq は作成のときだけ進む（ADR 0014）。
func TestChangeSeq(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")

	first := send(t, env, r.member, room.ID, "1 件目")
	second := send(t, env, r.member, room.ID, "2 件目")
	if first.Seq != 1 || first.ChangeSeq != 1 || second.Seq != 2 || second.ChangeSeq != 2 {
		t.Fatalf("created: first seq/change = %d/%d, second = %d/%d", first.Seq, first.ChangeSeq, second.Seq, second.ChangeSeq)
	}

	edited, err := env.Service.EditMessage(t.Context(), r.member, room.ID, first.ID, "1 件目（編集）")
	if err != nil {
		t.Fatal(err)
	}
	if edited.Seq != 1 || edited.ChangeSeq != 3 {
		t.Errorf("edited seq/change = %d/%d, want 1/3", edited.Seq, edited.ChangeSeq)
	}
	// 本文が変わらない編集は採番しない。
	same, err := env.Service.EditMessage(t.Context(), r.member, room.ID, first.ID, "1 件目（編集）")
	if err != nil || same.ChangeSeq != 3 {
		t.Errorf("no-op edit change_seq = %d, %v; want 3", same.ChangeSeq, err)
	}
	// 冪等な再送は採番しない。
	resent, created, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: second.ClientMsgID, Body: "2 件目"})
	if err != nil || created || resent.ChangeSeq != 2 {
		t.Errorf("resend = change %d, created %v, %v", resent.ChangeSeq, created, err)
	}

	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	// 削除済みへの削除は採番しない。
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	// 拒否された編集（他人のメッセージ）も採番しない。
	if _, err := env.Service.EditMessage(t.Context(), r.owner, room.ID, first.ID, "乗っ取り"); !errors.Is(err, chat.ErrForbidden) {
		t.Fatalf("EditMessage(other's message) error = %v", err)
	}
	if got := roomLastChangeSeq(t, env, room.ID); got != 4 {
		t.Fatalf("last_change_seq = %d, want 4", got)
	}
	if got := roomLastMessageSeq(t, env, room.ID); got != 2 {
		t.Fatalf("last_message_seq = %d, want 2 (edits and deletes must not advance seq)", got)
	}

	// 切断前に change_seq 2 まで受け取っていたクライアントは、編集（3）と削除（4）を change_seq の順に受け取る。
	page := changesAfter(t, env, r.owner, room.ID, 2)
	if len(page.Messages) != 2 || page.HasMore || page.LastChangeSeq != 4 {
		t.Fatalf("changes after 2 = %d messages, has_more %v, last_change_seq %d", len(page.Messages), page.HasMore, page.LastChangeSeq)
	}
	if m := page.Messages[0]; m.ID != first.ID || m.ChangeSeq != 3 || m.Body != "1 件目（編集）" || m.EditedAt == nil {
		t.Errorf("first change = %+v", m)
	}
	if m := page.Messages[1]; m.ID != second.ID || m.ChangeSeq != 4 || m.Body != "" || m.DeletedAt == nil {
		t.Errorf("second change = %+v, want the tombstone", m)
	}
	if page := changesAfter(t, env, r.owner, room.ID, 4); len(page.Messages) != 0 || page.HasMore || page.LastChangeSeq != 4 {
		t.Errorf("changes after 4 = %+v", page)
	}
	// 通常の履歴にも last_change_seq が付き、並びは seq のまま。
	latest, err := env.Service.ListMessages(t.Context(), r.owner, room.ID, chat.MessageQuery{})
	if err != nil || latest.LastChangeSeq != 4 || !equalSeqs(seqsOf(latest.Messages), 1, 2) {
		t.Errorf("latest = seqs %v, last_change_seq %d, %v", seqsOf(latest.Messages), latest.LastChangeSeq, err)
	}

	// limit と has_more は after_seq と同じ扱い。
	for range 3 {
		send(t, env, r.member, room.ID, "追加")
	}
	after := int64(0)
	page, err = env.Service.ListMessages(t.Context(), r.owner, room.ID, chat.MessageQuery{AfterChangeSeq: &after, Limit: 2})
	// change_seq 1 と 2 は、同じメッセージの後の変更（3 と 4）で上書きされているので、残っているのは 3, 4, 5, 6, 7。
	var got []int64
	for _, m := range page.Messages {
		got = append(got, m.ChangeSeq)
	}
	if err != nil || !equalSeqs(got, 3, 4) || !page.HasMore {
		t.Errorf("changes after 0 with limit 2 = %v (has_more %v), %v; want [3 4] and more", got, page.HasMore, err)
	}

	// カーソルは 1 つしか指定できない。負の値は範囲外。
	one := int64(1)
	for _, q := range []chat.MessageQuery{{AfterChangeSeq: &one, AfterSeq: &one}, {AfterChangeSeq: &one, BeforeSeq: &one}} {
		_, err := env.Service.ListMessages(t.Context(), r.owner, room.ID, q)
		expectValidation(t, err, "before_seq", chat.ReasonInvalidValue)
	}
	minus := int64(-1)
	_, err = env.Service.ListMessages(t.Context(), r.owner, room.ID, chat.MessageQuery{AfterChangeSeq: &minus})
	expectValidation(t, err, "after_change_seq", chat.ReasonOutOfRange)
	// 読めない人は差分も取れない。
	if _, err := env.Service.ListMessages(t.Context(), r.outsider, room.ID, chat.MessageQuery{AfterChangeSeq: &one}); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("outsider error = %v, want ErrNotFound", err)
	}
}

// 送信・編集・削除が並行する間に after_change_seq で差分を取り続けても、change_seq に欠番も重複も観測せず、
// 最後に手元に作った状態が DB と一致する（ADR 0014 の「読み手は欠番を観測しない」）。
func TestChangeSeqSyncConcurrent(t *testing.T) {
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

	const writers, opsPerWriter = 3, 30
	var (
		wg   sync.WaitGroup
		done = make(chan struct{})
	)
	for w := range writers {
		writer := users[w+1]
		wg.Go(func() {
			var mine []ulid.ULID
			for range opsPerWriter {
				switch op := rand.IntN(3); {
				case op == 1 && len(mine) > 0:
					if _, err := env.Service.EditMessage(t.Context(), writer, room.ID, mine[rand.IntN(len(mine))], env.IDs.New().String()); err != nil && !errors.Is(err, chat.ErrMessageDeleted) {
						t.Errorf("EditMessage() error = %v", err)
						return
					}
				case op == 2 && len(mine) > 0:
					if err := env.Service.DeleteMessage(t.Context(), writer, room.ID, mine[rand.IntN(len(mine))]); err != nil {
						t.Errorf("DeleteMessage() error = %v", err)
						return
					}
				default:
					msg, _, err := env.Service.SendMessage(t.Context(), writer, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "送信"})
					if err != nil {
						t.Errorf("SendMessage() error = %v", err)
						return
					}
					mine = append(mine, msg.ID)
				}
			}
		})
	}
	go func() {
		wg.Wait()
		close(done)
	}()

	// クライアントの手元の状態。
	local := map[ulid.ULID]chat.Message{}
	var cursor int64
	finished := false
	for {
		select {
		case <-done:
			finished = true
		default:
		}
		for {
			page, err := env.Service.ListMessages(t.Context(), reader, room.ID, chat.MessageQuery{AfterChangeSeq: &cursor, Limit: 5})
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range page.Messages {
				// 手元にない変更が上書きされて見えないことはあるが、番号が戻ったり重複したりはしない。
				if m.ChangeSeq <= cursor {
					t.Fatalf("received change_seq %d after %d", m.ChangeSeq, cursor)
				}
				cursor = m.ChangeSeq
				local[m.ID] = m
			}
			if !page.HasMore {
				cursor = max(cursor, page.LastChangeSeq)
				break
			}
		}
		if finished {
			break
		}
	}

	latest, err := env.Service.ListMessages(t.Context(), reader, room.ID, chat.MessageQuery{Limit: chat.MaxMessageLimit})
	if err != nil {
		t.Fatal(err)
	}
	if latest.HasMore {
		t.Fatal("more messages than one page; raise the limit of the test")
	}
	if len(local) != len(latest.Messages) {
		t.Fatalf("local has %d messages, server has %d", len(local), len(latest.Messages))
	}
	for _, want := range latest.Messages {
		got := local[want.ID]
		if got.ChangeSeq != want.ChangeSeq || got.Body != want.Body || (got.DeletedAt == nil) != (want.DeletedAt == nil) {
			t.Errorf("message %d: local = change %d %q deleted %v, server = change %d %q deleted %v",
				want.Seq, got.ChangeSeq, got.Body, got.DeletedAt != nil, want.ChangeSeq, want.Body, want.DeletedAt != nil)
		}
	}
	if cursor != roomLastChangeSeq(t, env, room.ID) {
		t.Errorf("cursor = %d, want last_change_seq %d", cursor, roomLastChangeSeq(t, env, room.ID))
	}
}

// 返信の送信（rooms をロックしたまま返信先に FOR KEY SHARE）と、返信先の編集・削除（メッセージをロックしてから rooms）が並行しても、
// デッドロックにならない（ADR 0014「ロックの順序」）。
func TestEditAndReplyConcurrentNoDeadlock(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	target := send(t, env, r.member, room.ID, "返信先")

	const n = 40
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			var err error
			if i%2 == 0 {
				_, err = env.Service.EditMessage(t.Context(), r.member, room.ID, target.ID, env.IDs.New().String())
			} else {
				_, _, err = env.Service.SendMessage(t.Context(), r.member2, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "返信", ReplyToID: &target.ID})
			}
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "40P01" {
				t.Errorf("deadlock detected: %v", err)
			} else if err != nil {
				t.Errorf("error = %v", err)
			}
		})
	}
	wg.Wait()
	if got, want := roomLastChangeSeq(t, env, room.ID), int64(1+n); got != want {
		t.Errorf("last_change_seq = %d, want %d", got, want)
	}
}
