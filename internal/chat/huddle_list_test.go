package chat_test

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// ハドルの一覧と提案のカード（ADR 0067 決定 6・7）のテスト。

// endedHuddle は users が順に入って順に抜けた（最後の人が抜けて終わった）ハドルを作り、その ID を返す。
func endedHuddle(t *testing.T, env *chattest.Env, roomID ulid.ULID, users ...ulid.ULID) chat.JoinedHuddle {
	t.Helper()
	var joined []chat.JoinedHuddle
	for _, u := range users {
		joined = append(joined, joinHuddle(t, env, u, roomID))
	}
	// 所要時間を持たせる
	env.Clock.Advance(2 * time.Minute)
	for i, u := range users {
		if err := env.Service.LeaveHuddle(t.Context(), u, joined[i].Huddle.ID, joined[i].ParticipantID); err != nil {
			t.Fatal(err)
		}
	}
	env.Clock.Advance(time.Minute)
	return joined[0]
}

func pastHuddleIDs(p chat.Page[chat.PastHuddle]) []ulid.ULID {
	out := make([]ulid.ULID, len(p.Items))
	for i, h := range p.Items {
		out[i] = h.ID
	}
	return out
}

// TestListHuddles は一覧の範囲と絞り込みと、「いま読めるルームのハドルだけ」を確かめる（ADR 0067 決定 6）。
// SQL の `readable_rooms` は authz.CanReadRoom の写しなので、抜けた public（読める）と外された private（読めない）の両方を置く。
func TestListHuddles(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	me := r.member

	// デザイン: 自分が参加する前のハドル（h1）、参加した後の入らなかったハドル（h2）と入ったハドル（h3）
	design := createRoom(t, env, r.admin, r.ws.ID, "public", "design")
	h1 := endedHuddle(t, env, design.ID, r.admin)
	if _, err := env.Service.JoinRoom(t.Context(), me, design.ID); err != nil {
		t.Fatal(err)
	}
	env.Clock.Advance(time.Minute)
	h2 := endedHuddle(t, env, design.ID, r.admin)
	h3 := endedHuddle(t, env, design.ID, r.admin, me)
	if _, _, err := env.Service.SendMessage(t.Context(), r.admin, design.ID, chat.SendMessageInput{
		ClientMsgID: env.IDs.New(), Body: "メモ", ThreadRootID: &h3.Huddle.MessageID,
	}); err != nil {
		t.Fatal(err)
	}

	// 非公開: 入ったハドルがあるが、後でルームから外された（もう読めない）
	secret := createRoom(t, env, r.admin, r.ws.ID, "private", "secret")
	if err := env.Service.AddRoomMember(t.Context(), r.admin, secret.ID, me); err != nil {
		t.Fatal(err)
	}
	endedHuddle(t, env, secret.ID, r.admin, me)
	if err := env.Service.RemoveRoomMember(t.Context(), r.admin, secret.ID, me); err != nil {
		t.Fatal(err)
	}

	// 雑談: 入ったハドルがあり、その後ルームを抜けた（public なのでまだ読める）
	chatRoom := createRoom(t, env, r.member2, r.ws.ID, "public", "chat")
	if _, err := env.Service.JoinRoom(t.Context(), me, chatRoom.ID); err != nil {
		t.Fatal(err)
	}
	h5 := endedHuddle(t, env, chatRoom.ID, r.member2, me)
	if err := env.Service.RemoveRoomMember(t.Context(), me, chatRoom.ID, me); err != nil {
		t.Fatal(err)
	}

	// DM: 相手だけが入って終わった（不在着信）
	dm, _ := createDM(t, env, r.admin, r.ws.ID, me)
	h6 := endedHuddle(t, env, dm.ID, r.admin)

	// 進行中のハドルは出さない（上のカードに出す）
	joinHuddle(t, env, r.admin, design.ID)

	list := func(t *testing.T, q chat.HuddleListQuery) chat.Page[chat.PastHuddle] {
		t.Helper()
		p, err := env.Service.ListHuddles(t.Context(), me, r.ws.ID, q)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}

	tests := []struct {
		name string
		q    chat.HuddleListQuery
		want []ulid.ULID
	}{
		{"すべて: 参加した後のメンバーのルームのハドルと、自分が入ったハドル（読めるものだけ）", chat.HuddleListQuery{}, []ulid.ULID{h6.Huddle.ID, h5.Huddle.ID, h3.Huddle.ID, h2.Huddle.ID}},
		{"参加しなかった: 参加した後に始まり、自分が入らなかったもの", chat.HuddleListQuery{Scope: chat.HuddleListMissed}, []ulid.ULID{h6.Huddle.ID, h2.Huddle.ID}},
		{"相手で絞る", chat.HuddleListQuery{ParticipantID: &r.member2}, []ulid.ULID{h5.Huddle.ID}},
		{"場所で絞る", chat.HuddleListQuery{RoomID: &design.ID}, []ulid.ULID{h3.Huddle.ID, h2.Huddle.ID}},
		{"範囲と場所を組み合わせる", chat.HuddleListQuery{Scope: chat.HuddleListMissed, RoomID: &design.ID}, []ulid.ULID{h2.Huddle.ID}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := pastHuddleIDs(list(t, tt.q)); !slices.Equal(got, tt.want) {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
	// h1（参加する前のハドル）は、どの範囲にも出ない（上の want に含めていない）
	_ = h1

	t.Run("行に場所・参加した人・返信の数が載る", func(t *testing.T) {
		p := list(t, chat.HuddleListQuery{})
		byID := map[ulid.ULID]chat.PastHuddle{}
		for _, h := range p.Items {
			byID[h.ID] = h
		}
		got := byID[h3.Huddle.ID]
		if got.Room.ID != design.ID || got.Room.Name != "design" || got.MessageID != h3.Huddle.MessageID ||
			!slices.Equal(got.ParticipantIDs, []ulid.ULID{r.admin, me}) || got.ReplyCount != 1 || !got.EndedAt.After(got.StartedAt) {
			t.Errorf("h3 = %+v", got)
		}
		// DM は相手の名前で出す
		if dmRow := byID[h6.Huddle.ID]; dmRow.Room.Kind != chat.RoomKind("dm") || dmRow.Room.DMPeer == nil || dmRow.Room.DMPeer.ID != r.admin {
			t.Errorf("dm = %+v", dmRow.Room)
		}
	})

	t.Run("「後で」に保存したハドルのメッセージには印が付く", func(t *testing.T) {
		if _, err := env.Service.SaveMessage(t.Context(), me, design.ID, h2.Huddle.MessageID); err != nil {
			t.Fatal(err)
		}
		for _, h := range list(t, chat.HuddleListQuery{}).Items {
			if h.Saved != (h.ID == h2.Huddle.ID) {
				t.Errorf("%v の saved = %v", h.ID, h.Saved)
			}
		}
	})

	t.Run("カーソルで続きを読む", func(t *testing.T) {
		first := list(t, chat.HuddleListQuery{Limit: 2})
		if !slices.Equal(pastHuddleIDs(first), []ulid.ULID{h6.Huddle.ID, h5.Huddle.ID}) || first.NextCursor == nil {
			t.Fatalf("first = %v, next = %v", pastHuddleIDs(first), first.NextCursor)
		}
		second := list(t, chat.HuddleListQuery{Limit: 2, Before: *first.NextCursor})
		if !slices.Equal(pastHuddleIDs(second), []ulid.ULID{h3.Huddle.ID, h2.Huddle.ID}) || second.NextCursor != nil {
			t.Errorf("second = %v, next = %v", pastHuddleIDs(second), second.NextCursor)
		}
	})

	t.Run("知らない範囲は 422、メンバーでなければ 404", func(t *testing.T) {
		var verr *chat.ValidationError
		if _, err := env.Service.ListHuddles(t.Context(), me, r.ws.ID, chat.HuddleListQuery{Scope: "everything"}); !errors.As(err, &verr) {
			t.Errorf("err = %v", err)
		}
		if _, err := env.Service.ListHuddles(t.Context(), r.outsider, r.ws.ID, chat.HuddleListQuery{}); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("err = %v", err)
		}
	})
}

func TestHuddleSuggestions(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	me := r.member

	room := func(name string) chat.Room {
		t.Helper()
		room := createRoom(t, env, me, r.ws.ID, "public", name)
		for _, u := range []ulid.ULID{r.member2, r.admin} {
			if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
				t.Fatal(err)
			}
		}
		return room
	}
	old, often, once, archived, live := room("old"), room("often"), room("once"), room("archived"), room("live")

	// 8 日前（数えない）
	endedHuddle(t, env, old.ID, me, r.admin)
	env.Clock.Advance(24 * time.Hour)
	endedHuddle(t, env, often.ID, me, r.member2)
	endedHuddle(t, env, often.ID, r.admin, me)
	endedHuddle(t, env, once.ID, me)
	endedHuddle(t, env, archived.ID, me)
	if _, err := env.Service.ArchiveRoom(t.Context(), r.admin, archived.ID); err != nil {
		t.Fatal(err)
	}
	endedHuddle(t, env, live.ID, me)
	// 1 人が入れるハドルは 1 つ（ADR 0066 決定 6）なので、この後ほかのハドルに入らない人で進行中にしておく
	joinHuddle(t, env, r.member2, live.ID)
	// 自分が入らなかったハドルは数えない
	endedHuddle(t, env, once.ID, r.admin)
	env.Clock.Advance(6 * 24 * time.Hour)

	got, err := env.Service.HuddleSuggestions(t.Context(), me, r.ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, s := range got {
		names = append(names, s.Room.Name)
	}
	// 回数の多い順。7 日より前・アーカイブ・進行中は除く
	if !slices.Equal(names, []string{"often", "once"}) {
		t.Fatalf("suggestions = %v", names)
	}
	if got[0].Count != 2 || !slices.Equal(sortedIDs(got[0].ParticipantIDs), sortedIDs([]ulid.ULID{r.member2, r.admin})) {
		t.Errorf("often = %+v", got[0])
	}
	if got[1].Count != 1 || !slices.Equal(got[1].ParticipantIDs, []ulid.ULID{r.admin}) {
		t.Errorf("once = %+v", got[1])
	}

	t.Run("7 日を過ぎたら出さない", func(t *testing.T) {
		env.Clock.Advance(2 * 24 * time.Hour)
		got, err := env.Service.HuddleSuggestions(t.Context(), me, r.ws.ID)
		if err != nil || len(got) != 0 {
			t.Errorf("suggestions = %+v, %v", got, err)
		}
	})

	t.Run("メンバーでなければ 404", func(t *testing.T) {
		if _, err := env.Service.HuddleSuggestions(t.Context(), r.outsider, r.ws.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("err = %v", err)
		}
	})
}

func sortedIDs(ids []ulid.ULID) []ulid.ULID {
	out := slices.Clone(ids)
	slices.SortFunc(out, ulid.ULID.Compare)
	return out
}
