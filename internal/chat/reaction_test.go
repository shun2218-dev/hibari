package chat_test

import (
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// 絵文字のリアクション（ADR 0044）。

// reactionRoom は member・member2・admin が参加した public ルームと、1 件のメッセージを作る。
func reactionRoom(t *testing.T, env *chattest.Env) (roles, chat.Room, chat.Message) {
	t.Helper()
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "reactions")
	for _, u := range []ulid.ULID{r.member2, r.admin} {
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	return r, room, send(t, env, r.member, room.ID, "これどうでしょう")
}

// reactionOf は絵文字の集計を 1 件返す。無ければ ok が false。
func reactionOf(m chat.Message, emoji string) (chat.MessageReaction, bool) {
	i := slices.IndexFunc(m.Reactions, func(r chat.MessageReaction) bool { return r.Emoji == emoji })
	if i < 0 {
		return chat.MessageReaction{}, false
	}
	return m.Reactions[i], true
}

// getMessage は actor から見たメッセージを読み直す（Me は actor 視点になる）。
// 前後を指定して読むのは、参加のログが積もっても最新のページから押し出されないようにするため。
func getMessage(t *testing.T, env *chattest.Env, actor, roomID, messageID ulid.ULID) chat.Message {
	t.Helper()
	page, err := env.Service.ListMessages(t.Context(), actor, roomID, chat.MessageQuery{AroundMessageID: &messageID})
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	i := slices.IndexFunc(page.Messages, func(m chat.Message) bool { return m.ID == messageID })
	if i < 0 {
		t.Fatalf("メッセージ %s が一覧に無い", messageID)
	}
	return page.Messages[i]
}

func TestAddAndRemoveReaction(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)
	env.Deliveries.Take() // 準備（参加のログなど）のぶんを捨てる

	got, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, msg.ID, "👍")
	if err != nil {
		t.Fatalf("AddReaction: %v", err)
	}

	t.Run("集計が返る", func(t *testing.T) {
		re, ok := reactionOf(got, "👍")
		if !ok {
			t.Fatalf("reactions = %+v, want 👍", got.Reactions)
		}
		if re.Count != 1 || !re.Me || !slices.Equal(re.Users, []ulid.ULID{r.member2}) {
			t.Errorf("reaction = %+v, want count 1 / me true / users [member2]", re)
		}
	})

	t.Run("change_seq が 1 つ進み、seq は進まない", func(t *testing.T) {
		if got.ChangeSeq <= msg.ChangeSeq {
			t.Errorf("change_seq = %d, want > %d", got.ChangeSeq, msg.ChangeSeq)
		}
		// リアクションはチャンネルの発言ではないので、順序も未読も動かさない（ADR 0044 決定 2）
		if got.Seq != msg.Seq || got.UserSeq != msg.UserSeq {
			t.Errorf("seq, user_seq = %d, %d; want %d, %d", got.Seq, got.UserSeq, msg.Seq, msg.UserSeq)
		}
		// 「（編集済み）」を付けてはいけない
		if got.EditedAt != nil {
			t.Errorf("edited_at = %v, want nil", got.EditedAt)
		}
	})

	t.Run("message.updated を配る", func(t *testing.T) {
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventMessageUpdated {
			t.Fatalf("events = %+v, want 1 件の message.updated", evs)
		}
		if !slices.Contains(evs[0].To.Rooms, room.ID) {
			t.Errorf("宛先 = %+v, want ルーム %s", evs[0].To, room.ID)
		}
	})

	t.Run("他の人から見ると me は false", func(t *testing.T) {
		re, _ := reactionOf(getMessage(t, env, r.admin, room.ID, msg.ID), "👍")
		if re.Count != 1 || re.Me {
			t.Errorf("admin から見た reaction = %+v, want count 1 / me false", re)
		}
	})

	t.Run("外すと消える", func(t *testing.T) {
		env.Deliveries.Take()
		after, err := env.Service.RemoveReaction(t.Context(), r.member2, room.ID, msg.ID, "👍")
		if err != nil {
			t.Fatalf("RemoveReaction: %v", err)
		}
		if _, ok := reactionOf(after, "👍"); ok {
			t.Errorf("reactions = %+v, want 空", after.Reactions)
		}
		if evs := env.Deliveries.Take(); len(evs) != 1 || evs[0].Type != chat.EventMessageUpdated {
			t.Errorf("events = %+v, want 1 件の message.updated", evs)
		}
	})
}

func TestReactionIsIdempotent(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	first, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, msg.ID, "🎉")
	if err != nil {
		t.Fatalf("AddReaction: %v", err)
	}
	env.Deliveries.Take()

	t.Run("同じリアクションをもう一度付けても増えない", func(t *testing.T) {
		second, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, msg.ID, "🎉")
		if err != nil {
			t.Fatalf("AddReaction: %v", err)
		}
		re, _ := reactionOf(second, "🎉")
		if re.Count != 1 {
			t.Errorf("count = %d, want 1", re.Count)
		}
		// 行が増えていないので番号も使わず、配信もしない（ADR 0044 決定 2）
		if second.ChangeSeq != first.ChangeSeq {
			t.Errorf("change_seq = %d, want %d のまま", second.ChangeSeq, first.ChangeSeq)
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v, want 0 件", evs)
		}
	})

	t.Run("付いていないものを外しても何も起きない", func(t *testing.T) {
		before := getMessage(t, env, r.member, room.ID, msg.ID)
		after, err := env.Service.RemoveReaction(t.Context(), r.member, room.ID, msg.ID, "🎉")
		if err != nil {
			t.Fatalf("RemoveReaction: %v", err)
		}
		if after.ChangeSeq != before.ChangeSeq {
			t.Errorf("change_seq = %d, want %d のまま", after.ChangeSeq, before.ChangeSeq)
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v, want 0 件", evs)
		}
	})
}

func TestReactionsAreOrderedByFirstReaction(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	// 👍 を先に、🎉 を後に付ける。後から 🎉 が増えても並びは入れ替わらない（ADR 0044 決定 3）。
	for _, step := range []struct {
		actor ulid.ULID
		emoji string
	}{
		{r.member, "👍"},
		{r.member2, "🎉"},
		{r.admin, "🎉"},
	} {
		env.Clock.Advance(time.Second)
		if _, err := env.Service.AddReaction(t.Context(), step.actor, room.ID, msg.ID, step.emoji); err != nil {
			t.Fatalf("AddReaction(%s): %v", step.emoji, err)
		}
	}

	got := getMessage(t, env, r.member, room.ID, msg.ID)
	emojis := make([]string, len(got.Reactions))
	counts := make([]int64, len(got.Reactions))
	for i, re := range got.Reactions {
		emojis[i], counts[i] = re.Emoji, re.Count
	}
	if !slices.Equal(emojis, []string{"👍", "🎉"}) || !slices.Equal(counts, []int64{1, 2}) {
		t.Errorf("reactions = %v %v, want [👍 🎉] [1 2]", emojis, counts)
	}
}

func TestReactionUsersAreCappedAtEight(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "many-reactions")
	msg := send(t, env, r.member, room.ID, "みんなで押す")

	// 10 人に押してもらう。users は先頭 8 人までで、count は 10 になる（ADR 0044 決定 3）。
	want := []ulid.ULID{r.member}
	if _, err := env.Service.AddReaction(t.Context(), r.member, room.ID, msg.ID, "🙏"); err != nil {
		t.Fatal(err)
	}
	for _, u := range env.CreateUsers(t, 9) {
		env.AddMember(t, r.ws.ID, u, "member")
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
		env.Clock.Advance(time.Second)
		if _, err := env.Service.AddReaction(t.Context(), u, room.ID, msg.ID, "🙏"); err != nil {
			t.Fatal(err)
		}
		want = append(want, u)
	}

	re, _ := reactionOf(getMessage(t, env, r.member, room.ID, msg.ID), "🙏")
	if re.Count != 10 {
		t.Errorf("count = %d, want 10", re.Count)
	}
	// 最初に押した順の先頭 8 人
	if !slices.Equal(re.Users, want[:8]) {
		t.Errorf("users = %v, want %v", re.Users, want[:8])
	}
}

func TestReactionKindLimit(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	// 20 種類までは通る（ADR 0044 決定 5）。
	kinds := []string{"😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲"}
	for _, e := range kinds {
		if _, err := env.Service.AddReaction(t.Context(), r.member, room.ID, msg.ID, e); err != nil {
			t.Fatalf("AddReaction(%s): %v", e, err)
		}
	}

	t.Run("21 種類目は 422", func(t *testing.T) {
		_, err := env.Service.AddReaction(t.Context(), r.member, room.ID, msg.ID, "😋")
		var ve *chat.ValidationError
		if !errors.As(err, &ve) || ve.Fields[0].Field != "emoji" || ve.Fields[0].Reason != chat.ReasonTooMany {
			t.Errorf("error = %v, want emoji: too_many", err)
		}
	})

	t.Run("上限に達していても、すでにある絵文字には付けられる", func(t *testing.T) {
		got, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, msg.ID, kinds[0])
		if err != nil {
			t.Fatalf("AddReaction: %v", err)
		}
		if re, _ := reactionOf(got, kinds[0]); re.Count != 2 {
			t.Errorf("count = %d, want 2", re.Count)
		}
	})
}

func TestReactionRejectsInvalidEmoji(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	for _, e := range []string{"", "a", "あ", "👍👎", "👍 です", ":+1:"} {
		t.Run(fmt.Sprintf("%q", e), func(t *testing.T) {
			_, err := env.Service.AddReaction(t.Context(), r.member, room.ID, msg.ID, e)
			var ve *chat.ValidationError
			if !errors.As(err, &ve) || ve.Fields[0].Field != "emoji" || ve.Fields[0].Reason != chat.ReasonInvalidValue {
				t.Errorf("error = %v, want emoji: invalid_value", err)
			}
		})
	}
}

func TestReactionAuthorization(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	t.Run("参加していない public ルームには付けられない", func(t *testing.T) {
		// 読めるが投稿できないので 403（ADR 0044 決定 6）
		_, err := env.Service.AddReaction(t.Context(), r.owner, room.ID, msg.ID, "👍")
		if !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("error = %v, want ErrForbidden", err)
		}
	})

	t.Run("ワークスペースの外の人には、ルームが見えない", func(t *testing.T) {
		_, err := env.Service.AddReaction(t.Context(), r.outsider, room.ID, msg.ID, "👍")
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})

	t.Run("削除済みのメッセージには付けられない", func(t *testing.T) {
		deleted := send(t, env, r.member, room.ID, "消す")
		if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, deleted.ID); err != nil {
			t.Fatal(err)
		}
		// 「跡も残さず消える」（ADR 0038）ので、存在しないものと区別しない
		_, err := env.Service.AddReaction(t.Context(), r.member, room.ID, deleted.ID, "👍")
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})

	t.Run("システムメッセージには付けられない", func(t *testing.T) {
		page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{})
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(page.Messages, func(m chat.Message) bool { return m.Kind == chat.MessageKindSystem })
		if i < 0 {
			t.Fatal("システムメッセージが無い（参加のログが出るはず）")
		}
		_, err = env.Service.AddReaction(t.Context(), r.member, room.ID, page.Messages[i].ID, "👍")
		var ve *chat.ValidationError
		if !errors.As(err, &ve) || ve.Fields[0].Field != "message_id" {
			t.Errorf("error = %v, want message_id: invalid_value", err)
		}
	})
}

func TestDeletingMessageHidesItsReactions(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	if _, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, msg.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}

	// 削除済みは一覧に出ないので（ADR 0038）、差分取得で tombstone を見る
	page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AfterChangeSeq: ptr(int64(0))})
	if err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(page.Messages, func(m chat.Message) bool { return m.ID == msg.ID })
	if i < 0 {
		t.Fatal("削除したメッセージが差分に無い")
	}
	if len(page.Messages[i].Reactions) != 0 {
		t.Errorf("reactions = %+v, want 空（跡を残さない。ADR 0038）", page.Messages[i].Reactions)
	}
}

func TestLeavingRoomRemovesReactions(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	if _, err := env.Service.AddReaction(t.Context(), r.member2, room.ID, msg.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	// 自分で抜けるのも RemoveRoomMember（actor == target）
	if err := env.Service.RemoveRoomMember(t.Context(), r.member2, room.ID, r.member2); err != nil {
		t.Fatal(err)
	}

	// room_members への複合 FK が行を消す（アプリのコードに頼らない。ADR 0044 決定 1）
	if re, ok := reactionOf(getMessage(t, env, r.member, room.ID, msg.ID), "👍"); ok {
		t.Errorf("reaction = %+v, want 消えている", re)
	}
}

// TestConcurrentReactionsKeepCount は、同じ絵文字を大量に同時に付け外ししても数がずれないことを確かめる
// （ロードマップ Phase 6.7 の DoD）。数は行を数えた結果なので、カウンタのような取り合いは起きない。
func TestConcurrentReactionsKeepCount(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "concurrent-reactions")
	msg := send(t, env, r.member, room.ID, "せーの")

	const n = 50
	users := env.CreateUsers(t, n)
	for _, u := range users {
		env.AddMember(t, r.ws.ID, u, "member")
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}

	// 全員が同時に付け、そのうち半分が続けて外す。
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i, u := range users {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := env.Service.AddReaction(t.Context(), u, room.ID, msg.ID, "👍"); err != nil {
				errs[i] = fmt.Errorf("add: %w", err)
				return
			}
			if i%2 == 0 {
				if _, err := env.Service.RemoveReaction(t.Context(), u, room.ID, msg.ID, "👍"); err != nil {
					errs[i] = fmt.Errorf("remove: %w", err)
				}
			}
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("user %d: %v", i, err)
		}
	}

	re, ok := reactionOf(getMessage(t, env, r.member, room.ID, msg.ID), "👍")
	if !ok || re.Count != n/2 {
		t.Errorf("count = %+v, want %d", re, n/2)
	}
}
