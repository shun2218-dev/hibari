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

// ピン留め（ADR 0054）。

// pinnedLogs はルームのピン留めのログ（message_pinned）を古い順に返す。
func pinnedLogs(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID) []chat.Message {
	t.Helper()
	page, err := env.Service.ListMessages(t.Context(), actor, roomID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var logs []chat.Message
	for _, m := range page.Messages {
		if m.System != nil && m.System.Type == chat.SystemMessagePinned {
			logs = append(logs, m)
		}
	}
	return logs
}

func TestPinAndUnpinMessage(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)
	env.Deliveries.Take() // 準備（参加のログなど）のぶんを捨てる

	got, err := env.Service.PinMessage(t.Context(), r.member2, room.ID, msg.ID)
	if err != nil {
		t.Fatalf("PinMessage: %v", err)
	}
	evs := env.Deliveries.Take()

	t.Run("誰がいつピン留めしたかが載る", func(t *testing.T) {
		if got.Pinned == nil || got.Pinned.By.ID != r.member2 || got.Pinned.At.IsZero() {
			t.Fatalf("pinned = %+v, want member2", got.Pinned)
		}
		// 別の人から読み直しても同じ（見る人によらない値。決定 2）
		if again := getMessage(t, env, r.admin, room.ID, msg.ID); again.Pinned == nil || again.Pinned.By.ID != r.member2 {
			t.Errorf("admin から見た pinned = %+v", again.Pinned)
		}
	})

	t.Run("change_seq は進むが、seq と未読と編集済みは動かない", func(t *testing.T) {
		if got.ChangeSeq <= msg.ChangeSeq {
			t.Errorf("change_seq = %d, want > %d", got.ChangeSeq, msg.ChangeSeq)
		}
		if got.Seq != msg.Seq || got.UserSeq != msg.UserSeq || got.EditedAt != nil {
			t.Errorf("seq, user_seq, edited_at = %d, %d, %v", got.Seq, got.UserSeq, got.EditedAt)
		}
	})

	t.Run("message.updated と、チャンネルのログの message.created を番号の順に配る", func(t *testing.T) {
		if len(evs) != 2 || evs[0].Type != chat.EventMessageUpdated || evs[1].Type != chat.EventMessageCreated {
			t.Fatalf("events = %+v, want message.updated → message.created", evs)
		}
		log := evs[1].Data.(chat.Message)
		if log.Sender.ID != r.member2 || log.System == nil || log.System.Type != chat.SystemMessagePinned ||
			log.System.MessageID == nil || *log.System.MessageID != msg.ID {
			t.Errorf("log = %+v, want member2 が msg をピン留めしたログ", log)
		}
		// ログはメッセージの更新の後の番号（再接続の差分で同じ順に並ぶ）
		if log.ChangeSeq != got.ChangeSeq+1 {
			t.Errorf("log.change_seq = %d, want %d", log.ChangeSeq, got.ChangeSeq+1)
		}
		// ログは未読に数えない（ADR 0033）
		if log.UserSeq != got.UserSeq {
			t.Errorf("log.user_seq = %d, want %d（進まない）", log.UserSeq, got.UserSeq)
		}
	})

	t.Run("外すと消え、ログは残さない", func(t *testing.T) {
		after, err := env.Service.UnpinMessage(t.Context(), r.member, room.ID, msg.ID)
		if err != nil {
			t.Fatalf("UnpinMessage: %v", err)
		}
		if after.Pinned != nil {
			t.Errorf("pinned = %+v, want nil", after.Pinned)
		}
		if evs := env.Deliveries.Take(); len(evs) != 1 || evs[0].Type != chat.EventMessageUpdated {
			t.Errorf("events = %+v, want 1 件の message.updated", evs)
		}
		if logs := pinnedLogs(t, env, r.member, room.ID); len(logs) != 1 {
			t.Errorf("ピン留めのログ = %d 件, want 1（外したときは残さない）", len(logs))
		}
	})

	t.Run("再接続の差分に乗る", func(t *testing.T) {
		after := msg.ChangeSeq
		page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{AfterChangeSeq: &after})
		if err != nil {
			t.Fatal(err)
		}
		if !slices.ContainsFunc(page.Messages, func(m chat.Message) bool { return m.ID == msg.ID && m.Pinned == nil }) {
			t.Errorf("差分に外した後のメッセージが無い: %+v", page.Messages)
		}
	})
}

func TestPinIsIdempotent(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	first, err := env.Service.PinMessage(t.Context(), r.member, room.ID, msg.ID)
	if err != nil {
		t.Fatal(err)
	}
	env.Deliveries.Take()

	t.Run("ピン留め済みをもう一度ピン留めしても、番号も配信もログも使わない", func(t *testing.T) {
		second, err := env.Service.PinMessage(t.Context(), r.member2, room.ID, msg.ID)
		if err != nil {
			t.Fatalf("PinMessage: %v", err)
		}
		if second.ChangeSeq != first.ChangeSeq || second.Pinned == nil || second.Pinned.By.ID != r.member {
			t.Errorf("second = change_seq %d / pinned %+v, want 変わらない", second.ChangeSeq, second.Pinned)
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v, want なし", evs)
		}
		if logs := pinnedLogs(t, env, r.member, room.ID); len(logs) != 1 {
			t.Errorf("ピン留めのログ = %d 件, want 1", len(logs))
		}
	})

	t.Run("ピン留めされていないものを外しても、何も起きない", func(t *testing.T) {
		other := send(t, env, r.member, room.ID, "ピンなし")
		env.Deliveries.Take()
		got, err := env.Service.UnpinMessage(t.Context(), r.member, room.ID, other.ID)
		if err != nil {
			t.Fatalf("UnpinMessage: %v", err)
		}
		if got.ChangeSeq != other.ChangeSeq {
			t.Errorf("change_seq = %d, want %d", got.ChangeSeq, other.ChangeSeq)
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v, want なし", evs)
		}
	})
}

func TestPinAuthorization(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)

	t.Run("参加していない public ルームでは付けられない（読めるが投稿できない）", func(t *testing.T) {
		_, err := env.Service.PinMessage(t.Context(), r.owner, room.ID, msg.ID)
		if !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("error = %v, want ErrForbidden", err)
		}
	})

	t.Run("ワークスペースの外の人には、ルームが見えない", func(t *testing.T) {
		_, err := env.Service.PinMessage(t.Context(), r.outsider, room.ID, msg.ID)
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})

	t.Run("削除済みのメッセージはピン留めできない", func(t *testing.T) {
		deleted := send(t, env, r.member, room.ID, "消す")
		if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, deleted.ID); err != nil {
			t.Fatal(err)
		}
		_, err := env.Service.PinMessage(t.Context(), r.member, room.ID, deleted.ID)
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})

	t.Run("システムメッセージはピン留めできない", func(t *testing.T) {
		page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{})
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(page.Messages, func(m chat.Message) bool { return m.Kind == chat.MessageKindSystem })
		if i < 0 {
			t.Fatal("システムメッセージが無い（参加のログが出るはず）")
		}
		_, err = env.Service.PinMessage(t.Context(), r.member, room.ID, page.Messages[i].ID)
		var ve *chat.ValidationError
		if !errors.As(err, &ve) || ve.Fields[0].Field != "message_id" {
			t.Errorf("error = %v, want message_id: invalid_value", err)
		}
	})

	t.Run("スレッドの返信はピン留めでき、ログはチャンネルに出る", func(t *testing.T) {
		rep := reply(t, env, r.member2, room.ID, msg.ID, "返信")
		got, err := env.Service.PinMessage(t.Context(), r.member, room.ID, rep.ID)
		if err != nil {
			t.Fatalf("PinMessage: %v", err)
		}
		if got.Pinned == nil {
			t.Fatal("pinned = nil")
		}
		logs := pinnedLogs(t, env, r.member, room.ID)
		if len(logs) == 0 || *logs[len(logs)-1].System.MessageID != rep.ID {
			t.Errorf("チャンネルのログに返信のピン留めが無い: %+v", logs)
		}
	})
}

func TestPinInDMLeavesNoLog(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	msg := send(t, env, r.member, dm.ID, "覚えておいて")

	got, err := env.Service.PinMessage(t.Context(), r.member2, dm.ID, msg.ID)
	if err != nil {
		t.Fatalf("PinMessage: %v", err)
	}
	if got.Pinned == nil {
		t.Fatal("pinned = nil")
	}
	// DM にはシステムメッセージを書かない（ADR 0033）
	if logs := pinnedLogs(t, env, r.member, dm.ID); len(logs) != 0 {
		t.Errorf("DM のピン留めのログ = %d 件, want 0", len(logs))
	}
}

func TestDeletingMessageUnpinsIt(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := reactionRoom(t, env)
	if _, err := env.Service.PinMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}

	if got := getMessage(t, env, r.member, room.ID, msg.ID); got.Pinned != nil {
		t.Errorf("削除後の pinned = %+v, want nil", got.Pinned)
	}
	pins, err := env.Service.ListPins(t.Context(), r.member, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(pins) != 0 {
		t.Errorf("pins = %d 件, want 0（削除したものは枠を使わない）", len(pins))
	}
}

func TestListPins(t *testing.T) {
	env := chattest.New(t)
	r, room, first := reactionRoom(t, env)
	second := send(t, env, r.member2, room.ID, "2 つ目")
	unpinned := send(t, env, r.member2, room.ID, "ピンなし")

	for _, m := range []chat.Message{first, second} {
		env.Clock.Advance(time.Second)
		if _, err := env.Service.PinMessage(t.Context(), r.member, room.ID, m.ID); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("ピン留めした新しい順に、ピン留めしたものだけを返す", func(t *testing.T) {
		pins, err := env.Service.ListPins(t.Context(), r.member, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]ulid.ULID, len(pins))
		for i, p := range pins {
			ids[i] = p.ID
		}
		if !slices.Equal(ids, []ulid.ULID{second.ID, first.ID}) {
			t.Errorf("ids = %v, want [second first]（%s はピンなし）", ids, unpinned.ID)
		}
	})

	t.Run("参加していない public ルームでも読める", func(t *testing.T) {
		pins, err := env.Service.ListPins(t.Context(), r.owner, room.ID)
		if err != nil || len(pins) != 2 {
			t.Errorf("pins = %d 件, err = %v; want 2 件", len(pins), err)
		}
	})

	t.Run("読めないルームは見えない", func(t *testing.T) {
		private := createRoom(t, env, r.member, r.ws.ID, "private", "himitsu")
		if _, err := env.Service.ListPins(t.Context(), r.member2, private.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})
}

// TestConcurrentPinsRespectLimit は、上限の手前で多数の goroutine が同時にピン留めしても、
// 100 件を超えないことを確かめる（ロードマップ Phase 6.12 の DoD。ADR 0054 決定 4）。
func TestConcurrentPinsRespectLimit(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "concurrent-pins")

	const already, racers = chat.MaxRoomPins - 5, 20
	msgs := make([]chat.Message, already+racers)
	for i := range msgs {
		msgs[i] = send(t, env, r.member, room.ID, fmt.Sprintf("メッセージ %d", i))
	}
	for _, m := range msgs[:already] {
		if _, err := env.Service.PinMessage(t.Context(), r.member, room.ID, m.ID); err != nil {
			t.Fatal(err)
		}
	}

	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i, m := range msgs[already:] {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = env.Service.PinMessage(t.Context(), r.member, room.ID, m.ID)
		}()
	}
	wg.Wait()

	succeeded := 0
	for i, err := range errs {
		var ve *chat.ValidationError
		switch {
		case err == nil:
			succeeded++
		case errors.As(err, &ve) && ve.Fields[0].Field == "pinned" && ve.Fields[0].Reason == chat.ReasonTooMany:
		default:
			t.Fatalf("racer %d: %v", i, err)
		}
	}
	if succeeded != chat.MaxRoomPins-already {
		t.Errorf("成功 = %d, want %d", succeeded, chat.MaxRoomPins-already)
	}
	pins, err := env.Service.ListPins(t.Context(), r.member, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(pins) != chat.MaxRoomPins {
		t.Errorf("pins = %d 件, want %d", len(pins), chat.MaxRoomPins)
	}
}
