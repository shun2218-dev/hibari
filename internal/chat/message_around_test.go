package chat_test

import (
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// aroundEnv は、1 本の public ルームに人の発言を 20 件並べた状態を作る。
// 返り値の msgs は送った順（seq の昇順）で、msgs[0] の前にはルームの作成のログ（ADR 0033）が 1 件だけある。
func aroundEnv(t *testing.T) (*chattest.Env, roles, chat.Room, []chat.Message) {
	t.Helper()
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "around")
	msgs := make([]chat.Message, 20)
	for i := range msgs {
		env.Clock.Advance(time.Second)
		msgs[i] = send(t, env, r.member, room.ID, string(rune('a'+i)))
	}
	return env, r, room, msgs
}

func TestListMessagesAroundCenters(t *testing.T) {
	env, r, room, msgs := aroundEnv(t)
	target := msgs[10]

	page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AroundMessageID: &target.ID, Limit: 7})
	if err != nil {
		t.Fatal(err)
	}
	// limit 7 なら古い側が 3 件（7 / 2 の切り捨て）、対象、新しい側が 3 件。
	if got := seqsOf(page.Messages); !equalSeqs(got,
		msgs[7].Seq, msgs[8].Seq, msgs[9].Seq, target.Seq, msgs[11].Seq, msgs[12].Seq, msgs[13].Seq) {
		t.Errorf("seqs = %v, want the 3 before and after seq %d", got, target.Seq)
	}
	if !page.HasMore || !page.HasMoreAfter {
		t.Errorf("has_more = %v, has_more_after = %v, want both true", page.HasMore, page.HasMoreAfter)
	}
	if page.Around == nil || page.Around.Seq != target.Seq || page.Around.ThreadRootID != nil {
		t.Errorf("around = %+v, want seq %d with no thread", page.Around, target.Seq)
	}
}

// 対象が端に寄っていても、足りない側の分をもう一方に回して limit 件まで返す。
func TestListMessagesAroundAtTheEdges(t *testing.T) {
	env, r, room, msgs := aroundEnv(t)

	// いちばん新しいメッセージ。新しい側には何もない。
	last := msgs[len(msgs)-1]
	page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AroundMessageID: &last.ID, Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if got := seqsOf(page.Messages); !equalSeqs(got, msgs[17].Seq, msgs[18].Seq, last.Seq) {
		t.Errorf("newest: seqs = %v, want the 2 before it and itself", got)
	}
	if !page.HasMore || page.HasMoreAfter {
		t.Errorf("newest: has_more = %v, has_more_after = %v, want true / false", page.HasMore, page.HasMoreAfter)
	}

	// いちばん古い人の発言。古い側にはルームの作成のログ 1 件しかないので、余った分は新しい側に回って limit まで埋まる。
	first := msgs[0]
	page, err = env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AroundMessageID: &first.ID, Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if got := seqsOf(page.Messages); !equalSeqs(got, first.Seq-1, first.Seq, msgs[1].Seq, msgs[2].Seq, msgs[3].Seq) {
		t.Errorf("oldest: seqs = %v, want the room-created log, itself and the 3 after it", got)
	}
	if page.HasMore || !page.HasMoreAfter {
		t.Errorf("oldest: has_more = %v, has_more_after = %v, want false / true", page.HasMore, page.HasMoreAfter)
	}
}

// limit が 1 でも、対象だけを返して両側の続きを正しく伝える。
func TestListMessagesAroundLimitOne(t *testing.T) {
	env, r, room, msgs := aroundEnv(t)
	target := msgs[5]

	page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AroundMessageID: &target.ID, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if got := seqsOf(page.Messages); !equalSeqs(got, target.Seq) {
		t.Errorf("seqs = %v, want just seq %d", got, target.Seq)
	}
	if !page.HasMore || !page.HasMoreAfter {
		t.Errorf("has_more = %v, has_more_after = %v, want both true", page.HasMore, page.HasMoreAfter)
	}
}

// 見つからない ID は、どれも同じ結果（最新のページと around: null）になる。区別できるとメッセージの実在を当てられる（ADR 0042）。
func TestListMessagesAroundNotFoundIsIndistinguishable(t *testing.T) {
	env, r, room, msgs := aroundEnv(t)

	// 削除済み。
	deleted := msgs[3]
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, deleted.ID); err != nil {
		t.Fatal(err)
	}
	// 別のルームにある、読めるメッセージ。
	other := createRoom(t, env, r.member, r.ws.ID, "public", "other")
	elsewhere := send(t, env, r.member, other.ID, "elsewhere")
	// どこにもない ID と、ULID のゼロ値（httpx が ULID として読めない文字列に使う）。
	missing := env.IDs.New()
	var zero ulid.ULID

	latest, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name string
		id   ulid.ULID
	}{
		{"deleted", deleted.ID},
		{"in another room", elsewhere.ID},
		{"never existed", missing},
		{"the zero ULID", zero},
	} {
		t.Run(tt.name, func(t *testing.T) {
			page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AroundMessageID: &tt.id, Limit: 5})
			if err != nil {
				t.Fatal(err)
			}
			if page.Around != nil {
				t.Errorf("around = %+v, want nil", page.Around)
			}
			if got := seqsOf(page.Messages); !equalSeqs(got, seqsOf(latest.Messages)...) {
				t.Errorf("seqs = %v, want the latest page %v", got, seqsOf(latest.Messages))
			}
			if page.HasMore != latest.HasMore || page.HasMoreAfter {
				t.Errorf("has_more = %v, has_more_after = %v, want %v / false", page.HasMore, page.HasMoreAfter, latest.HasMore)
			}
		})
	}
}

// チャンネルのタイムラインに出ない返信（ADR 0036）を指しても、その返信自身は必ず入る。
func TestListMessagesAroundThreadReply(t *testing.T) {
	env, r, room, msgs := aroundEnv(t)
	root := msgs[10]
	env.Clock.Advance(time.Second)
	answer := reply(t, env, r.member, room.ID, root.ID, "返信")

	page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AroundMessageID: &answer.ID, Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if page.Around == nil || page.Around.ThreadRootID == nil || *page.Around.ThreadRootID != root.ID {
		t.Fatalf("around = %+v, want thread_root_id %s", page.Around, root.ID)
	}
	// 返信自身（seq は最後に採番される）と、その前のチャンネルの発言が並ぶ。
	// 新しい側には何もないので、古い側の 2 件（limit 5 の切り捨て）と対象だけになる。
	if got := seqsOf(page.Messages); !equalSeqs(got, msgs[18].Seq, msgs[19].Seq, answer.Seq) {
		t.Errorf("seqs = %v, want the last 2 channel messages and the reply %d", got, answer.Seq)
	}
	if page.HasMoreAfter {
		t.Errorf("has_more_after = true, want false")
	}
}

// カーソルは 1 つまで。ほかのカーソルと同時に指定したら 422。
func TestListMessagesAroundRejectsOtherCursors(t *testing.T) {
	env, r, room, msgs := aroundEnv(t)
	id := msgs[0].ID
	seq := int64(1)

	for _, q := range []chat.MessageQuery{
		{AroundMessageID: &id, BeforeSeq: &seq},
		{AroundMessageID: &id, AfterSeq: &seq},
		{AroundMessageID: &id, AfterChangeSeq: &seq},
	} {
		_, err := env.Service.ListMessages(t.Context(), r.member, room.ID, q)
		expectValidation(t, err, "before_seq", chat.ReasonInvalidValue)
	}
}

// 読めないルームは、これまでどおり 404。around のときだけ扱いを変えたりしない。
func TestListMessagesAroundKeepsRoomAuthz(t *testing.T) {
	env, r, room, msgs := aroundEnv(t)
	id := msgs[0].ID

	private := createRoom(t, env, r.member, r.ws.ID, "private", "secret")
	hidden := send(t, env, r.member, private.ID, "秘密")

	if _, err := env.Service.ListMessages(t.Context(), r.owner, private.ID, chat.MessageQuery{AroundMessageID: &hidden.ID}); err == nil {
		t.Error("private room as non-member: error = nil, want ErrNotFound")
	}
	if _, err := env.Service.ListMessages(t.Context(), r.outsider, room.ID, chat.MessageQuery{AroundMessageID: &id}); err == nil {
		t.Error("outsider: error = nil, want ErrNotFound")
	}
}

// スレッドの返信の一覧でも、同じように真ん中に置ける。
func TestListThreadMessagesAround(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "thread-around")
	root := send(t, env, r.member, room.ID, "親")
	replies := make([]chat.Message, 12)
	for i := range replies {
		env.Clock.Advance(time.Second)
		replies[i] = reply(t, env, r.member, room.ID, root.ID, string(rune('a'+i)))
	}
	target := replies[6]

	page, err := env.Service.ListThreadMessages(t.Context(), r.member, room.ID, root.ID, chat.ThreadQuery{AroundMessageID: &target.ID, Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if got := seqsOf(page.Replies); !equalSeqs(got, replies[4].Seq, replies[5].Seq, target.Seq, replies[7].Seq, replies[8].Seq) {
		t.Errorf("seqs = %v, want the 2 replies around seq %d", got, target.Seq)
	}
	if !page.HasMore || !page.HasMoreAfter {
		t.Errorf("has_more = %v, has_more_after = %v, want both true", page.HasMore, page.HasMoreAfter)
	}
	if page.Around == nil || page.Around.Seq != target.Seq {
		t.Errorf("around = %+v, want seq %d", page.Around, target.Seq)
	}
	if page.Root.ID != root.ID {
		t.Errorf("root = %s, want %s", page.Root.ID, root.ID)
	}
}

// 別のスレッドの返信・親そのもの・削除済みを指したら、最新のページを around なしで返す。
func TestListThreadMessagesAroundNotInThisThread(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "thread-around")
	root := send(t, env, r.member, room.ID, "親")
	other := send(t, env, r.member, room.ID, "別の親")
	elsewhere := reply(t, env, r.member, room.ID, other.ID, "別のスレッドの返信")
	mine := make([]chat.Message, 4)
	for i := range mine {
		env.Clock.Advance(time.Second)
		mine[i] = reply(t, env, r.member, room.ID, root.ID, string(rune('a'+i)))
	}
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, mine[1].ID); err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		name string
		id   ulid.ULID
	}{
		{"a reply in another thread", elsewhere.ID},
		{"the root itself", root.ID},
		{"a deleted reply", mine[1].ID},
		{"never existed", env.IDs.New()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			page, err := env.Service.ListThreadMessages(t.Context(), r.member, room.ID, root.ID, chat.ThreadQuery{AroundMessageID: &tt.id, Limit: 2})
			if err != nil {
				t.Fatal(err)
			}
			if page.Around != nil {
				t.Errorf("around = %+v, want nil", page.Around)
			}
			// 最新のページ（いちばん新しい 2 件）が返る。
			if got := seqsOf(page.Replies); !equalSeqs(got, mine[2].Seq, mine[3].Seq) {
				t.Errorf("seqs = %v, want the latest 2 replies", got)
			}
			if !page.HasMore || page.HasMoreAfter {
				t.Errorf("has_more = %v, has_more_after = %v, want true / false", page.HasMore, page.HasMoreAfter)
			}
		})
	}
}

func TestListThreadMessagesAroundRejectsOtherCursors(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "thread-around")
	root := send(t, env, r.member, room.ID, "親")
	answer := reply(t, env, r.member, room.ID, root.ID, "返信")
	seq := int64(1)

	for _, q := range []chat.ThreadQuery{
		{AroundMessageID: &answer.ID, BeforeSeq: &seq},
		{AroundMessageID: &answer.ID, AfterSeq: &seq},
	} {
		_, err := env.Service.ListThreadMessages(t.Context(), r.member, room.ID, root.ID, q)
		expectValidation(t, err, "before_seq", chat.ReasonInvalidValue)
	}
}
