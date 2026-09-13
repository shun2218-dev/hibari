package chat_test

import (
	"crypto/sha256"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

func week() *time.Duration { d := 7 * 24 * time.Hour; return &d }

func createInvite(t *testing.T, env *chattest.Env, actor, workspaceID ulid.ULID, maxUses *int, ttl time.Duration) chat.CreatedInvite {
	t.Helper()
	inv, err := env.Service.CreateInvite(t.Context(), actor, workspaceID, chat.InviteInput{MaxUses: maxUses, ExpiresIn: &ttl})
	if err != nil {
		t.Fatalf("CreateInvite() error = %v", err)
	}
	return inv
}

func setPolicy(t *testing.T, env *chattest.Env, r roles, policy string) {
	t.Helper()
	if _, err := env.Service.UpdateWorkspace(t.Context(), r.owner, r.ws.ID, chat.WorkspaceUpdate{InvitePolicy: &policy}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateInvite(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	inv := createInvite(t, env, r.admin, r.ws.ID, ptr(10), 7*24*time.Hour)
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`).MatchString(inv.Code) {
		t.Errorf("code = %q, want 22 base64url characters", inv.Code)
	}
	if inv.Status != chat.InviteActive || inv.UseCount != 0 || *inv.MaxUses != 10 || inv.CreatedBy.ID != r.admin || inv.CreatedBy.Handle == "" {
		t.Errorf("invite = %+v", inv.Invite)
	}
	if want := chattest.Start.Add(7 * 24 * time.Hour); !inv.ExpiresAt.Equal(want) {
		t.Errorf("expires_at = %v, want %v (from the server clock)", inv.ExpiresAt, want)
	}
	// DB には生のコードではなく SHA-256 だけを保存する。
	var stored []byte
	if err := env.Pool.QueryRow(t.Context(), `SELECT code_hash FROM workspace_invites WHERE id = $1`, inv.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256([]byte(inv.Code)); string(stored) != string(sum[:]) {
		t.Error("code_hash is not the SHA-256 of the code")
	}

	unlimited := createInvite(t, env, r.owner, r.ws.ID, nil, time.Hour)
	if unlimited.MaxUses != nil || unlimited.Code == inv.Code {
		t.Errorf("unlimited invite = %+v", unlimited)
	}

	t.Run("permissions", func(t *testing.T) {
		for _, tt := range []struct {
			name    string
			policy  string
			actor   ulid.ULID
			wantErr error
		}{
			{"owner", "admins_only", r.owner, nil},
			{"admin", "admins_only", r.admin, nil},
			{"member with admins_only", "admins_only", r.member, chat.ErrForbidden},
			{"member with all_members", "all_members", r.member, nil},
			{"outsider", "all_members", r.outsider, chat.ErrNotFound},
		} {
			t.Run(tt.name, func(t *testing.T) {
				setPolicy(t, env, r, tt.policy)
				_, err := env.Service.CreateInvite(t.Context(), tt.actor, r.ws.ID, chat.InviteInput{ExpiresIn: week()})
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("CreateInvite() error = %v, want %v", err, tt.wantErr)
				}
			})
		}
	})

	t.Run("validation", func(t *testing.T) {
		d := func(v time.Duration) *time.Duration { return &v }
		for _, tt := range []struct {
			name          string
			in            chat.InviteInput
			field, reason string
		}{
			{"max_uses 0", chat.InviteInput{MaxUses: ptr(0), ExpiresIn: week()}, "max_uses", chat.ReasonOutOfRange},
			{"max_uses 1001", chat.InviteInput{MaxUses: ptr(1001), ExpiresIn: week()}, "max_uses", chat.ReasonOutOfRange},
			{"no expiry", chat.InviteInput{}, "expires_in_seconds", chat.ReasonRequired},
			{"59 seconds", chat.InviteInput{ExpiresIn: d(59 * time.Second)}, "expires_in_seconds", chat.ReasonOutOfRange},
			{"over 30 days", chat.InviteInput{ExpiresIn: d(30*24*time.Hour + time.Second)}, "expires_in_seconds", chat.ReasonOutOfRange},
		} {
			t.Run(tt.name, func(t *testing.T) {
				_, err := env.Service.CreateInvite(t.Context(), r.owner, r.ws.ID, tt.in)
				expectValidation(t, err, tt.field, tt.reason)
			})
		}
		for _, in := range []chat.InviteInput{
			{MaxUses: ptr(1), ExpiresIn: d(time.Minute)},
			{MaxUses: ptr(1000), ExpiresIn: d(30 * 24 * time.Hour)},
		} {
			if _, err := env.Service.CreateInvite(t.Context(), r.owner, r.ws.ID, in); err != nil {
				t.Errorf("boundary %+v rejected: %v", in, err)
			}
		}
	})
}

func TestListInvites(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	expired := createInvite(t, env, r.owner, r.ws.ID, nil, time.Hour)
	exhausted := createInvite(t, env, r.admin, r.ws.ID, ptr(1), 24*time.Hour)
	revoked := createInvite(t, env, r.owner, r.ws.ID, nil, 24*time.Hour)
	active := createInvite(t, env, r.admin, r.ws.ID, ptr(5), 24*time.Hour)
	if _, err := env.Service.AcceptInvite(t.Context(), env.CreateUser(t), exhausted.Code); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.RevokeInvite(t.Context(), r.owner, r.ws.ID, revoked.ID); err != nil {
		t.Fatal(err)
	}
	env.Clock.Advance(time.Hour)

	// member でも一覧を見られる。新しい順で、状態はサーバーが計算する。
	p, err := env.Service.ListInvites(t.Context(), r.member, r.ws.ID, chat.PageRequest{})
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		id     ulid.ULID
		status chat.InviteStatus
	}{
		{active.ID, chat.InviteActive}, {revoked.ID, chat.InviteRevoked}, {exhausted.ID, chat.InviteExhausted}, {expired.ID, chat.InviteExpired},
	}
	if len(p.Items) != len(want) || p.NextCursor != nil {
		t.Fatalf("invites = %+v", p)
	}
	for i, w := range want {
		if p.Items[i].ID != w.id || p.Items[i].Status != w.status {
			t.Errorf("invites[%d] = %s %s, want %s %s", i, p.Items[i].ID, p.Items[i].Status, w.id, w.status)
		}
	}
	if p.Items[2].UseCount != 1 || p.Items[0].CreatedBy.ID != r.admin {
		t.Errorf("use_count / created_by not returned: %+v", p.Items)
	}

	page1, err := env.Service.ListInvites(t.Context(), r.member, r.ws.ID, chat.PageRequest{Limit: 3})
	if err != nil || len(page1.Items) != 3 || page1.NextCursor == nil {
		t.Fatalf("page 1 = %+v, %v", page1, err)
	}
	page2, err := env.Service.ListInvites(t.Context(), r.member, r.ws.ID, chat.PageRequest{After: *page1.NextCursor, Limit: 3})
	if err != nil || len(page2.Items) != 1 || page2.Items[0].ID != expired.ID || page2.NextCursor != nil {
		t.Fatalf("page 2 = %+v, %v", page2, err)
	}

	if _, err := env.Service.ListInvites(t.Context(), r.outsider, r.ws.ID, chat.PageRequest{}); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("outsider error = %v, want ErrNotFound", err)
	}
}

func TestRevokeInvite(t *testing.T) {
	for _, tt := range []struct {
		name    string
		policy  string
		creator func(roles) ulid.ULID
		actor   func(roles) ulid.ULID
		wantErr error
	}{
		{"owner revokes admin's", "admins_only", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.owner }, nil},
		{"admin revokes owner's", "admins_only", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.admin }, nil},
		{"member revokes own with all_members", "all_members", func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member }, nil},
		{"member cannot revoke admin's with all_members", "all_members", func(r roles) ulid.ULID { return r.admin }, func(r roles) ulid.ULID { return r.member }, chat.ErrForbidden},
		{"member cannot revoke another member's", "all_members", func(r roles) ulid.ULID { return r.member2 }, func(r roles) ulid.ULID { return r.member }, chat.ErrForbidden},
		{"member cannot revoke own after policy changed", "admins_only", func(r roles) ulid.ULID { return r.member }, func(r roles) ulid.ULID { return r.member }, chat.ErrForbidden},
		{"outsider", "all_members", func(r roles) ulid.ULID { return r.owner }, func(r roles) ulid.ULID { return r.outsider }, chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			env := chattest.New(t)
			r := setupRoles(t, env)
			setPolicy(t, env, r, "all_members")
			inv := createInvite(t, env, tt.creator(r), r.ws.ID, nil, time.Hour)
			setPolicy(t, env, r, tt.policy)

			err := env.Service.RevokeInvite(t.Context(), tt.actor(r), r.ws.ID, inv.ID)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("RevokeInvite() error = %v, want %v", err, tt.wantErr)
			}
			_, previewErr := env.Service.PreviewInvite(t.Context(), r.outsider, inv.Code)
			if revoked := errors.Is(previewErr, chat.ErrInviteInvalid); revoked != (tt.wantErr == nil) {
				t.Errorf("invite revoked = %v, want %v", revoked, tt.wantErr == nil)
			}
		})
	}

	t.Run("idempotent and scoped to the workspace", func(t *testing.T) {
		env := chattest.New(t)
		r := setupRoles(t, env)
		inv := createInvite(t, env, r.owner, r.ws.ID, nil, time.Hour)
		if err := env.Service.RevokeInvite(t.Context(), r.owner, r.ws.ID, inv.ID); err != nil {
			t.Fatal(err)
		}
		env.Clock.Advance(time.Minute)
		if err := env.Service.RevokeInvite(t.Context(), r.admin, r.ws.ID, inv.ID); err != nil {
			t.Errorf("second revoke error = %v, want nil", err)
		}
		var revokedAt time.Time
		if err := env.Pool.QueryRow(t.Context(), `SELECT revoked_at FROM workspace_invites WHERE id = $1`, inv.ID).Scan(&revokedAt); err != nil {
			t.Fatal(err)
		}
		if !revokedAt.Equal(chattest.Start) {
			t.Errorf("revoked_at = %v, want the first revocation time", revokedAt)
		}

		// 別のワークスペースの招待の ID を指定しても、見つからない。
		other := env.CreateWorkspace(t, r.owner)
		if err := env.Service.RevokeInvite(t.Context(), r.owner, other.ID, inv.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("revoke via other workspace error = %v, want ErrNotFound", err)
		}
		if err := env.Service.RevokeInvite(t.Context(), r.owner, r.ws.ID, env.IDs.New()); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("revoke unknown invite error = %v, want ErrNotFound", err)
		}
	})
}

func TestPreviewInvite(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{Kind: "public"})
	env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{Kind: "public"})
	env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{Kind: "private"})
	inv := createInvite(t, env, r.admin, r.ws.ID, ptr(2), time.Hour)

	p, err := env.Service.PreviewInvite(t.Context(), r.outsider, inv.Code)
	if err != nil {
		t.Fatalf("PreviewInvite() error = %v", err)
	}
	// private ルームは数えない（まだメンバーではない人に存在を明かさない）。
	if p.WorkspaceID != r.ws.ID || p.WorkspaceName != r.ws.Name || p.MemberCount != 5 || p.PublicRoomCount != 2 ||
		p.Inviter.ID != r.admin || p.Inviter.DisplayName == "" || p.AlreadyMember || !p.ExpiresAt.Equal(inv.ExpiresAt) {
		t.Errorf("preview = %+v", p)
	}
	// プレビューは使用回数を消費しない。
	if p, _ := env.Service.PreviewInvite(t.Context(), r.member, inv.Code); !p.AlreadyMember {
		t.Error("preview for a member should report already_member")
	}

	for _, code := range []string{"", "not-an-invite-code", inv.Code + "x"} {
		if _, err := env.Service.PreviewInvite(t.Context(), r.outsider, code); !errors.Is(err, chat.ErrInviteInvalid) {
			t.Errorf("PreviewInvite(%q) error = %v, want ErrInviteInvalid", code, err)
		}
	}

	t.Run("expired at exactly expires_at", func(t *testing.T) {
		inv := createInvite(t, env, r.owner, r.ws.ID, nil, time.Hour)
		env.Clock.Advance(time.Hour - time.Nanosecond)
		if _, err := env.Service.PreviewInvite(t.Context(), r.outsider, inv.Code); err != nil {
			t.Errorf("1ns before expiry error = %v", err)
		}
		env.Clock.Advance(time.Nanosecond)
		if _, err := env.Service.PreviewInvite(t.Context(), r.outsider, inv.Code); !errors.Is(err, chat.ErrInviteExpired) {
			t.Errorf("at expiry error = %v, want ErrInviteExpired", err)
		}
		// すでにメンバーなら、期限切れでも「参加済み」を見せる。
		if p, err := env.Service.PreviewInvite(t.Context(), r.member, inv.Code); err != nil || !p.AlreadyMember {
			t.Errorf("expired preview for member = %+v, %v; want already_member", p, err)
		}
	})

	t.Run("exhausted and revoked", func(t *testing.T) {
		inv := createInvite(t, env, r.owner, r.ws.ID, ptr(1), time.Hour)
		if _, err := env.Service.AcceptInvite(t.Context(), env.CreateUser(t), inv.Code); err != nil {
			t.Fatal(err)
		}
		if _, err := env.Service.PreviewInvite(t.Context(), r.outsider, inv.Code); !errors.Is(err, chat.ErrInviteExhausted) {
			t.Errorf("exhausted error = %v, want ErrInviteExhausted", err)
		}
		if err := env.Service.RevokeInvite(t.Context(), r.owner, r.ws.ID, inv.ID); err != nil {
			t.Fatal(err)
		}
		// 取り消し済みは、メンバーであっても使えない招待として扱う。
		for _, u := range []ulid.ULID{r.outsider, r.member} {
			if _, err := env.Service.PreviewInvite(t.Context(), u, inv.Code); !errors.Is(err, chat.ErrInviteInvalid) {
				t.Errorf("revoked error = %v, want ErrInviteInvalid", err)
			}
		}
	})
}

func useCount(t *testing.T, env *chattest.Env, inviteID ulid.ULID) int {
	t.Helper()
	var n int
	if err := env.Pool.QueryRow(t.Context(), `SELECT use_count FROM workspace_invites WHERE id = $1`, inviteID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestAcceptInvite(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	defaultRoom := env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{IsDefault: true, LastMessageSeq: 42})
	defaultPrivate := env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{Kind: "private", IsDefault: true, LastMessageSeq: 7})
	otherRoom := env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{LastMessageSeq: 3})
	inv := createInvite(t, env, r.admin, r.ws.ID, ptr(3), time.Hour)

	newcomer := env.CreateUser(t)
	res, err := env.Service.AcceptInvite(t.Context(), newcomer, inv.Code)
	if err != nil {
		t.Fatalf("AcceptInvite() error = %v", err)
	}
	if res.AlreadyMember || res.Workspace.ID != r.ws.ID || res.Workspace.MyRole != authz.RoleMember || res.Workspace.MemberCount != 6 {
		t.Errorf("acceptance = %+v", res)
	}
	if useCount(t, env, inv.ID) != 1 {
		t.Errorf("use_count = %d, want 1", useCount(t, env, inv.ID))
	}
	// is_default のルームにだけ参加し、last_read_seq は参加時点の最新の seq にする。
	readSeqs := map[ulid.ULID]int64{}
	rows, err := env.Pool.Query(t.Context(), `SELECT room_id, last_read_seq FROM room_members WHERE user_id = $1`, newcomer)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id ulid.ULID
		var seq int64
		if err := rows.Scan(&id, &seq); err != nil {
			t.Fatal(err)
		}
		readSeqs[id] = seq
	}
	rows.Close()
	if len(readSeqs) != 2 || readSeqs[defaultRoom] != 42 || readSeqs[defaultPrivate] != 7 {
		t.Errorf("room memberships = %v, want default rooms with their last seq (not %s)", readSeqs, otherRoom)
	}

	// すでにメンバーなら、使用回数を消費せずに成功する。
	res, err = env.Service.AcceptInvite(t.Context(), r.member, inv.Code)
	if err != nil || !res.AlreadyMember || res.Workspace.MyRole != authz.RoleMember {
		t.Errorf("accept as member = %+v, %v; want already_member", res, err)
	}
	if _, err := env.Service.AcceptInvite(t.Context(), newcomer, inv.Code); err != nil {
		t.Errorf("second accept error = %v", err)
	}
	if useCount(t, env, inv.ID) != 1 {
		t.Errorf("use_count = %d after accepting as existing members, want 1", useCount(t, env, inv.ID))
	}

	// キックされた人は、同じ招待でもう一度参加できる（使用回数を消費する）。
	if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, newcomer); err != nil {
		t.Fatal(err)
	}
	if res, err := env.Service.AcceptInvite(t.Context(), newcomer, inv.Code); err != nil || res.AlreadyMember {
		t.Errorf("re-accept after kick = %+v, %v", res, err)
	}
	if useCount(t, env, inv.ID) != 2 {
		t.Errorf("use_count = %d, want 2", useCount(t, env, inv.ID))
	}

	t.Run("unusable invites add nothing", func(t *testing.T) {
		expired := createInvite(t, env, r.owner, r.ws.ID, nil, time.Minute)
		exhausted := createInvite(t, env, r.owner, r.ws.ID, ptr(1), time.Hour)
		revoked := createInvite(t, env, r.owner, r.ws.ID, nil, time.Hour)
		if _, err := env.Service.AcceptInvite(t.Context(), env.CreateUser(t), exhausted.Code); err != nil {
			t.Fatal(err)
		}
		if err := env.Service.RevokeInvite(t.Context(), r.owner, r.ws.ID, revoked.ID); err != nil {
			t.Fatal(err)
		}
		env.Clock.Advance(time.Minute)

		for _, tt := range []struct {
			name    string
			code    string
			wantErr error
		}{
			{"expired", expired.Code, chat.ErrInviteExpired},
			{"exhausted", exhausted.Code, chat.ErrInviteExhausted},
			{"revoked", revoked.Code, chat.ErrInviteInvalid},
			{"unknown", "unknown", chat.ErrInviteInvalid},
			{"empty", "", chat.ErrInviteInvalid},
		} {
			t.Run(tt.name, func(t *testing.T) {
				u := env.CreateUser(t)
				if _, err := env.Service.AcceptInvite(t.Context(), u, tt.code); !errors.Is(err, tt.wantErr) {
					t.Errorf("AcceptInvite() error = %v, want %v", err, tt.wantErr)
				}
				if env.Role(t, r.ws.ID, u) != "" {
					t.Error("user became a member through an unusable invite")
				}
			})
		}
		if useCount(t, env, exhausted.ID) != 1 {
			t.Errorf("exhausted use_count = %d, want 1", useCount(t, env, exhausted.ID))
		}
	})
}

// max_uses = 1 の招待に 50 goroutine が同時に参加しても、成功は 1 件だけ（ロードマップ Phase 3a の DoD）。
func TestAcceptInviteConcurrent(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	inv := createInvite(t, env, owner, ws.ID, ptr(1), time.Hour)
	const n = 50
	users := env.CreateUsers(t, n)

	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		succeeded int
		start     = make(chan struct{})
	)
	for _, u := range users {
		wg.Go(func() {
			<-start
			_, err := env.Service.AcceptInvite(t.Context(), u, inv.Code)
			switch {
			case err == nil:
				mu.Lock()
				succeeded++
				mu.Unlock()
			case errors.Is(err, chat.ErrInviteExhausted):
			default:
				t.Errorf("AcceptInvite() unexpected error = %v", err)
			}
		})
	}
	close(start)
	wg.Wait()

	if succeeded != 1 {
		t.Errorf("succeeded = %d, want 1", succeeded)
	}
	if got := useCount(t, env, inv.ID); got != 1 {
		t.Errorf("use_count = %d, want 1", got)
	}
	var members int
	if err := env.Pool.QueryRow(t.Context(), `SELECT count(*) FROM workspace_members WHERE workspace_id = $1`, ws.ID).Scan(&members); err != nil {
		t.Fatal(err)
	}
	if members != 2 {
		t.Errorf("members = %d, want owner + 1", members)
	}

	// 同じユーザーが同時に何度受け入れても、使用回数の消費は 1 回だけ。
	multi := createInvite(t, env, owner, ws.ID, ptr(10), time.Hour)
	u := env.CreateUser(t)
	start = make(chan struct{})
	for range 20 {
		wg.Go(func() {
			<-start
			if _, err := env.Service.AcceptInvite(t.Context(), u, multi.Code); err != nil {
				t.Errorf("AcceptInvite() error = %v", err)
			}
		})
	}
	close(start)
	wg.Wait()
	if got := useCount(t, env, multi.ID); got != 1 {
		t.Errorf("use_count after 20 concurrent accepts by the same user = %d, want 1", got)
	}
}
