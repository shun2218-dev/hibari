package chat_test

import (
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

func ptr[T any](v T) *T { return &v }

// expectValidation は err が field の reason の検証エラーであることを確かめる。
func expectValidation(t *testing.T, err error, field, reason string) {
	t.Helper()
	var verr *chat.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("err = %v, want ValidationError", err)
	}
	for _, f := range verr.Fields {
		if f.Field == field && f.Reason == reason {
			return
		}
	}
	t.Fatalf("fields = %+v, want %s: %s", verr.Fields, field, reason)
}

func TestCreateWorkspace(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)

	ws, err := env.Service.CreateWorkspace(t.Context(), owner, "  山と印刷  ")
	if err != nil {
		t.Fatalf("CreateWorkspace() error = %v", err)
	}
	if ws.Name != "山と印刷" || ws.MyRole != authz.RoleOwner || ws.InvitePolicy != authz.InvitePolicyAdminsOnly || ws.MemberCount != 1 {
		t.Errorf("workspace = %+v, want trimmed name, owner role, admins_only, 1 member", ws)
	}
	if !regexp.MustCompile(`^[a-z2-7]{13}$`).MatchString(ws.Slug) {
		t.Errorf("slug = %q, want 13 lowercase base32 characters", ws.Slug)
	}
	if !ws.CreatedAt.Equal(chattest.Start) || !ws.UpdatedAt.Equal(chattest.Start) {
		t.Errorf("timestamps = %v / %v, want the clock's time", ws.CreatedAt, ws.UpdatedAt)
	}
	if got := env.Role(t, ws.ID, owner); got != authz.RoleOwner {
		t.Errorf("owner's role in DB = %q", got)
	}
	// デフォルトのルームは作らない（ADR 0011）。
	var rooms int
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM rooms WHERE workspace_id = $1`, ws.ID).Scan(&rooms); err != nil {
		t.Fatal(err)
	}
	if rooms != 0 {
		t.Errorf("rooms = %d, want 0", rooms)
	}

	// 同じ名前のワークスペースを作っても、slug は別になる。
	ws2, err := env.Service.CreateWorkspace(t.Context(), owner, "山と印刷")
	if err != nil {
		t.Fatal(err)
	}
	if ws2.Slug == ws.Slug {
		t.Errorf("two workspaces got the same slug %q", ws.Slug)
	}
}

func TestCreateWorkspaceValidation(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)
	for _, tt := range []struct {
		name, input, reason string
	}{
		{"empty", "", chat.ReasonRequired},
		{"only spaces", "  　 ", chat.ReasonRequired},
		{"too long", strings.Repeat("山", 51), chat.ReasonTooLong},
		{"newline", "山と\n印刷", chat.ReasonInvalidFormat},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.CreateWorkspace(t.Context(), owner, tt.input)
			expectValidation(t, err, "name", tt.reason)
		})
	}
	if _, err := env.Service.CreateWorkspace(t.Context(), owner, strings.Repeat("山", 50)); err != nil {
		t.Errorf("50 runes should be accepted: %v", err)
	}
}

func TestListAndGetWorkspaces(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 3)
	alice, bob, carol := users[0], users[1], users[2]
	a1 := env.CreateWorkspace(t, alice)
	a2 := env.CreateWorkspace(t, alice)
	b1 := env.CreateWorkspace(t, bob)
	env.AddMember(t, b1.ID, alice, authz.RoleMember)
	env.AddMember(t, a1.ID, bob, authz.RoleAdmin)

	list, err := env.Service.ListWorkspaces(t.Context(), alice)
	if err != nil {
		t.Fatal(err)
	}
	got := map[ulid.ULID]chat.Role{}
	for _, w := range list {
		got[w.ID] = w.MyRole
	}
	want := map[ulid.ULID]chat.Role{a1.ID: authz.RoleOwner, a2.ID: authz.RoleOwner, b1.ID: authz.RoleMember}
	if len(got) != len(want) {
		t.Fatalf("alice's workspaces = %v, want %v", got, want)
	}
	for id, role := range want {
		if got[id] != role {
			t.Errorf("alice's role in %s = %q, want %q", id, got[id], role)
		}
	}

	if list, err := env.Service.ListWorkspaces(t.Context(), carol); err != nil || len(list) != 0 {
		t.Errorf("carol's workspaces = %v, %v; want none", list, err)
	}

	ws, err := env.Service.GetWorkspace(t.Context(), bob, a1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ws.MyRole != authz.RoleAdmin || ws.MemberCount != 2 || ws.Name != a1.Name {
		t.Errorf("GetWorkspace as bob = %+v, want admin with 2 members", ws)
	}

	// メンバーでなければ、存在するワークスペースでも存在しないものと同じ扱いにする。
	if _, err := env.Service.GetWorkspace(t.Context(), carol, a1.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("GetWorkspace as non-member error = %v, want ErrNotFound", err)
	}
	if _, err := env.Service.GetWorkspace(t.Context(), alice, env.IDs.New()); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("GetWorkspace of unknown id error = %v, want ErrNotFound", err)
	}
}

func TestUpdateWorkspace(t *testing.T) {
	env := chattest.New(t)
	users := env.CreateUsers(t, 4)
	owner, admin, member, outsider := users[0], users[1], users[2], users[3]
	ws := env.CreateWorkspace(t, owner)
	env.AddMember(t, ws.ID, admin, authz.RoleAdmin)
	env.AddMember(t, ws.ID, member, authz.RoleMember)

	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		wantErr error
	}{
		{"owner", owner, nil},
		{"admin", admin, nil},
		{"member", member, chat.ErrForbidden},
		{"outsider", outsider, chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			env.Clock.Advance(time.Minute)
			name := "改名 " + tt.name
			got, err := env.Service.UpdateWorkspace(t.Context(), tt.actor, ws.ID, chat.WorkspaceUpdate{
				Name: ptr(" " + name + " "), InvitePolicy: ptr("all_members"),
			})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("UpdateWorkspace() error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil {
				return
			}
			if got.Name != name || got.InvitePolicy != authz.InvitePolicyAllMembers || !got.UpdatedAt.Equal(env.Clock.Now()) || got.MemberCount != 3 {
				t.Errorf("updated workspace = %+v", got)
			}
		})
	}

	t.Run("partial update keeps other fields", func(t *testing.T) {
		before, _ := env.Service.GetWorkspace(t.Context(), owner, ws.ID)
		got, err := env.Service.UpdateWorkspace(t.Context(), owner, ws.ID, chat.WorkspaceUpdate{InvitePolicy: ptr("admins_only")})
		if err != nil {
			t.Fatal(err)
		}
		if got.Name != before.Name || got.InvitePolicy != authz.InvitePolicyAdminsOnly {
			t.Errorf("got %+v, want name kept and policy changed", got)
		}
	})

	t.Run("empty update does not touch updated_at", func(t *testing.T) {
		before, _ := env.Service.GetWorkspace(t.Context(), owner, ws.ID)
		env.Clock.Advance(time.Hour)
		got, err := env.Service.UpdateWorkspace(t.Context(), owner, ws.ID, chat.WorkspaceUpdate{})
		if err != nil {
			t.Fatal(err)
		}
		if !got.UpdatedAt.Equal(before.UpdatedAt) {
			t.Errorf("updated_at = %v, want unchanged %v", got.UpdatedAt, before.UpdatedAt)
		}
		// 空の変更でも権限は確かめる。
		if _, err := env.Service.UpdateWorkspace(t.Context(), member, ws.ID, chat.WorkspaceUpdate{}); !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("empty update by member error = %v, want ErrForbidden", err)
		}
	})

	t.Run("validation", func(t *testing.T) {
		_, err := env.Service.UpdateWorkspace(t.Context(), owner, ws.ID, chat.WorkspaceUpdate{Name: ptr(""), InvitePolicy: ptr("everyone")})
		expectValidation(t, err, "name", chat.ReasonRequired)
		expectValidation(t, err, "invite_policy", chat.ReasonInvalidValue)
	})
}
