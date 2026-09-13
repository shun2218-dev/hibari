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

func createRoom(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID, kind, name string) chat.Room {
	t.Helper()
	room, created, err := env.Service.CreateRoom(t.Context(), actor, workspaceID, chat.CreateRoomInput{Kind: kind, Name: name})
	if err != nil || !created {
		t.Fatalf("CreateRoom(%s %s) = created %v, error %v", kind, name, created, err)
	}
	return room
}

func createDM(t *testing.T, env *chattest.Env, actor, workspaceID, peer ulid.ULID) (chat.Room, bool) {
	t.Helper()
	room, created, err := env.Service.CreateRoom(t.Context(), actor, workspaceID, chat.CreateRoomInput{Kind: "dm", UserID: peer})
	if err != nil {
		t.Fatalf("CreateRoom(dm) error = %v", err)
	}
	return room, created
}

// lastReadSeq は room_members の last_read_seq を返す。メンバーでなければ -1。
func lastReadSeq(t *testing.T, env *chattest.Env, roomID, userID ulid.ULID) int64 {
	t.Helper()
	var seq int64
	err := env.Pool.QueryRow(t.Context(),
		`SELECT coalesce((SELECT last_read_seq FROM room_members WHERE room_id = $1 AND user_id = $2), -1)`, roomID, userID).Scan(&seq)
	if err != nil {
		t.Fatal(err)
	}
	return seq
}

func setLastMessageSeq(t *testing.T, env *chattest.Env, roomID ulid.ULID, seq int64) {
	t.Helper()
	if _, err := env.Pool.Exec(t.Context(), `UPDATE rooms SET last_message_seq = $2 WHERE id = $1`, roomID, seq); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRoom(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	for _, kind := range []string{"public", "private"} {
		t.Run(kind, func(t *testing.T) {
			room := createRoom(t, env, r.member, r.ws.ID, kind, "  デザインレビュー "+kind+" ")
			if room.Kind != chat.RoomKind(kind) || room.Name != "デザインレビュー "+kind || !room.IsMember || room.MemberCount != 1 ||
				room.IsDefault || room.DMPeer != nil || room.LastMessageSeq != 0 || room.WorkspaceID != r.ws.ID {
				t.Errorf("room = %+v", room)
			}
			if lastReadSeq(t, env, room.ID, r.member) != 0 {
				t.Error("creator is not a member with last_read_seq 0")
			}
		})
	}

	// 名前はワークスペース内で一意（public と private をまたいで）。別のワークスペースなら同じ名前でよい。
	createRoom(t, env, r.owner, r.ws.ID, "public", "雑談")
	for _, kind := range []string{"public", "private"} {
		if _, _, err := env.Service.CreateRoom(t.Context(), r.admin, r.ws.ID, chat.CreateRoomInput{Kind: kind, Name: "雑談"}); !errors.Is(err, chat.ErrRoomNameTaken) {
			t.Errorf("duplicate %s name error = %v, want ErrRoomNameTaken", kind, err)
		}
	}
	other := env.CreateWorkspace(t, r.owner)
	createRoom(t, env, r.owner, other.ID, "public", "雑談")

	if _, _, err := env.Service.CreateRoom(t.Context(), r.outsider, r.ws.ID, chat.CreateRoomInput{Kind: "public", Name: "x"}); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("outsider error = %v, want ErrNotFound", err)
	}

	for _, tt := range []struct {
		name          string
		in            chat.CreateRoomInput
		field, reason string
	}{
		{"unknown kind", chat.CreateRoomInput{Kind: "group", Name: "x"}, "kind", chat.ReasonInvalidValue},
		{"empty name", chat.CreateRoomInput{Kind: "public", Name: " "}, "name", chat.ReasonRequired},
		{"long name", chat.CreateRoomInput{Kind: "private", Name: strings.Repeat("あ", 81)}, "name", chat.ReasonTooLong},
		{"dm without user", chat.CreateRoomInput{Kind: "dm"}, "user_id", chat.ReasonRequired},
		{"dm with self", chat.CreateRoomInput{Kind: "dm", UserID: r.member}, "user_id", chat.ReasonInvalidValue},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := env.Service.CreateRoom(t.Context(), r.member, r.ws.ID, tt.in)
			expectValidation(t, err, tt.field, tt.reason)
		})
	}
}

func TestCreateDM(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	dm, created := createDM(t, env, r.member, r.ws.ID, r.admin)
	if !created || dm.Kind != authz.RoomDM || dm.Name != "" || dm.MemberCount != 2 || dm.DMPeer == nil || dm.DMPeer.ID != r.admin {
		t.Fatalf("dm = %+v, created %v", dm, created)
	}
	// 相手から作っても同じ DM が返る。
	again, created := createDM(t, env, r.admin, r.ws.ID, r.member)
	if created || again.ID != dm.ID || again.DMPeer.ID != r.member {
		t.Errorf("reverse dm = %+v, created %v; want the existing room with the peer swapped", again, created)
	}

	if _, _, err := env.Service.CreateRoom(t.Context(), r.member, r.ws.ID, chat.CreateRoomInput{Kind: "dm", UserID: r.outsider}); !errors.Is(err, chat.ErrUserNotInWorkspace) {
		t.Errorf("dm with outsider error = %v, want ErrUserNotInWorkspace", err)
	}
	if _, _, err := env.Service.CreateRoom(t.Context(), r.outsider, r.ws.ID, chat.CreateRoomInput{Kind: "dm", UserID: r.member}); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("dm by outsider error = %v, want ErrNotFound", err)
	}

	// ワークスペースを抜けて戻ってきた人も、元の DM に戻れる。
	if err := env.Service.RemoveMember(t.Context(), r.admin, r.ws.ID, r.admin); err != nil {
		t.Fatal(err)
	}
	if lastReadSeq(t, env, dm.ID, r.admin) != -1 {
		t.Fatal("leaving the workspace did not remove the dm membership")
	}
	env.AddMember(t, r.ws.ID, r.admin, authz.RoleMember)
	setLastMessageSeq(t, env, dm.ID, 9)
	back, created := createDM(t, env, r.member, r.ws.ID, r.admin)
	if created || back.ID != dm.ID || lastReadSeq(t, env, dm.ID, r.admin) != 9 {
		t.Errorf("dm after rejoin = %+v, created %v, admin's last_read_seq %d", back, created, lastReadSeq(t, env, dm.ID, r.admin))
	}
}

// 同じ 2 人の DM を並行で作成しても 1 つにしかならない（ロードマップ Phase 3a の DoD）。
func TestCreateDMConcurrent(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 2)
	ws := env.CreateWorkspace(t, users[0])
	env.AddMember(t, ws.ID, users[1], authz.RoleMember)

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		ids     = map[ulid.ULID]bool{}
		created int
		start   = make(chan struct{})
	)
	for i := range 30 {
		wg.Go(func() {
			<-start
			actor, peer := users[i%2], users[(i+1)%2]
			room, c, err := env.Service.CreateRoom(t.Context(), actor, ws.ID, chat.CreateRoomInput{Kind: "dm", UserID: peer})
			if err != nil {
				t.Errorf("CreateRoom(dm) error = %v", err)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			ids[room.ID] = true
			if c {
				created++
			}
		})
	}
	close(start)
	wg.Wait()

	var rooms int
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM rooms WHERE workspace_id = $1 AND kind = 'dm'`, ws.ID).Scan(&rooms); err != nil {
		t.Fatal(err)
	}
	if rooms != 1 || len(ids) != 1 || created != 1 {
		t.Errorf("dm rooms = %d, distinct ids returned = %d, created = %d; want 1, 1, 1", rooms, len(ids), created)
	}
}

func TestListRooms(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	joinedPublic := createRoom(t, env, r.member, r.ws.ID, "public", "joined-public")
	otherPublic := createRoom(t, env, r.owner, r.ws.ID, "public", "other-public")
	joinedPrivate := createRoom(t, env, r.admin, r.ws.ID, "private", "joined-private")
	createRoom(t, env, r.owner, r.ws.ID, "private", "hidden-private")
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	createDM(t, env, r.owner, r.ws.ID, r.admin) // member から見えない DM
	if err := env.Service.AddRoomMember(t.Context(), r.admin, joinedPrivate.ID, r.member); err != nil {
		t.Fatal(err)
	}
	// 最近メッセージがあった順。メッセージのないルームは後ろ。
	now := env.Clock.Now()
	for id, at := range map[ulid.ULID]time.Time{otherPublic.ID: now.Add(-time.Hour), dm.ID: now} {
		if _, err := env.Pool.Exec(t.Context(), `UPDATE rooms SET last_message_at = $2 WHERE id = $1`, id, at); err != nil {
			t.Fatal(err)
		}
	}

	rooms, err := env.Service.ListRooms(t.Context(), r.member, r.ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	type view struct {
		id       ulid.ULID
		isMember bool
	}
	var got []view
	for _, room := range rooms {
		got = append(got, view{room.ID, room.IsMember})
	}
	// 先頭 2 件は last_message_at の順。残り（NULL）は id の順（作成順）。
	want := []view{{dm.ID, true}, {otherPublic.ID, false}, {joinedPublic.ID, true}, {joinedPrivate.ID, true}}
	if len(got) != len(want) {
		t.Fatalf("rooms = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("rooms[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
	if rooms[0].DMPeer == nil || rooms[0].DMPeer.ID != r.member2 || rooms[0].DMPeer.DisplayName == "" {
		t.Errorf("dm peer = %+v", rooms[0].DMPeer)
	}
	for _, room := range rooms[1:] {
		if room.DMPeer != nil {
			t.Errorf("non-dm room %s has a peer", room.ID)
		}
	}

	if _, err := env.Service.ListRooms(t.Context(), r.outsider, r.ws.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("outsider error = %v, want ErrNotFound", err)
	}
}

func TestGetRoomAndMembers(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.admin, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	if _, err := env.Service.JoinRoom(t.Context(), r.owner, public.ID); err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		name       string
		actor      ulid.ULID
		room       ulid.ULID
		wantErr    error
		wantMember bool
	}{
		{"public as non-member", r.member, public.ID, nil, false},
		{"public as member", r.admin, public.ID, nil, true},
		{"private as member", r.member, private.ID, nil, true},
		{"private as non-member owner", r.owner, private.ID, chat.ErrNotFound, false},
		{"dm as participant", r.member2, dm.ID, nil, true},
		{"dm as owner", r.owner, dm.ID, chat.ErrNotFound, false},
		{"public as outsider", r.outsider, public.ID, chat.ErrNotFound, false},
		{"unknown room", r.owner, env.IDs.New(), chat.ErrNotFound, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			room, err := env.Service.GetRoom(t.Context(), tt.actor, tt.room)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("GetRoom() error = %v, want %v", err, tt.wantErr)
			}
			_, listErr := env.Service.ListRoomMembers(t.Context(), tt.actor, tt.room, chat.PageRequest{})
			if !errors.Is(listErr, tt.wantErr) {
				t.Errorf("ListRoomMembers() error = %v, want %v", listErr, tt.wantErr)
			}
			if err == nil && room.IsMember != tt.wantMember {
				t.Errorf("is_member = %v, want %v", room.IsMember, tt.wantMember)
			}
		})
	}

	room, err := env.Service.GetRoom(t.Context(), r.member, public.ID)
	if err != nil || room.MemberCount != 2 {
		t.Errorf("public room = %+v, %v; want 2 members", room, err)
	}
	room, err = env.Service.GetRoom(t.Context(), r.member2, dm.ID)
	if err != nil || room.DMPeer == nil || room.DMPeer.ID != r.member {
		t.Errorf("dm = %+v, %v; want peer %s", room, err, r.member)
	}

	p, err := env.Service.ListRoomMembers(t.Context(), r.member, public.ID, chat.PageRequest{Limit: 1})
	if err != nil || len(p.Items) != 1 || p.NextCursor == nil {
		t.Fatalf("page 1 = %+v, %v", p, err)
	}
	p2, err := env.Service.ListRoomMembers(t.Context(), r.member, public.ID, chat.PageRequest{After: *p.NextCursor, Limit: 1})
	if err != nil || len(p2.Items) != 1 || p2.NextCursor != nil {
		t.Fatalf("page 2 = %+v, %v", p2, err)
	}
	roles := map[ulid.ULID]chat.Role{p.Items[0].User.ID: p.Items[0].Role, p2.Items[0].User.ID: p2.Items[0].Role}
	if roles[r.owner] != authz.RoleOwner || roles[r.admin] != authz.RoleAdmin {
		t.Errorf("room member roles = %v, want the workspace roles", roles)
	}
}

func TestUpdateRoom(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.admin, r.ws.ID, "private", "private")
	createRoom(t, env, r.member, r.ws.ID, "public", "taken")
	dm, _ := createDM(t, env, r.owner, r.ws.ID, r.admin)

	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		room    ulid.ULID
		wantErr error
	}{
		{"owner on public", r.owner, public.ID, nil},
		{"admin on public", r.admin, public.ID, nil},
		{"member (creator) on public", r.member, public.ID, chat.ErrForbidden},
		{"admin on own private", r.admin, private.ID, nil},
		{"owner not in private", r.owner, private.ID, chat.ErrNotFound},
		{"owner on dm", r.owner, dm.ID, chat.ErrForbidden},
		{"outsider", r.outsider, public.ID, chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			name := "renamed by " + tt.name
			room, err := env.Service.UpdateRoom(t.Context(), tt.actor, tt.room, chat.RoomUpdate{Name: &name, IsDefault: ptr(true)})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("UpdateRoom() error = %v, want %v", err, tt.wantErr)
			}
			if err == nil && (room.Name != name || !room.IsDefault) {
				t.Errorf("room = %+v", room)
			}
		})
	}

	if _, err := env.Service.UpdateRoom(t.Context(), r.owner, public.ID, chat.RoomUpdate{Name: ptr("taken")}); !errors.Is(err, chat.ErrRoomNameTaken) {
		t.Errorf("rename to taken name error = %v, want ErrRoomNameTaken", err)
	}
	room, err := env.Service.UpdateRoom(t.Context(), r.owner, public.ID, chat.RoomUpdate{IsDefault: ptr(false)})
	if err != nil || room.IsDefault || room.Name != "renamed by admin on public" {
		t.Errorf("partial update = %+v, %v", room, err)
	}
	_, err = env.Service.UpdateRoom(t.Context(), r.owner, public.ID, chat.RoomUpdate{Name: ptr("a\tb")})
	expectValidation(t, err, "name", chat.ReasonInvalidFormat)
}

func TestJoinAndAddRoomMember(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.owner, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	dm, _ := createDM(t, env, r.owner, r.ws.ID, r.admin)
	setLastMessageSeq(t, env, public.ID, 12)
	setLastMessageSeq(t, env, private.ID, 34)

	// public には自分で参加する。last_read_seq は参加時点の最新の seq。冪等。
	for range 2 {
		room, err := env.Service.JoinRoom(t.Context(), r.member2, public.ID)
		if err != nil || !room.IsMember || room.MemberCount != 2 {
			t.Fatalf("JoinRoom() = %+v, %v", room, err)
		}
	}
	if lastReadSeq(t, env, public.ID, r.member2) != 12 {
		t.Errorf("last_read_seq = %d, want 12", lastReadSeq(t, env, public.ID, r.member2))
	}
	for _, tt := range []struct {
		name    string
		room    ulid.ULID
		actor   ulid.ULID
		wantErr error
	}{
		{"private", private.ID, r.owner, chat.ErrNotFound},
		{"private as member", private.ID, r.member, chat.ErrForbidden},
		{"dm", dm.ID, r.member, chat.ErrNotFound},
		{"outsider", public.ID, r.outsider, chat.ErrNotFound},
	} {
		if _, err := env.Service.JoinRoom(t.Context(), tt.actor, tt.room); !errors.Is(err, tt.wantErr) {
			t.Errorf("JoinRoom(%s) error = %v, want %v", tt.name, err, tt.wantErr)
		}
	}

	// private にはメンバーが他人を追加する（ロールは問わない）。冪等。
	for range 2 {
		if err := env.Service.AddRoomMember(t.Context(), r.member, private.ID, r.owner); err != nil {
			t.Fatalf("AddRoomMember() error = %v", err)
		}
	}
	if lastReadSeq(t, env, private.ID, r.owner) != 34 {
		t.Errorf("added member's last_read_seq = %d, want 34", lastReadSeq(t, env, private.ID, r.owner))
	}
	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		room    ulid.ULID
		target  ulid.ULID
		wantErr error
	}{
		{"non-member admin to private", r.admin, private.ID, r.member2, chat.ErrNotFound},
		{"to public", r.owner, public.ID, r.admin, chat.ErrForbidden},
		{"to dm", r.owner, dm.ID, r.member, chat.ErrForbidden},
		{"outsider as target", r.member, private.ID, r.outsider, chat.ErrUserNotInWorkspace},
	} {
		if err := env.Service.AddRoomMember(t.Context(), tt.actor, tt.room, tt.target); !errors.Is(err, tt.wantErr) {
			t.Errorf("AddRoomMember(%s) error = %v, want %v", tt.name, err, tt.wantErr)
		}
	}
}

func TestRemoveRoomMember(t *testing.T) {
	for _, tt := range []struct {
		name    string
		kind    string
		setup   func(roles) (creator ulid.ULID, members []ulid.ULID)
		actor   func(roles) ulid.ULID
		target  func(roles) ulid.ULID
		wantErr error
	}{
		{"member leaves public", "public",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.owner, []ulid.ULID{r.member} },
			func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member }, nil},
		{"member leaves private", "private",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.member, nil },
			func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member }, nil},
		{"admin outside public removes member", "public",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.member, nil },
			func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.member }, nil},
		{"owner in private removes admin", "private",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.owner, []ulid.ULID{r.admin} },
			func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.admin }, nil},
		{"admin outside private cannot see it", "private",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.member, nil },
			func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.member }, chat.ErrNotFound},
		{"admin cannot remove admin", "public",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.admin2, nil },
			func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.admin2 }, chat.ErrForbidden},
		{"member cannot remove member", "private",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.member, []ulid.ULID{r.member2} },
			func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member2 }, chat.ErrForbidden},
		{"target not in room", "public",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.owner, nil },
			func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.member }, chat.ErrNotFound},
		{"non-member leaves public", "public",
			func(r roles) (ulid.ULID, []ulid.ULID) { return r.owner, nil },
			func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member }, chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			env := chattest.New(t)
			r := setupRoles(t, env)
			creator, members := tt.setup(r)
			room := createRoom(t, env, creator, r.ws.ID, tt.kind, "room")
			for _, m := range members {
				env.InsertRoomMember(t, room.ID, m)
			}
			target := tt.target(r)
			before := lastReadSeq(t, env, room.ID, target)

			err := env.Service.RemoveRoomMember(t.Context(), tt.actor(r), room.ID, target)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("RemoveRoomMember() error = %v, want %v", err, tt.wantErr)
			}
			after := lastReadSeq(t, env, room.ID, target)
			if tt.wantErr == nil && after != -1 {
				t.Error("target is still a room member")
			}
			if tt.wantErr != nil && after != before {
				t.Error("membership changed despite error")
			}
		})
	}

	t.Run("dm members are fixed", func(t *testing.T) {
		env := chattest.New(t)
		r := setupRoles(t, env)
		dm, _ := createDM(t, env, r.owner, r.ws.ID, r.member)
		for _, pair := range [][2]ulid.ULID{{r.member, r.member}, {r.owner, r.member}} {
			if err := env.Service.RemoveRoomMember(t.Context(), pair[0], dm.ID, pair[1]); !errors.Is(err, chat.ErrForbidden) {
				t.Errorf("remove from dm error = %v, want ErrForbidden", err)
			}
		}
	})
}

// キックと、同じ人のルームへの参加が同時に起きても、「ワークスペースのメンバーではないのにルームのメンバー」という行が残らない。
// 残ると、その人がワークスペースに戻ったときに、招かれていない private ルームに入れてしまう。
func TestKickAndJoinRoomConcurrent(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	rooms := make([]chat.Room, 5)
	for i := range rooms {
		rooms[i] = createRoom(t, env, owner, ws.ID, "public", "room-"+string(rune('a'+i)))
	}

	for range 30 {
		u := env.CreateUser(t)
		env.AddMember(t, ws.ID, u, authz.RoleMember)
		var (
			wg    sync.WaitGroup
			start = make(chan struct{})
		)
		for _, room := range rooms {
			wg.Go(func() {
				<-start
				if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil && !errors.Is(err, chat.ErrNotFound) {
					t.Errorf("JoinRoom() error = %v", err)
				}
			})
		}
		wg.Go(func() {
			<-start
			if err := env.Service.RemoveMember(t.Context(), owner, ws.ID, u); err != nil {
				t.Errorf("RemoveMember() error = %v", err)
			}
		})
		close(start)
		wg.Wait()

		if n := roomMemberships(t, env, u); n != 0 {
			t.Fatalf("kicked user still has %d room memberships", n)
		}
	}
}
