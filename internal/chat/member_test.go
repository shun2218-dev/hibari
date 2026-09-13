package chat_test

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"sync"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// roles は owner 1 人、admin 2 人、member 2 人のワークスペース。
type roles struct {
	ws              chat.Workspace
	owner           ulid.ULID
	admin, admin2   ulid.ULID
	member, member2 ulid.ULID
	outsider        ulid.ULID
}

func setupRoles(t *testing.T, env *chattest.Env) roles {
	t.Helper()
	u := env.CreateUsers(t, 6)
	r := roles{owner: u[0], admin: u[1], admin2: u[2], member: u[3], member2: u[4], outsider: u[5]}
	r.ws = env.CreateWorkspace(t, r.owner)
	env.AddMember(t, r.ws.ID, r.admin, authz.RoleAdmin)
	env.AddMember(t, r.ws.ID, r.admin2, authz.RoleAdmin)
	env.AddMember(t, r.ws.ID, r.member, authz.RoleMember)
	env.AddMember(t, r.ws.ID, r.member2, authz.RoleMember)
	return r
}

func TestListMembers(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	all, err := env.Service.ListMembers(t.Context(), r.member, r.ws.ID, chat.PageRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Items) != 5 || all.NextCursor != nil {
		t.Fatalf("members = %d (next %v), want 5 in one page", len(all.Items), all.NextCursor)
	}
	for i := 1; i < len(all.Items); i++ {
		if all.Items[i-1].User.ID.Compare(all.Items[i].User.ID) >= 0 {
			t.Fatalf("members are not ordered by user id: %v", all.Items)
		}
	}
	for _, m := range all.Items {
		if m.User.ID == r.owner && (m.Role != authz.RoleOwner || m.User.Handle == "" || m.User.DisplayName == "") {
			t.Errorf("owner = %+v", m)
		}
	}

	// limit 2 で辿ると、2 → 2 → 1 件で、最後のページだけ NextCursor が nil。
	var (
		seen  []ulid.ULID
		after ulid.ULID
		sizes []int
	)
	for {
		p, err := env.Service.ListMembers(t.Context(), r.member, r.ws.ID, chat.PageRequest{After: after, Limit: 2})
		if err != nil {
			t.Fatal(err)
		}
		sizes = append(sizes, len(p.Items))
		for _, m := range p.Items {
			seen = append(seen, m.User.ID)
		}
		if p.NextCursor == nil {
			break
		}
		after = *p.NextCursor
	}
	if fmt.Sprint(sizes) != "[2 2 1]" || len(seen) != 5 {
		t.Errorf("page sizes = %v, seen %d, want [2 2 1] and 5", sizes, len(seen))
	}
	for i, m := range all.Items {
		if seen[i] != m.User.ID {
			t.Errorf("paged order differs at %d", i)
		}
	}

	// ちょうど limit 件で終わるときに、空の次ページを作らない。
	p, err := env.Service.ListMembers(t.Context(), r.member, r.ws.ID, chat.PageRequest{Limit: 5})
	if err != nil || len(p.Items) != 5 || p.NextCursor != nil {
		t.Errorf("limit 5 = %d items, next %v, err %v; want 5 and no cursor", len(p.Items), p.NextCursor, err)
	}

	if _, err := env.Service.ListMembers(t.Context(), r.outsider, r.ws.ID, chat.PageRequest{}); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("outsider error = %v, want ErrNotFound", err)
	}
}

func TestChangeMemberRole(t *testing.T) {
	for _, tt := range []struct {
		name    string
		actor   func(roles) ulid.ULID
		target  func(roles) ulid.ULID
		newRole string
		wantErr error
	}{
		{"owner promotes member", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.member }, "admin", nil},
		{"owner demotes admin", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.admin }, "member", nil},
		{"admin promotes member", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.member }, "admin", nil},
		{"same role is a no-op", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.admin }, "admin", nil},
		{"admin cannot demote admin", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.admin2 }, "member", chat.ErrForbidden},
		{"admin cannot touch owner", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.owner }, "member", chat.ErrForbidden},
		{"member cannot promote member", func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member2 }, "admin", chat.ErrForbidden},
		{"owner cannot change self", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.owner }, "admin", chat.ErrForbidden},
		{"admin cannot demote self", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.admin }, "member", chat.ErrForbidden},
		{"owner cannot grant owner", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.admin }, "owner", chat.ErrForbidden},
		{"outsider", func(r roles) ulid.ULID { return r.outsider }, func(r roles) ulid.ULID { return r.member }, "admin", chat.ErrNotFound},
		{"target is not a member", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.outsider }, "admin", chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			env := chattest.New(t)
			r := setupRoles(t, env)
			actor, target := tt.actor(r), tt.target(r)
			before := env.Role(t, r.ws.ID, target)

			m, err := env.Service.ChangeMemberRole(t.Context(), actor, r.ws.ID, target, tt.newRole)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("ChangeMemberRole() error = %v, want %v", err, tt.wantErr)
			}
			after := env.Role(t, r.ws.ID, target)
			if tt.wantErr != nil {
				if after != before {
					t.Errorf("role changed from %q to %q despite error", before, after)
				}
				return
			}
			if after != chat.Role(tt.newRole) || m.Role != chat.Role(tt.newRole) || m.User.ID != target {
				t.Errorf("role in DB = %q, returned %+v, want %q", after, m, tt.newRole)
			}
		})
	}

	t.Run("invalid role", func(t *testing.T) {
		env := chattest.New(t)
		r := setupRoles(t, env)
		_, err := env.Service.ChangeMemberRole(t.Context(), r.owner, r.ws.ID, r.member, "superuser")
		expectValidation(t, err, "role", chat.ReasonInvalidValue)
	})
}

// addRoomMembership は private ルームを作って members を入れる。
func addRoomMembership(t *testing.T, env *chattest.Env, workspaceID, creator ulid.ULID, members ...ulid.ULID) ulid.ULID {
	t.Helper()
	roomID := env.InsertRoom(t, workspaceID, creator, chattest.RoomOptions{Kind: "private"})
	for _, m := range members {
		env.InsertRoomMember(t, roomID, m)
	}
	return roomID
}

func roomMemberships(t *testing.T, env *chattest.Env, userID ulid.ULID) int {
	t.Helper()
	var n int
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM room_members WHERE user_id = $1`, userID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRemoveMember(t *testing.T) {
	for _, tt := range []struct {
		name    string
		actor   func(roles) ulid.ULID
		target  func(roles) ulid.ULID
		wantErr error
	}{
		{"owner kicks admin", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.admin }, nil},
		{"owner kicks member", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.member }, nil},
		{"admin kicks member", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.member }, nil},
		{"admin cannot kick admin", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.admin2 }, chat.ErrForbidden},
		{"admin cannot kick owner", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.owner }, chat.ErrForbidden},
		{"member cannot kick member", func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member2 }, chat.ErrForbidden},
		{"member leaves", func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member }, nil},
		{"admin leaves", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.admin }, nil},
		{"owner cannot leave", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.owner }, chat.ErrOwnerMustTransfer},
		{"outsider", func(r roles) ulid.ULID { return r.outsider }, func(r roles) ulid.ULID { return r.member }, chat.ErrNotFound},
		{"target is not a member", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.outsider }, chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			env := chattest.New(t)
			r := setupRoles(t, env)
			actor, target := tt.actor(r), tt.target(r)
			addRoomMembership(t, env, r.ws.ID, r.owner, r.owner, target)
			// 別のワークスペースのルームの参加は消さない。
			other := env.CreateWorkspace(t, r.outsider)
			if target != r.outsider {
				env.AddMember(t, other.ID, target, authz.RoleMember)
			}
			addRoomMembership(t, env, other.ID, r.outsider, target)
			before := roomMemberships(t, env, target)

			err := env.Service.RemoveMember(t.Context(), actor, r.ws.ID, target)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("RemoveMember() error = %v, want %v", err, tt.wantErr)
			}
			role := env.Role(t, r.ws.ID, target)
			after := roomMemberships(t, env, target)
			if tt.wantErr != nil {
				if target != r.outsider && role == "" {
					t.Error("member was removed despite error")
				}
				if after != before {
					t.Errorf("room memberships %d -> %d despite error", before, after)
				}
				return
			}
			if role != "" {
				t.Errorf("target is still a member with role %q", role)
			}
			if after != before-1 {
				t.Errorf("room memberships %d -> %d, want only this workspace's room removed", before, after)
			}
		})
	}
}

func TestTransferOwnership(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	if err := env.Service.TransferOwnership(t.Context(), r.admin, r.ws.ID, r.member); !errors.Is(err, chat.ErrForbidden) {
		t.Errorf("transfer by admin error = %v, want ErrForbidden", err)
	}
	if err := env.Service.TransferOwnership(t.Context(), r.outsider, r.ws.ID, r.member); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("transfer by outsider error = %v, want ErrNotFound", err)
	}
	if err := env.Service.TransferOwnership(t.Context(), r.owner, r.ws.ID, r.outsider); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("transfer to outsider error = %v, want ErrNotFound", err)
	}
	expectValidation(t, env.Service.TransferOwnership(t.Context(), r.owner, r.ws.ID, r.owner), "user_id", chat.ReasonInvalidValue)
	if env.Role(t, r.ws.ID, r.owner) != authz.RoleOwner {
		t.Fatal("failed transfers changed the owner")
	}

	// member にも譲渡できる。旧 owner は admin になり、退出できるようになる。
	if err := env.Service.TransferOwnership(t.Context(), r.owner, r.ws.ID, r.member); err != nil {
		t.Fatalf("TransferOwnership() error = %v", err)
	}
	if got := env.Role(t, r.ws.ID, r.owner); got != authz.RoleAdmin {
		t.Errorf("old owner's role = %q, want admin", got)
	}
	if got := env.Role(t, r.ws.ID, r.member); got != authz.RoleOwner {
		t.Errorf("new owner's role = %q, want owner", got)
	}
	if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.owner); err != nil {
		t.Errorf("old owner cannot leave after transfer: %v", err)
	}
}

func countOwners(t *testing.T, env *chattest.Env, workspaceID ulid.ULID) int {
	t.Helper()
	var n int
	if err := env.Pool.QueryRow(t.Context(),
		`SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`, workspaceID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// 譲渡を並行で繰り返しても、owner が 0 人や 2 人にならない（ロードマップ Phase 3a の DoD）。
// actor と target をランダムに選ぶので、ほとんどは「もう owner ではない」で失敗するが、失敗は ErrForbidden だけのはず。
func TestTransferOwnershipConcurrent(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 8)
	ws := env.CreateWorkspace(t, users[0])
	for _, u := range users[1:] {
		env.AddMember(t, ws.ID, u, authz.RoleMember)
	}

	const goroutines = 50
	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		succeeded int
		start     = make(chan struct{})
	)
	for range goroutines {
		wg.Go(func() {
			<-start
			for range 5 {
				// 現在の owner を狙う試行と、ランダムな actor の試行を混ぜる。
				actor := users[rand.IntN(len(users))]
				target := users[rand.IntN(len(users))]
				if actor == target {
					continue
				}
				err := env.Service.TransferOwnership(t.Context(), actor, ws.ID, target)
				switch {
				case err == nil:
					mu.Lock()
					succeeded++
					mu.Unlock()
				case errors.Is(err, chat.ErrForbidden):
				default:
					t.Errorf("TransferOwnership() unexpected error = %v", err)
				}
			}
		})
	}
	// owner から確実に 1 回は譲渡が走るようにする。
	wg.Go(func() {
		<-start
		if err := env.Service.TransferOwnership(t.Context(), users[0], ws.ID, users[1]); err != nil && !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("TransferOwnership() unexpected error = %v", err)
		}
	})
	close(start)
	wg.Wait()

	if n := countOwners(t, env, ws.ID); n != 1 {
		t.Fatalf("owners = %d after %d successful transfers, want exactly 1", n, succeeded)
	}
}

// ロール変更・キック・譲渡を並行で混ぜても、デッドロックや想定外のエラーにならず、owner は常に 1 人。
// 行ロックを user_id の順に取らないと、3 つ以上のトランザクションが循環して待ち合い、Postgres がデッドロックとして 1 本を失敗させる。
func TestMemberOperationsConcurrent(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 10)
	ws := env.CreateWorkspace(t, users[0])
	for i, u := range users[1:] {
		role := authz.RoleMember
		if i%2 == 0 {
			role = authz.RoleAdmin
		}
		env.AddMember(t, ws.ID, u, role)
	}

	var (
		wg    sync.WaitGroup
		start = make(chan struct{})
	)
	for range 40 {
		wg.Go(func() {
			<-start
			for range 10 {
				actor := users[rand.IntN(len(users))]
				target := users[rand.IntN(len(users))]
				var err error
				switch rand.IntN(4) {
				case 0:
					_, err = env.Service.ChangeMemberRole(t.Context(), actor, ws.ID, target, "admin")
				case 1:
					_, err = env.Service.ChangeMemberRole(t.Context(), actor, ws.ID, target, "member")
				case 2:
					err = env.Service.TransferOwnership(t.Context(), actor, ws.ID, target)
				case 3:
					// キックした人を戻さないとすぐに全員いなくなるので、キックは対象を戻す。
					if err = env.Service.RemoveMember(t.Context(), actor, ws.ID, target); err == nil && actor != target {
						_, err = env.Pool.Exec(t.Context(),
							`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
							ws.ID, target, env.Clock.Now())
					}
				}
				var verr *chat.ValidationError
				if err != nil && !errors.Is(err, chat.ErrForbidden) && !errors.Is(err, chat.ErrNotFound) &&
					!errors.Is(err, chat.ErrOwnerMustTransfer) && !errors.As(err, &verr) {
					t.Errorf("unexpected error = %v", err)
				}
			}
		})
	}
	close(start)
	wg.Wait()

	if n := countOwners(t, env, ws.ID); n != 1 {
		t.Fatalf("owners = %d, want exactly 1", n)
	}
}
