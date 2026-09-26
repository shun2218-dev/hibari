package chat_test

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// 音声のハドル（ADR 0066）のサービスのテスト。Cloudflare は chattest.Media（偽物）、いま入っている人は実物の Redis。

func joinHuddle(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID) chat.JoinedHuddle {
	t.Helper()
	joined, err := env.Service.JoinHuddle(t.Context(), actor, env.IDs.New(), roomID, chat.JoinHuddleInput{Offer: chattest.Offer, Mid: "0"})
	if err != nil {
		t.Fatalf("JoinHuddle: %v", err)
	}
	return joined
}

func eventsOfType(evs []chat.Event, typ chat.EventType) []chat.Event {
	return slices.DeleteFunc(slices.Clone(evs), func(ev chat.Event) bool { return ev.Type != typ })
}

func huddleUserIDs(h *chat.RoomHuddle) []ulid.ULID {
	if h == nil {
		return nil
	}
	out := make([]ulid.ULID, len(h.Participants))
	for i, p := range h.Participants {
		out[i] = p.UserID
	}
	return out
}

func huddleRoom(t *testing.T, env *chattest.Env) (roles, chat.Room) {
	t.Helper()
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "huddle")
	for _, u := range []ulid.ULID{r.member2, r.admin} {
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	env.Deliveries.Take()
	return r, room
}

func TestJoinHuddle(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)

	first := joinHuddle(t, env, r.member, room.ID)
	evs := env.Deliveries.Take()

	t.Run("始めると会話にメッセージを残し、answer を返す", func(t *testing.T) {
		if first.Answer.Type != "answer" || first.ParticipantID.IsZero() {
			t.Errorf("joined = %+v", first)
		}
		created := eventsOfType(evs, chat.EventMessageCreated)
		if len(created) != 1 {
			t.Fatalf("message.created = %d", len(created))
		}
		msg := created[0].Data.(chat.Message)
		if msg.Kind != chat.MessageKindSystem || msg.System.Type != chat.SystemHuddle || msg.Sender.ID != r.member {
			t.Errorf("message = %+v", msg)
		}
		if msg.Huddle == nil || msg.Huddle.ID != first.Huddle.ID || !slices.Equal(msg.Huddle.ParticipantIDs, []ulid.ULID{r.member}) || msg.Huddle.EndedAt != nil {
			t.Errorf("message huddle = %+v", msg.Huddle)
		}
		// チャンネルでは未読に数えない（ADR 0066 決定 12）
		if msg.UserSeq != 0 {
			t.Errorf("user_seq = %d", msg.UserSeq)
		}
	})
	t.Run("ルームの購読者に、いまの全体を配る", func(t *testing.T) {
		updated := eventsOfType(evs, chat.EventHuddleUpdated)
		if len(updated) != 1 {
			t.Fatalf("huddle.updated = %d", len(updated))
		}
		d := updated[0].Data.(chat.HuddleUpdated)
		if !slices.Equal(updated[0].To.Rooms, []ulid.ULID{room.ID}) || d.Huddle == nil || !slices.Equal(huddleUserIDs(d.Huddle), []ulid.ULID{r.member}) {
			t.Errorf("huddle.updated = %+v", updated[0])
		}
		// チャンネルでは呼び出さない（決定 11）
		if n := len(eventsOfType(evs, chat.EventHuddleRinging)); n != 0 {
			t.Errorf("huddle.ringing = %d", n)
		}
	})

	second := joinHuddle(t, env, r.member2, room.ID)
	evs = env.Deliveries.Take()

	t.Run("進行中のハドルに入る", func(t *testing.T) {
		if second.Huddle.ID != first.Huddle.ID || second.Huddle.Version <= first.Huddle.Version {
			t.Errorf("second = %+v, first = %+v", second.Huddle, first.Huddle)
		}
		if got := huddleUserIDs(&second.Huddle); !slices.Equal(got, []ulid.ULID{r.member, r.member2}) {
			t.Errorf("participants = %v", got)
		}
		// 初めて入った人が増えたので、会話のメッセージの参加者も増える（差分の同期でもそろう）
		updated := eventsOfType(evs, chat.EventMessageUpdated)
		if len(updated) != 1 {
			t.Fatalf("message.updated = %d", len(updated))
		}
		if ids := updated[0].Data.(chat.Message).Huddle.ParticipantIDs; !slices.Equal(ids, []ulid.ULID{r.member, r.member2}) {
			t.Errorf("participant ids = %v", ids)
		}
	})
	t.Run("ルームの取得に進行中のハドルが載る", func(t *testing.T) {
		got, err := env.Service.GetRoom(t.Context(), r.admin, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Huddle == nil || got.Huddle.ID != first.Huddle.ID || !slices.Equal(huddleUserIDs(got.Huddle), []ulid.ULID{r.member, r.member2}) {
			t.Errorf("room huddle = %+v", got.Huddle)
		}
		rooms, err := env.Service.ListRooms(t.Context(), r.admin, r.ws.ID)
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(rooms, func(x chat.Room) bool { return x.ID == room.ID })
		if i < 0 || rooms[i].Huddle == nil {
			t.Errorf("listed room huddle missing")
		}
	})
}

// 入れるのはそのルームに投稿できる人だけ（ADR 0066 決定 7）。Cloudflare を呼ぶ前に止める。
func TestJoinHuddleAuthz(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	private := createRoom(t, env, r.member, r.ws.ID, "private", "secret")

	tests := []struct {
		name   string
		actor  ulid.ULID
		roomID ulid.ULID
		want   error
	}{
		{"ワークスペースの外の人", r.outsider, room.ID, chat.ErrNotFound},
		{"参加していない public（読めるだけ）", r.admin2, room.ID, chat.ErrForbidden},
		{"メンバーでない private", r.member2, private.ID, chat.ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := env.Service.HuddleICEServers(t.Context(), tt.actor, tt.roomID); !errors.Is(err, tt.want) {
				t.Errorf("HuddleICEServers err = %v, want %v", err, tt.want)
			}
			_, err := env.Service.JoinHuddle(t.Context(), tt.actor, env.IDs.New(), tt.roomID, chat.JoinHuddleInput{Offer: chattest.Offer, Mid: "0"})
			if !errors.Is(err, tt.want) {
				t.Errorf("JoinHuddle err = %v, want %v", err, tt.want)
			}
		})
	}
	t.Run("アーカイブしたルーム", func(t *testing.T) {
		archived := createRoom(t, env, r.admin, r.ws.ID, "public", "archived")
		if _, err := env.Service.ArchiveRoom(t.Context(), r.admin, archived.ID); err != nil {
			t.Fatal(err)
		}
		_, err := env.Service.JoinHuddle(t.Context(), r.admin, env.IDs.New(), archived.ID, chat.JoinHuddleInput{Offer: chattest.Offer, Mid: "0"})
		if !errors.Is(err, chat.ErrRoomArchived) {
			t.Errorf("err = %v, want ErrRoomArchived", err)
		}
	})
	t.Run("offer の形が違う", func(t *testing.T) {
		for _, in := range []chat.JoinHuddleInput{
			{Offer: chat.SessionDescription{Type: "answer", SDP: chattest.Offer.SDP}, Mid: "0"},
			{Offer: chat.SessionDescription{Type: "offer", SDP: "not sdp"}, Mid: "0"},
			{Offer: chattest.Offer, Mid: ""},
		} {
			var verr *chat.ValidationError
			if _, err := env.Service.JoinHuddle(t.Context(), r.member, env.IDs.New(), room.ID, in); !errors.As(err, &verr) {
				t.Errorf("JoinHuddle(%+v) err = %v", in, err)
			}
		}
	})
	if n := len(env.Media.Closed()); n != 0 {
		t.Errorf("created %d Cloudflare sessions for rejected requests", n)
	}
}

// Cloudflare の設定がなければ、ハドルだけが使えない（ADR 0066 決定 15）。
func TestHuddlesUnavailable(t *testing.T) {
	env := chattest.New(t, chattest.WithoutHuddles())
	r, room := huddleRoom(t, env)

	if _, err := env.Service.HuddleICEServers(t.Context(), r.member, room.ID); !errors.Is(err, chat.ErrHuddlesUnavailable) {
		t.Errorf("HuddleICEServers err = %v", err)
	}
	if _, err := env.Service.JoinHuddle(t.Context(), r.member, env.IDs.New(), room.ID, chat.JoinHuddleInput{Offer: chattest.Offer, Mid: "0"}); !errors.Is(err, chat.ErrHuddlesUnavailable) {
		t.Errorf("JoinHuddle err = %v", err)
	}
	got, err := env.Service.GetRoom(t.Context(), r.member, room.ID)
	if err != nil || got.Huddle != nil {
		t.Errorf("GetRoom = %+v, %v", got.Huddle, err)
	}
}

// 2 人が同時に始めても、ルームのハドルは 1 つになる（ADR 0066 決定 3。CLAUDE.md の並行テスト）。
func TestConcurrentHuddleStart(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "race")
	users := env.CreateUsers(t, 8)
	for _, u := range users {
		env.AddMember(t, r.ws.ID, u, authz.RoleMember)
		env.InsertRoomMember(t, room.ID, u)
	}
	env.Deliveries.Take()

	var wg sync.WaitGroup
	huddleIDs := make([]ulid.ULID, len(users))
	for i, u := range users {
		wg.Go(func() {
			joined, err := env.Service.JoinHuddle(t.Context(), u, env.IDs.New(), room.ID, chat.JoinHuddleInput{Offer: chattest.Offer, Mid: "0"})
			if err != nil {
				t.Error(err)
				return
			}
			huddleIDs[i] = joined.Huddle.ID
		})
	}
	wg.Wait()

	for _, id := range huddleIDs[1:] {
		if id != huddleIDs[0] {
			t.Fatalf("huddles = %v", huddleIDs)
		}
	}
	created := eventsOfType(env.Deliveries.Take(), chat.EventMessageCreated)
	if len(created) != 1 {
		t.Errorf("huddle messages = %d", len(created))
	}
	got, err := env.Service.GetRoom(t.Context(), r.member, room.ID)
	if err != nil || got.Huddle == nil || len(got.Huddle.Participants) != len(users) {
		t.Errorf("room huddle = %+v, %v", got.Huddle, err)
	}
}

// 最後の人が抜けるとハドルが終わり、会話のメッセージが「終了」になる（ADR 0066 決定 12）。
func TestLeaveHuddle(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	a := joinHuddle(t, env, r.member, room.ID)
	b := joinHuddle(t, env, r.member2, room.ID)
	env.Deliveries.Take()

	t.Run("他人の参加では抜けられない", func(t *testing.T) {
		if err := env.Service.LeaveHuddle(t.Context(), r.member2, a.Huddle.ID, a.ParticipantID); err != nil {
			t.Fatal(err)
		}
		got, _ := env.Service.GetRoom(t.Context(), r.member, room.ID)
		if len(got.Huddle.Participants) != 2 {
			t.Errorf("participants = %+v", got.Huddle.Participants)
		}
	})
	t.Run("1 人抜けても続く", func(t *testing.T) {
		if err := env.Service.LeaveHuddle(t.Context(), r.member, a.Huddle.ID, a.ParticipantID); err != nil {
			t.Fatal(err)
		}
		evs := env.Deliveries.Take()
		left := eventsOfType(evs, chat.EventHuddleLeft)
		if len(left) != 1 || !slices.Equal(left[0].To.Users, []ulid.ULID{r.member}) || left[0].Data.(chat.HuddleLeftData).Reason != chat.HuddleLeft {
			t.Errorf("huddle.left = %+v", left)
		}
		updated := eventsOfType(evs, chat.EventHuddleUpdated)
		if len(updated) != 1 || !slices.Equal(huddleUserIDs(updated[0].Data.(chat.HuddleUpdated).Huddle), []ulid.ULID{r.member2}) {
			t.Errorf("huddle.updated = %+v", updated)
		}
		if !slices.Contains(env.Media.Closed(), "sfu-session-1") {
			t.Errorf("closed = %v", env.Media.Closed())
		}
	})
	t.Run("最後の人が抜けると終わる", func(t *testing.T) {
		env.Clock.Advance(12 * time.Minute)
		if err := env.Service.LeaveHuddle(t.Context(), r.member2, b.Huddle.ID, b.ParticipantID); err != nil {
			t.Fatal(err)
		}
		evs := env.Deliveries.Take()
		updated := eventsOfType(evs, chat.EventHuddleUpdated)
		if len(updated) != 1 || updated[0].Data.(chat.HuddleUpdated).Huddle != nil {
			t.Errorf("huddle.updated = %+v", updated)
		}
		msgs := eventsOfType(evs, chat.EventMessageUpdated)
		if len(msgs) != 1 {
			t.Fatalf("message.updated = %d", len(msgs))
		}
		h := msgs[0].Data.(chat.Message).Huddle
		if h.EndedAt == nil || h.EndedAt.Sub(h.StartedAt) != 12*time.Minute || len(h.ParticipantIDs) != 2 {
			t.Errorf("message huddle = %+v", h)
		}
		got, _ := env.Service.GetRoom(t.Context(), r.member, room.ID)
		if got.Huddle != nil {
			t.Errorf("room huddle = %+v", got.Huddle)
		}
	})
	t.Run("終わった後は新しいハドルが始まる", func(t *testing.T) {
		again := joinHuddle(t, env, r.member, room.ID)
		if again.Huddle.ID == a.Huddle.ID {
			t.Error("joined the ended huddle")
		}
	})
}

// 心拍が途絶えた参加は、掃除で外れる（ADR 0066 決定 5）。
func TestSweepHuddles(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	stale := joinHuddle(t, env, r.member, room.ID)
	alive := joinHuddle(t, env, r.member2, room.ID)
	env.Deliveries.Take()

	env.Clock.Advance(20 * time.Second)
	if ok, err := env.Service.HeartbeatHuddle(t.Context(), r.member2, alive.Huddle.ID, alive.ParticipantID); err != nil || !ok {
		t.Fatalf("heartbeat = %v, %v", ok, err)
	}
	// 別の人の参加の心拍は通らない
	if ok, _ := env.Service.HeartbeatHuddle(t.Context(), r.member2, stale.Huddle.ID, stale.ParticipantID); ok {
		t.Error("heartbeat for someone else's participant succeeded")
	}
	env.Clock.Advance(15 * time.Second)

	if n := env.Service.SweepHuddles(t.Context()); n != 1 {
		t.Fatalf("swept = %d", n)
	}
	evs := env.Deliveries.Take()
	left := eventsOfType(evs, chat.EventHuddleLeft)
	if len(left) != 1 || left[0].Data.(chat.HuddleLeftData).Reason != chat.HuddleExpired || !slices.Equal(left[0].To.Users, []ulid.ULID{r.member}) {
		t.Errorf("huddle.left = %+v", left)
	}
	if ok, _ := env.Service.HeartbeatHuddle(t.Context(), r.member, stale.Huddle.ID, stale.ParticipantID); ok {
		t.Error("expired participant's heartbeat succeeded")
	}
	got, _ := env.Service.GetRoom(t.Context(), r.member2, room.ID)
	if !slices.Equal(huddleUserIDs(got.Huddle), []ulid.ULID{r.member2}) {
		t.Errorf("participants = %v", huddleUserIDs(got.Huddle))
	}
}

// 別の端末から入ると、前の端末の参加は外れる（ADR 0066 決定 6）。
func TestJoinHuddleFromAnotherDevice(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	first := joinHuddle(t, env, r.member, room.ID)
	env.Deliveries.Take()

	second := joinHuddle(t, env, r.member, room.ID)

	if second.ParticipantID == first.ParticipantID || !slices.Equal(huddleUserIDs(&second.Huddle), []ulid.ULID{r.member}) {
		t.Errorf("second = %+v", second)
	}
	left := eventsOfType(env.Deliveries.Take(), chat.EventHuddleLeft)
	if len(left) != 1 {
		t.Fatalf("huddle.left = %+v", left)
	}
	d := left[0].Data.(chat.HuddleLeftData)
	if d.ParticipantID != first.ParticipantID || d.Reason != chat.HuddleMoved {
		t.Errorf("huddle.left = %+v", d)
	}
	// 前の端末の参加はもう使えない
	if err := env.Service.SetHuddleMuted(t.Context(), r.member, first.Huddle.ID, first.ParticipantID, true); !errors.Is(err, chat.ErrHuddleParticipantGone) {
		t.Errorf("SetHuddleMuted with old participant = %v", err)
	}
}

// キック・private からの削除・アーカイブで、すぐにハドルから外れる（CLAUDE.md ルール 8。ADR 0066 決定 8）。
func TestHuddleRemovedOnAccessChange(t *testing.T) {
	t.Run("ルームから外す", func(t *testing.T) {
		env := chattest.New(t)
		r, room := huddleRoom(t, env)
		if _, err := env.Service.HuddleICEServers(t.Context(), r.member2, room.ID); err != nil {
			t.Fatal(err)
		}
		joinHuddle(t, env, r.member, room.ID)
		victim := joinHuddle(t, env, r.member2, room.ID)
		env.Deliveries.Take()

		if err := env.Service.RemoveRoomMember(t.Context(), r.member2, room.ID, r.member2); err != nil {
			t.Fatal(err)
		}
		left := eventsOfType(env.Deliveries.Take(), chat.EventHuddleLeft)
		if len(left) != 1 || left[0].Data.(chat.HuddleLeftData).Reason != chat.HuddleRemoved || left[0].Data.(chat.HuddleLeftData).ParticipantID != victim.ParticipantID {
			t.Errorf("huddle.left = %+v", left)
		}
		// 外された人の TURN の認証情報は取り消す
		if len(env.Media.Revoked()) != 1 {
			t.Errorf("revoked = %v", env.Media.Revoked())
		}
		got, _ := env.Service.GetRoom(t.Context(), r.member, room.ID)
		if !slices.Equal(huddleUserIDs(got.Huddle), []ulid.ULID{r.member}) {
			t.Errorf("participants = %v", huddleUserIDs(got.Huddle))
		}
	})
	t.Run("ワークスペースから外す", func(t *testing.T) {
		env := chattest.New(t)
		r, room := huddleRoom(t, env)
		joinHuddle(t, env, r.member2, room.ID)
		env.Deliveries.Take()

		if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.member2); err != nil {
			t.Fatal(err)
		}
		if left := eventsOfType(env.Deliveries.Take(), chat.EventHuddleLeft); len(left) != 1 {
			t.Errorf("huddle.left = %+v", left)
		}
		got, _ := env.Service.GetRoom(t.Context(), r.member, room.ID)
		if got.Huddle != nil {
			t.Errorf("room huddle = %+v", got.Huddle)
		}
	})
	t.Run("アーカイブで入っている人ごと終わる", func(t *testing.T) {
		env := chattest.New(t)
		r, room := huddleRoom(t, env)
		joinHuddle(t, env, r.member, room.ID)
		joinHuddle(t, env, r.member2, room.ID)
		env.Deliveries.Take()

		if _, err := env.Service.ArchiveRoom(t.Context(), r.admin, room.ID); err != nil {
			t.Fatal(err)
		}
		evs := env.Deliveries.Take()
		if left := eventsOfType(evs, chat.EventHuddleLeft); len(left) != 2 {
			t.Errorf("huddle.left = %d", len(left))
		}
		updated := eventsOfType(evs, chat.EventHuddleUpdated)
		if len(updated) != 1 || updated[0].Data.(chat.HuddleUpdated).Huddle != nil {
			t.Errorf("huddle.updated = %+v", updated)
		}
		msgs := eventsOfType(evs, chat.EventMessageUpdated)
		if len(msgs) != 1 || msgs[0].Data.(chat.Message).Huddle.EndedAt == nil {
			t.Errorf("message.updated = %+v", msgs)
		}
	})
	t.Run("ルームの削除で入っている人ごと外れる", func(t *testing.T) {
		env := chattest.New(t)
		r, room := huddleRoom(t, env)
		joinHuddle(t, env, r.member, room.ID)
		env.Deliveries.Take()

		if err := env.Service.DeleteRoom(t.Context(), r.admin, room.ID); err != nil {
			t.Fatal(err)
		}
		left := eventsOfType(env.Deliveries.Take(), chat.EventHuddleLeft)
		if len(left) != 1 || left[0].Data.(chat.HuddleLeftData).Reason != chat.HuddleRemoved {
			t.Errorf("huddle.left = %+v", left)
		}
		if len(env.Media.Closed()) != 1 {
			t.Errorf("closed = %v", env.Media.Closed())
		}
	})
	t.Run("ログインのセッションの失効", func(t *testing.T) {
		env := chattest.New(t)
		r, room := huddleRoom(t, env)
		sid := env.IDs.New()
		if _, err := env.Service.JoinHuddle(t.Context(), r.member, sid, room.ID, chat.JoinHuddleInput{Offer: chattest.Offer, Mid: "0"}); err != nil {
			t.Fatal(err)
		}
		env.Deliveries.Take()

		// 別のセッションの失効では外れない
		env.Service.RemoveRevokedHuddleSession(t.Context(), r.member, env.IDs.New(), false)
		if left := eventsOfType(env.Deliveries.Take(), chat.EventHuddleLeft); len(left) != 0 {
			t.Errorf("removed by another session's revocation: %+v", left)
		}
		env.Service.RemoveRevokedHuddleSession(t.Context(), r.member, sid, false)
		if left := eventsOfType(env.Deliveries.Take(), chat.EventHuddleLeft); len(left) != 1 {
			t.Errorf("huddle.left = %+v", left)
		}
	})
}

// DM では相手を呼び出し、ハドルのメッセージは相手にだけ未読になる（ADR 0066 決定 11・12）。
func TestDMHuddle(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	env.Deliveries.Take()

	joined := joinHuddle(t, env, r.member, dm.ID)
	evs := env.Deliveries.Take()

	ringing := eventsOfType(evs, chat.EventHuddleRinging)
	if len(ringing) != 1 || !slices.Equal(ringing[0].To.Users, []ulid.ULID{r.member2}) {
		t.Fatalf("huddle.ringing = %+v", ringing)
	}
	if d := ringing[0].Data.(chat.HuddleRinging); d.CallerID != r.member || d.HuddleID != joined.Huddle.ID {
		t.Errorf("ringing = %+v", d)
	}
	for _, tt := range []struct {
		user   ulid.ULID
		unread int64
	}{{r.member, 0}, {r.member2, 1}} {
		got, err := env.Service.GetRoom(t.Context(), tt.user, dm.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.UnreadCount != tt.unread {
			t.Errorf("unread for %s = %d, want %d", tt.user, got.UnreadCount, tt.unread)
		}
	}

	t.Run("もうすぐ参加する", func(t *testing.T) {
		if err := env.Service.HuddleJoiningSoon(t.Context(), r.member2, joined.Huddle.ID); err != nil {
			t.Fatal(err)
		}
		updated := eventsOfType(env.Deliveries.Take(), chat.EventHuddleUpdated)
		if len(updated) != 1 || !slices.Equal(updated[0].Data.(chat.HuddleUpdated).Huddle.JoiningSoon, []ulid.ULID{r.member2}) {
			t.Errorf("huddle.updated = %+v", updated)
		}
		// 入れない人は押せない
		if err := env.Service.HuddleJoiningSoon(t.Context(), r.outsider, joined.Huddle.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("outsider err = %v", err)
		}
	})
}

// ハドルのメッセージには、ハドルのチャット（スレッド）を付けられる（ADR 0066 追記 A）。
func TestHuddleThread(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	joined := joinHuddle(t, env, r.member, room.ID)

	reply, created, err := env.Service.SendMessage(t.Context(), r.member2, room.ID, chat.SendMessageInput{
		ClientMsgID: env.IDs.New(), Body: "資料はここに貼ります", ThreadRootID: &joined.Huddle.MessageID,
	})
	if err != nil || !created {
		t.Fatalf("reply = %v, %v", created, err)
	}
	if reply.ThreadRootID == nil || *reply.ThreadRootID != joined.Huddle.MessageID {
		t.Errorf("reply = %+v", reply)
	}
	root := getMessage(t, env, r.member, room.ID, joined.Huddle.MessageID)
	if root.Thread == nil || root.Thread.ReplyCount != 1 || root.Huddle == nil {
		t.Errorf("root = thread %+v huddle %+v", root.Thread, root.Huddle)
	}
}

func TestSubscribeHuddle(t *testing.T) {
	env := chattest.New(t)
	r, room := huddleRoom(t, env)
	a := joinHuddle(t, env, r.member, room.ID)
	joinHuddle(t, env, r.member2, room.ID)
	other := createRoom(t, env, r.admin, r.ws.ID, "public", "other")
	joinHuddle(t, env, r.admin, other.ID)

	got, err := env.Service.SubscribeHuddle(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, []ulid.ULID{r.member, r.member2, r.admin})
	if err != nil {
		t.Fatal(err)
	}
	// 自分と、別のハドルにいる人の音声は受けない（ADR 0066 決定 2・9）
	if got.Offer == nil || len(got.Tracks) != 1 || got.Tracks[0].UserID != r.member2 {
		t.Errorf("subscribed = %+v", got)
	}
	if err := env.Service.RenegotiateHuddle(t.Context(), r.member, a.Huddle.ID, a.ParticipantID, chattest.Answer); err != nil {
		t.Errorf("RenegotiateHuddle = %v", err)
	}
	if _, err := env.Service.SubscribeHuddle(t.Context(), r.member2, a.Huddle.ID, a.ParticipantID, []ulid.ULID{r.member}); !errors.Is(err, chat.ErrHuddleParticipantGone) {
		t.Errorf("subscribe with someone else's participant = %v", err)
	}
}

// 掃除のジョブの goroutine は、context のキャンセルで止まる（CLAUDE.md「goroutine を起動したら必ず終了条件を用意する」）。
func TestRunHuddleSweeperStops(t *testing.T) {
	env := chattest.New(t)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		env.Service.RunHuddleSweeper(ctx, time.Hour)
		close(done)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RunHuddleSweeper did not stop")
	}
}
