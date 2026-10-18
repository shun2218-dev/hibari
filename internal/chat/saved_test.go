package chat_test

import (
	"errors"
	"slices"
	"sync"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// 「後で」（自分用の保存。ADR 0054 決定 6〜10）。

// savedIDs は一覧のメッセージの ID を並びのまま返す。
func savedIDs(items []chat.SavedItem) []ulid.ULID {
	ids := make([]ulid.ULID, len(items))
	for i, it := range items {
		ids[i] = it.MessageID
	}
	return ids
}

func listSaved(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID, q chat.SavedQuery) chat.SavedPage {
	t.Helper()
	page, err := env.Service.ListSaved(t.Context(), actor, workspaceID, q)
	if err != nil {
		t.Fatalf("ListSaved: %v", err)
	}
	return page
}

func TestSaveMessage(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)
	env.Deliveries.Take()

	item, err := env.Service.SaveMessage(t.Context(), r.member2, room.ID, msg.ID)
	if err != nil {
		t.Fatalf("SaveMessage: %v", err)
	}

	t.Run("進行中になり、中身とルームが付く", func(t *testing.T) {
		if item.State != chat.SavedInProgress || item.Status != chat.SavedItemOK || item.ChangeSeq != 1 {
			t.Errorf("item = state %s / status %s / change_seq %d", item.State, item.Status, item.ChangeSeq)
		}
		if item.Message == nil || item.Message.Body != msg.Body || item.Room == nil || item.Room.Name != room.Name {
			t.Errorf("item.message / room = %+v / %+v", item.Message, item.Room)
		}
	})

	t.Run("本人のすべての接続にだけ saved.updated を配る", func(t *testing.T) {
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventSavedUpdated {
			t.Fatalf("events = %+v, want 1 件の saved.updated", evs)
		}
		if !slices.Equal(evs[0].To.Users, []ulid.ULID{r.member2}) || len(evs[0].To.Rooms) != 0 {
			t.Errorf("宛先 = %+v, want member2 だけ", evs[0].To)
		}
	})

	t.Run("メッセージの saved は保存した本人から見たときだけ true で、ルームの change_seq は進まない", func(t *testing.T) {
		mine := getMessage(t, env, r.member2, room.ID, msg.ID)
		if !mine.Saved || mine.ChangeSeq != msg.ChangeSeq {
			t.Errorf("本人から見た saved / change_seq = %v / %d, want true / %d", mine.Saved, mine.ChangeSeq, msg.ChangeSeq)
		}
		if other := getMessage(t, env, r.admin, room.ID, msg.ID); other.Saved {
			t.Error("他の人から見た saved = true, want false")
		}
	})

	t.Run("保存済みをもう一度保存しても何も変わらない（完了にしたものを進行中に戻さない）", func(t *testing.T) {
		if _, err := env.Service.MoveSaved(t.Context(), r.member2, r.ws.ID, msg.ID, chat.SavedCompleted); err != nil {
			t.Fatal(err)
		}
		env.Deliveries.Take()
		again, err := env.Service.SaveMessage(t.Context(), r.member2, room.ID, msg.ID)
		if err != nil {
			t.Fatal(err)
		}
		if again.State != chat.SavedCompleted || again.ChangeSeq != 2 {
			t.Errorf("again = state %s / change_seq %d, want completed / 2", again.State, again.ChangeSeq)
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v, want なし", evs)
		}
	})
}

func TestSaveAuthorization(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	t.Run("参加していない public ルームのメッセージも保存できる（読めれば保存できる）", func(t *testing.T) {
		if _, err := env.Service.SaveMessage(t.Context(), r.owner, room.ID, msg.ID); err != nil {
			t.Errorf("SaveMessage: %v", err)
		}
	})

	t.Run("読めないルームのメッセージは保存できない", func(t *testing.T) {
		private := createRoom(t, env, r.member, r.ws.ID, "private", "himitsu")
		secret := send(t, env, r.member, private.ID, "内緒")
		if _, err := env.Service.SaveMessage(t.Context(), r.member2, private.ID, secret.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
		if _, err := env.Service.SaveMessage(t.Context(), r.outsider, room.ID, msg.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("外の人の error = %v, want ErrNotFound", err)
		}
	})

	t.Run("削除済みのメッセージとシステムメッセージは保存できない", func(t *testing.T) {
		gone := send(t, env, r.member, room.ID, "消す")
		if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, gone.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.SaveMessage(t.Context(), r.member, room.ID, gone.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("削除済みの error = %v, want ErrNotFound", err)
		}
		page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{})
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(page.Messages, func(m chat.Message) bool { return m.Kind == chat.MessageKindSystem })
		_, err = env.Service.SaveMessage(t.Context(), r.member, room.ID, page.Messages[i].ID)
		var ve *chat.ValidationError
		if !errors.As(err, &ve) || ve.Fields[0].Field != "message_id" {
			t.Errorf("システムメッセージの error = %v, want message_id: invalid_value", err)
		}
	})

	t.Run("他人の保存は動かせない（自分の行としては存在しない）", func(t *testing.T) {
		if _, err := env.Service.MoveSaved(t.Context(), r.member, r.ws.ID, msg.ID, chat.SavedArchived); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})
}

func TestSavedTabsAndRemove(t *testing.T) {
	env := chattest.New(t)
	r, room, first := reactionRoom(t, env)
	second := send(t, env, r.member2, room.ID, "2 つ目")
	third := send(t, env, r.member2, room.ID, "3 つ目")
	for _, m := range []chat.Message{first, second, third} {
		if _, err := env.Service.SaveMessage(t.Context(), r.member, room.ID, m.ID); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("進行中は保存した新しい順で、件数が付く", func(t *testing.T) {
		page := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{})
		if !slices.Equal(savedIDs(page.Items), []ulid.ULID{third.ID, second.ID, first.ID}) || page.InProgressCount != 3 {
			t.Errorf("ids = %v / count = %d", savedIDs(page.Items), page.InProgressCount)
		}
	})

	t.Run("カーソルで続きを読む", func(t *testing.T) {
		p1 := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{Limit: 2})
		if len(p1.Items) != 2 || !p1.HasMore {
			t.Fatalf("1 ページ目 = %d 件 / has_more %v", len(p1.Items), p1.HasMore)
		}
		p2 := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{Limit: 2, Before: &p1.Items[1].ID})
		if !slices.Equal(savedIDs(p2.Items), []ulid.ULID{first.ID}) || p2.HasMore {
			t.Errorf("2 ページ目 = %v / has_more %v", savedIDs(p2.Items), p2.HasMore)
		}
	})

	t.Run("タブを動かすと、それぞれのタブに出る", func(t *testing.T) {
		if _, err := env.Service.MoveSaved(t.Context(), r.member, r.ws.ID, second.ID, chat.SavedArchived); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.MoveSaved(t.Context(), r.member, r.ws.ID, third.ID, chat.SavedCompleted); err != nil {
			t.Fatal(err)
		}
		for state, want := range map[chat.SavedState][]ulid.ULID{
			chat.SavedInProgress: {first.ID},
			chat.SavedArchived:   {second.ID},
			chat.SavedCompleted:  {third.ID},
		} {
			page := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{State: state})
			if !slices.Equal(savedIDs(page.Items), want) || page.InProgressCount != 1 {
				t.Errorf("%s = %v / count %d, want %v / 1", state, savedIDs(page.Items), page.InProgressCount, want)
			}
		}
	})

	t.Run("外すとどのタブにも出ず、2 回目も成功する", func(t *testing.T) {
		for range 2 {
			if err := env.Service.RemoveSaved(t.Context(), r.member, r.ws.ID, second.ID); err != nil {
				t.Fatalf("RemoveSaved: %v", err)
			}
		}
		if page := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{State: chat.SavedArchived}); len(page.Items) != 0 {
			t.Errorf("archived = %v, want 空", savedIDs(page.Items))
		}
		if got := getMessage(t, env, r.member, room.ID, second.ID); got.Saved {
			t.Error("外した後の saved = true")
		}
		// 外した行はタブで動かせない
		if _, err := env.Service.MoveSaved(t.Context(), r.member, r.ws.ID, second.ID, chat.SavedInProgress); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})

	t.Run("外したものを保存し直すと、進行中の先頭に戻る", func(t *testing.T) {
		if _, err := env.Service.SaveMessage(t.Context(), r.member, room.ID, second.ID); err != nil {
			t.Fatal(err)
		}
		page := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{})
		if !slices.Equal(savedIDs(page.Items), []ulid.ULID{second.ID, first.ID}) {
			t.Errorf("in_progress = %v, want [second first]", savedIDs(page.Items))
		}
	})

	t.Run("保存していないものを外しても成功する", func(t *testing.T) {
		if err := env.Service.RemoveSaved(t.Context(), r.member, r.ws.ID, ulid.Make()); err != nil {
			t.Errorf("RemoveSaved: %v", err)
		}
	})

	t.Run("状態でないタブの指定は 422", func(t *testing.T) {
		_, err := env.Service.MoveSaved(t.Context(), r.member, r.ws.ID, first.ID, chat.SavedRemoved)
		var ve *chat.ValidationError
		if !errors.As(err, &ve) || ve.Fields[0].Field != "state" {
			t.Errorf("error = %v, want state: invalid_value", err)
		}
	})
}

// TestSavedChangesSync は、切断中の別の端末が差分で追いつけることを確かめる（ロードマップ Phase 6.12 の DoD）。
func TestSavedChangesSync(t *testing.T) {
	env := chattest.New(t)
	r, room, first := reactionRoom(t, env)
	second := send(t, env, r.member2, room.ID, "2 つ目")
	if _, err := env.Service.SaveMessage(t.Context(), r.member, room.ID, first.ID); err != nil {
		t.Fatal(err)
	}

	// ここで別の端末が一覧を読んで、カーソルを持ったまま切断した
	cursor := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{}).LastChangeSeq

	if _, err := env.Service.SaveMessage(t.Context(), r.member, room.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.MoveSaved(t.Context(), r.member, r.ws.ID, second.ID, chat.SavedArchived); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.RemoveSaved(t.Context(), r.member, r.ws.ID, first.ID); err != nil {
		t.Fatal(err)
	}

	page := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{AfterChangeSeq: &cursor})
	got := map[ulid.ULID]chat.SavedState{}
	for _, it := range page.Items {
		got[it.MessageID] = it.State
		if it.ChangeSeq <= cursor {
			t.Errorf("change_seq %d はカーソル %d 以下", it.ChangeSeq, cursor)
		}
	}
	// 1 つの行は最後の状態だけが出る（行を上書きしているので、途中の状態は残らない）
	if len(page.Items) != 2 || got[second.ID] != chat.SavedArchived || got[first.ID] != chat.SavedRemoved {
		t.Errorf("差分 = %v, want second: archived / first: removed", got)
	}
	if page.LastChangeSeq != cursor+3 {
		t.Errorf("last_change_seq = %d, want %d（保存・移動・外すの 3 回）", page.LastChangeSeq, cursor+3)
	}

	t.Run("他人の保存の番号とは混ざらない", func(t *testing.T) {
		if _, err := env.Service.SaveMessage(t.Context(), r.member2, room.ID, first.ID); err != nil {
			t.Fatal(err)
		}
		mine := listSaved(t, env, r.member, r.ws.ID, chat.SavedQuery{AfterChangeSeq: &page.LastChangeSeq})
		if len(mine.Items) != 0 {
			t.Errorf("member の差分 = %v, want 空", savedIDs(mine.Items))
		}
	})
}

// TestSavedBecomesUnavailable は、読めなくなった保存が中身を返さず、読めるようになったら戻ることを確かめる（決定 8）。
func TestSavedBecomesUnavailable(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	private := createRoom(t, env, r.member, r.ws.ID, "private", "himitsu")
	if err := env.Service.AddRoomMember(t.Context(), r.member, private.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	secret := send(t, env, r.member, private.ID, "内緒の手順")
	deleted := send(t, env, r.member, private.ID, "あとで消える")
	for _, m := range []chat.Message{secret, deleted} {
		if _, err := env.Service.SaveMessage(t.Context(), r.member2, private.ID, m.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err := env.Service.DeleteMessage(t.Context(), r.member, private.ID, deleted.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.RemoveRoomMember(t.Context(), r.member2, private.ID, r.member2); err != nil {
		t.Fatal(err)
	}

	page := listSaved(t, env, r.member2, r.ws.ID, chat.SavedQuery{})

	t.Run("読めない・削除済みは行を残し、中身を返さず、区別もしない", func(t *testing.T) {
		if len(page.Items) != 2 || page.InProgressCount != 2 {
			t.Fatalf("items = %d 件 / count %d, want 2 / 2", len(page.Items), page.InProgressCount)
		}
		for _, it := range page.Items {
			if it.Status != chat.SavedItemUnavailable || it.Message != nil || it.Room != nil {
				t.Errorf("item %s = status %s / message %+v / room %+v", it.MessageID, it.Status, it.Message, it.Room)
			}
		}
	})

	t.Run("読めなくても、タブの移動と外すはできる", func(t *testing.T) {
		moved, err := env.Service.MoveSaved(t.Context(), r.member2, r.ws.ID, secret.ID, chat.SavedArchived)
		if err != nil || moved.Status != chat.SavedItemUnavailable || moved.Message != nil {
			t.Errorf("moved = %+v, err = %v", moved, err)
		}
		if err := env.Service.RemoveSaved(t.Context(), r.member2, r.ws.ID, deleted.ID); err != nil {
			t.Errorf("RemoveSaved: %v", err)
		}
	})

	t.Run("ルームに入り直すと、中身が戻る", func(t *testing.T) {
		if err := env.Service.AddRoomMember(t.Context(), r.member, private.ID, r.member2); err != nil {
			t.Fatal(err)
		}
		page := listSaved(t, env, r.member2, r.ws.ID, chat.SavedQuery{State: chat.SavedArchived})
		if len(page.Items) != 1 || page.Items[0].Status != chat.SavedItemOK || page.Items[0].Message.Body != secret.Body {
			t.Errorf("items = %+v", page.Items)
		}
	})
}

func TestSavedIsScopedToWorkspaceMembership(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)
	if _, err := env.Service.SaveMessage(t.Context(), r.member2, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}

	t.Run("ワークスペースの外の人は一覧を読めない", func(t *testing.T) {
		if _, err := env.Service.ListSaved(t.Context(), r.outsider, r.ws.ID, chat.SavedQuery{}); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})

	t.Run("ワークスペースから外れると保存も消える", func(t *testing.T) {
		if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.member2); err != nil {
			t.Fatal(err)
		}
		env.AddMember(t, r.ws.ID, r.member2, "member")
		if page := listSaved(t, env, r.member2, r.ws.ID, chat.SavedQuery{}); len(page.Items) != 0 {
			t.Errorf("items = %v, want 空", savedIDs(page.Items))
		}
	})
}

// TestConcurrentSavesKeepChangeSeq は、同じ人が多数のタブから同時に保存・移動しても、
// 本人ごとの番号が重複も欠番もしないことを確かめる（決定 7。番号の採番は本人の行ロックで直列になる）。
func TestConcurrentSavesKeepChangeSeq(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "concurrent-saves")
	const n = 30
	msgs := make([]chat.Message, n)
	for i := range msgs {
		msgs[i] = send(t, env, r.member, room.ID, "保存して")
	}

	errs := make([]error, n)
	var wg sync.WaitGroup
	for i, m := range msgs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// 同じメッセージを 2 回保存しても 1 回ぶんしか番号を使わない。完了への移動で 1 つ使う
			for range 2 {
				if _, err := env.Service.SaveMessage(t.Context(), r.member2, room.ID, m.ID); err != nil {
					errs[i] = err
					return
				}
			}
			_, errs[i] = env.Service.MoveSaved(t.Context(), r.member2, r.ws.ID, m.ID, chat.SavedCompleted)
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: %v", i, err)
		}
	}

	zero := int64(0)
	page := listSaved(t, env, r.member2, r.ws.ID, chat.SavedQuery{AfterChangeSeq: &zero, Limit: chat.MaxSavedLimit})
	if page.LastChangeSeq != 2*n {
		t.Errorf("last_change_seq = %d, want %d", page.LastChangeSeq, 2*n)
	}
	seqs := make([]int64, len(page.Items))
	for i, it := range page.Items {
		seqs[i] = it.ChangeSeq
		if it.State != chat.SavedCompleted {
			t.Errorf("item %s = %s, want completed", it.MessageID, it.State)
		}
	}
	if len(seqs) != n || !slices.IsSorted(seqs) || len(slices.Compact(slices.Clone(seqs))) != n {
		t.Errorf("change_seq = %v, want %d 個の重複のない昇順", seqs, n)
	}
}
