package httpx_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
)

// apiUser は API で登録したユーザー。
type apiUser struct {
	id      string
	token   string
	refresh string
}

func (c *apiClient) registerUser() apiUser {
	c.t.Helper()
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: registerBody(c)})
	if r.status != http.StatusCreated {
		c.t.Fatalf("register status = %d: %s", r.status, r.body)
	}
	b := decode[tokenBody](c.t, r)
	return apiUser{id: b.User.ID, token: b.AccessToken, refresh: *b.RefreshToken}
}

// as は u の Access Token を付けたリクエストを送る。
func (c *apiClient) as(u apiUser, method, path string, body any) response {
	c.t.Helper()
	return c.do(request{method: method, path: path, body: body, headers: bearer(u.token)})
}

// addMember はワークスペースにメンバーを直接入れる（招待の API は Phase 3a の後半で入る）。
func (c *apiClient) addMember(workspaceID string, u apiUser, role string) {
	c.t.Helper()
	_, err := c.env.Pool.Exec(c.t.Context(),
		`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)`,
		ulid.MustParse(workspaceID), ulid.MustParse(u.id), role, c.env.Clock.Now())
	if err != nil {
		c.t.Fatal(err)
	}
}

type workspaceBody struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	InvitePolicy string `json:"invite_policy"`
	MyRole       string `json:"my_role"`
	MemberCount  *int   `json:"member_count"`
}

type memberBody struct {
	User struct {
		ID          string `json:"id"`
		Handle      string `json:"handle"`
		DisplayName string `json:"display_name"`
	} `json:"user"`
	Role string `json:"role"`
}

type membersBody struct {
	Members    []memberBody `json:"members"`
	NextCursor *string      `json:"next_cursor"`
}

func expectStatus(t *testing.T, r response, status int) {
	t.Helper()
	if r.status != status {
		t.Fatalf("status = %d, want %d: %s", r.status, status, r.body)
	}
}

func TestWorkspaceFlow(t *testing.T) {
	c := newAPI(t)
	owner, admin, member, outsider := c.registerUser(), c.registerUser(), c.registerUser(), c.registerUser()

	// 作成
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	if ws.Name != "山と印刷" || ws.MyRole != "owner" || ws.InvitePolicy != "admins_only" || ws.MemberCount == nil || *ws.MemberCount != 1 || ws.Slug == "" {
		t.Fatalf("created workspace = %+v", ws)
	}
	if _, err := ulid.ParseStrict(ws.ID); err != nil {
		t.Errorf("id %q is not a ULID", ws.ID)
	}
	base := "/api/v1/workspaces/" + ws.ID
	c.addMember(ws.ID, admin, "admin")
	c.addMember(ws.ID, member, "member")

	// 一覧と取得
	r = c.as(member, http.MethodGet, "/api/v1/workspaces", nil)
	expectStatus(t, r, http.StatusOK)
	list := decode[struct {
		Workspaces []workspaceBody `json:"workspaces"`
	}](t, r)
	if len(list.Workspaces) != 1 || list.Workspaces[0].ID != ws.ID || list.Workspaces[0].MyRole != "member" || list.Workspaces[0].MemberCount != nil {
		t.Fatalf("member's workspaces = %+v", list)
	}
	r = c.as(admin, http.MethodGet, base, nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[workspaceBody](t, r); got.MyRole != "admin" || *got.MemberCount != 3 {
		t.Errorf("get as admin = %+v", got)
	}
	// メンバーでなければ、ID を知っていても 404。
	expectProblem(t, c.as(outsider, http.MethodGet, base, nil), http.StatusNotFound, "not-found")
	expectProblem(t, c.as(owner, http.MethodGet, "/api/v1/workspaces/not-a-ulid", nil), http.StatusNotFound, "not-found")

	// 変更
	expectProblem(t, c.as(member, http.MethodPatch, base, map[string]string{"name": "乗っ取り"}), http.StatusForbidden, "forbidden")
	r = c.as(admin, http.MethodPatch, base, map[string]any{"invite_policy": "all_members", "name": nil})
	expectStatus(t, r, http.StatusOK)
	if got := decode[workspaceBody](t, r); got.InvitePolicy != "all_members" || got.Name != "山と印刷" {
		t.Errorf("patched workspace = %+v, want policy changed and name kept", got)
	}
	p := expectProblem(t, c.as(owner, http.MethodPatch, base, map[string]string{"name": " ", "invite_policy": "everyone"}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 2 {
		t.Errorf("validation errors = %+v, want name and invite_policy", p.Errors)
	}

	// メンバー一覧のページング
	r = c.as(member, http.MethodGet, base+"/members?limit=2", nil)
	expectStatus(t, r, http.StatusOK)
	page1 := decode[membersBody](t, r)
	if len(page1.Members) != 2 || page1.NextCursor == nil {
		t.Fatalf("page 1 = %+v", page1)
	}
	r = c.as(member, http.MethodGet, base+"/members?limit=2&after="+*page1.NextCursor, nil)
	expectStatus(t, r, http.StatusOK)
	page2 := decode[membersBody](t, r)
	if len(page2.Members) != 1 || page2.NextCursor != nil || !strings.Contains(string(r.body), `"next_cursor":null`) {
		t.Fatalf("page 2 = %s", r.body)
	}
	for _, q := range []string{"?limit=0", "?limit=abc", "?after=xyz"} {
		expectProblem(t, c.as(member, http.MethodGet, base+"/members"+q, nil), http.StatusBadRequest, "bad-request")
	}

	// ロール変更: admin は他の admin を降格できない。owner はできる。
	adminPath := base + "/members/" + admin.id
	expectProblem(t, c.as(admin, http.MethodPatch, base+"/members/"+member.id, map[string]string{"role": "owner"}), http.StatusForbidden, "forbidden")
	r = c.as(admin, http.MethodPatch, base+"/members/"+member.id, map[string]string{"role": "admin"})
	expectStatus(t, r, http.StatusOK)
	if got := decode[memberBody](t, r); got.Role != "admin" || got.User.ID != member.id || got.User.Handle == "" {
		t.Errorf("promoted member = %+v", got)
	}
	expectProblem(t, c.as(member, http.MethodPatch, adminPath, map[string]string{"role": "member"}), http.StatusForbidden, "forbidden")
	expectProblem(t, c.as(owner, http.MethodPatch, adminPath, map[string]string{"role": "king"}), http.StatusUnprocessableEntity, "validation-error")
	r = c.as(owner, http.MethodPatch, adminPath, map[string]string{"role": "member"})
	expectStatus(t, r, http.StatusOK)

	// owner は譲渡するまで退出できない。
	expectProblem(t, c.as(owner, http.MethodDelete, base+"/members/"+owner.id, nil), http.StatusConflict, "owner-must-transfer")
	expectProblem(t, c.as(owner, http.MethodPost, base+"/ownership-transfer", map[string]string{"user_id": "bogus"}), http.StatusUnprocessableEntity, "validation-error")
	expectProblem(t, c.as(member, http.MethodPost, base+"/ownership-transfer", map[string]string{"user_id": admin.id}), http.StatusForbidden, "forbidden")
	expectStatus(t, c.as(owner, http.MethodPost, base+"/ownership-transfer", map[string]string{"user_id": member.id}), http.StatusNoContent)
	r = c.as(owner, http.MethodGet, base, nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[workspaceBody](t, r); got.MyRole != "admin" {
		t.Errorf("old owner's role = %q, want admin", got.MyRole)
	}

	// キックと退出
	expectProblem(t, c.as(admin, http.MethodDelete, base+"/members/"+owner.id, nil), http.StatusForbidden, "forbidden")
	expectStatus(t, c.as(member, http.MethodDelete, adminPath, nil), http.StatusNoContent) // 新しい owner が member（元 admin）をキック
	expectProblem(t, c.as(admin, http.MethodGet, base, nil), http.StatusNotFound, "not-found")
	expectStatus(t, c.as(owner, http.MethodDelete, base+"/members/"+owner.id, nil), http.StatusNoContent)
	expectProblem(t, c.as(owner, http.MethodGet, base+"/members", nil), http.StatusNotFound, "not-found")

	// 認証がなければ 401。
	expectProblem(t, c.do(request{method: http.MethodGet, path: "/api/v1/workspaces"}), http.StatusUnauthorized, "unauthenticated")
}

type inviteBody struct {
	ID        string  `json:"id"`
	MaxUses   *int    `json:"max_uses"`
	UseCount  int     `json:"use_count"`
	ExpiresAt string  `json:"expires_at"`
	RevokedAt *string `json:"revoked_at"`
	Status    string  `json:"status"`
	Code      string  `json:"code"`
	CreatedBy struct {
		ID string `json:"id"`
	} `json:"created_by"`
}

func TestInviteFlow(t *testing.T) {
	c := newAPI(t)
	owner, member, newcomer, stranger := c.registerUser(), c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	base := "/api/v1/workspaces/" + ws.ID
	c.addMember(ws.ID, member, "member")

	// 作成: コードは作成のレスポンスでだけ返る。
	expectProblem(t, c.as(member, http.MethodPost, base+"/invites", map[string]any{"expires_in_seconds": 3600}), http.StatusForbidden, "forbidden")
	p := expectProblem(t, c.as(owner, http.MethodPost, base+"/invites", map[string]any{"max_uses": 0, "expires_in_seconds": int64(1) << 62}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 2 {
		t.Errorf("errors = %+v, want max_uses and expires_in_seconds out of range", p.Errors)
	}
	r = c.as(owner, http.MethodPost, base+"/invites", map[string]any{"max_uses": 1, "expires_in_seconds": 7 * 24 * 3600})
	expectStatus(t, r, http.StatusCreated)
	inv := decode[inviteBody](t, r)
	if len(inv.Code) != 22 || inv.Status != "active" || inv.MaxUses == nil || *inv.MaxUses != 1 || inv.CreatedBy.ID != owner.id || inv.RevokedAt != nil {
		t.Fatalf("created invite = %s", r.body)
	}

	// 一覧: member も見られるが、コードは含まれない。
	r = c.as(member, http.MethodGet, base+"/invites", nil)
	expectStatus(t, r, http.StatusOK)
	if strings.Contains(string(r.body), inv.Code) || strings.Contains(string(r.body), `"code"`) {
		t.Fatalf("invite list leaks the code: %s", r.body)
	}
	list := decode[struct {
		Invites    []inviteBody `json:"invites"`
		NextCursor *string      `json:"next_cursor"`
	}](t, r)
	if len(list.Invites) != 1 || list.Invites[0].ID != inv.ID {
		t.Fatalf("invites = %s", r.body)
	}
	expectProblem(t, c.as(stranger, http.MethodGet, base+"/invites", nil), http.StatusNotFound, "not-found")

	// プレビュー → 参加
	r = c.as(newcomer, http.MethodGet, "/api/v1/invites/"+inv.Code, nil)
	expectStatus(t, r, http.StatusOK)
	preview := decode[struct {
		Workspace struct {
			ID              string `json:"id"`
			Name            string `json:"name"`
			MemberCount     int    `json:"member_count"`
			PublicRoomCount int    `json:"public_room_count"`
		} `json:"workspace"`
		Inviter struct {
			ID string `json:"id"`
		} `json:"inviter"`
		AlreadyMember bool `json:"already_member"`
	}](t, r)
	if preview.Workspace.ID != ws.ID || preview.Workspace.Name != "山と印刷" || preview.Workspace.MemberCount != 2 || preview.Inviter.ID != owner.id || preview.AlreadyMember {
		t.Errorf("preview = %s", r.body)
	}
	expectProblem(t, c.do(request{method: http.MethodGet, path: "/api/v1/invites/" + inv.Code}), http.StatusUnauthorized, "unauthenticated")

	r = c.as(newcomer, http.MethodPost, "/api/v1/invites/"+inv.Code+"/accept", nil)
	expectStatus(t, r, http.StatusOK)
	accepted := decode[struct {
		Workspace     workspaceBody `json:"workspace"`
		AlreadyMember bool          `json:"already_member"`
	}](t, r)
	if accepted.AlreadyMember || accepted.Workspace.ID != ws.ID || accepted.Workspace.MyRole != "member" {
		t.Errorf("accept = %s", r.body)
	}
	r = c.as(newcomer, http.MethodPost, "/api/v1/invites/"+inv.Code+"/accept", nil)
	expectStatus(t, r, http.StatusOK)
	if !strings.Contains(string(r.body), `"already_member":true`) {
		t.Errorf("second accept = %s, want already_member", r.body)
	}

	// 使えない招待は理由ごとの problem になり、ワークスペースの情報を含まない。
	r = c.as(stranger, http.MethodPost, "/api/v1/invites/"+inv.Code+"/accept", nil)
	expectProblem(t, r, http.StatusGone, "invite-exhausted")
	if strings.Contains(string(r.body), ws.ID) || strings.Contains(string(r.body), "山と印刷") {
		t.Errorf("problem leaks the workspace: %s", r.body)
	}
	expectProblem(t, c.as(stranger, http.MethodGet, "/api/v1/invites/"+inv.Code, nil), http.StatusGone, "invite-exhausted")
	expectProblem(t, c.as(stranger, http.MethodGet, "/api/v1/invites/nope", nil), http.StatusNotFound, "invite-invalid")

	r = c.as(owner, http.MethodPost, base+"/invites", map[string]any{"expires_in_seconds": 60})
	expectStatus(t, r, http.StatusCreated)
	short := decode[inviteBody](t, r)
	c.env.Clock.Advance(time.Minute)
	expectProblem(t, c.as(stranger, http.MethodGet, "/api/v1/invites/"+short.Code, nil), http.StatusGone, "invite-expired")

	// 取り消し
	r = c.as(owner, http.MethodPost, base+"/invites", map[string]any{"expires_in_seconds": 3600})
	expectStatus(t, r, http.StatusCreated)
	toRevoke := decode[inviteBody](t, r)
	expectProblem(t, c.as(member, http.MethodDelete, base+"/invites/"+toRevoke.ID, nil), http.StatusForbidden, "forbidden")
	expectStatus(t, c.as(owner, http.MethodDelete, base+"/invites/"+toRevoke.ID, nil), http.StatusNoContent)
	expectStatus(t, c.as(owner, http.MethodDelete, base+"/invites/"+toRevoke.ID, nil), http.StatusNoContent)
	expectProblem(t, c.as(stranger, http.MethodPost, "/api/v1/invites/"+toRevoke.Code+"/accept", nil), http.StatusNotFound, "invite-invalid")
}

type roomBody struct {
	ID          string  `json:"id"`
	Kind        string  `json:"kind"`
	Name        *string `json:"name"`
	IsDefault   bool    `json:"is_default"`
	IsMember    bool    `json:"is_member"`
	MemberCount *int    `json:"member_count"`
	DMPeer      *struct {
		ID string `json:"id"`
	} `json:"dm_peer"`
}

// joinViaInvite は owner が作った招待で u をワークスペースに参加させる（ロードマップ Phase 3a の DoD の流れ）。
func (c *apiClient) joinViaInvite(owner apiUser, workspaceID string, u apiUser) {
	c.t.Helper()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", map[string]any{"expires_in_seconds": 3600})
	expectStatus(c.t, r, http.StatusCreated)
	code := decode[inviteBody](c.t, r).Code
	expectStatus(c.t, c.as(u, http.MethodPost, "/api/v1/invites/"+code+"/accept", nil), http.StatusOK)
}

// ワークスペース作成 → 招待 → 別ユーザーが参加 → ルーム作成 → 参加（ロードマップ Phase 3a の DoD）。
func TestRoomFlow(t *testing.T) {
	c := newAPI(t)
	owner, alice, bob, stranger := c.registerUser(), c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	base := "/api/v1/workspaces/" + ws.ID

	// public ルームを作り、既定のルームにしてから招待する。
	r = c.as(owner, http.MethodPost, base+"/rooms", map[string]string{"kind": "public", "name": "雑談"})
	expectStatus(t, r, http.StatusCreated)
	general := decode[roomBody](t, r)
	if general.Kind != "public" || general.Name == nil || *general.Name != "雑談" || !general.IsMember || *general.MemberCount != 1 {
		t.Fatalf("created room = %s", r.body)
	}
	r = c.as(owner, http.MethodPatch, "/api/v1/rooms/"+general.ID, map[string]any{"is_default": true})
	expectStatus(t, r, http.StatusOK)
	c.joinViaInvite(owner, ws.ID, alice)
	c.joinViaInvite(owner, ws.ID, bob)

	// 招待を受け入れると既定のルームに参加している。
	r = c.as(alice, http.MethodGet, "/api/v1/rooms/"+general.ID, nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[roomBody](t, r); !got.IsMember || *got.MemberCount != 3 {
		t.Errorf("default room for alice = %s", r.body)
	}
	expectProblem(t, c.as(alice, http.MethodPatch, "/api/v1/rooms/"+general.ID, map[string]string{"name": "乗っ取り"}), http.StatusForbidden, "forbidden")

	// alice が public を作り、bob が参加する。
	r = c.as(alice, http.MethodPost, base+"/rooms", map[string]string{"kind": "public", "name": "デザインレビュー"})
	expectStatus(t, r, http.StatusCreated)
	design := decode[roomBody](t, r)
	expectProblem(t, c.as(bob, http.MethodPost, base+"/rooms", map[string]string{"kind": "private", "name": "デザインレビュー"}), http.StatusConflict, "room-name-taken")
	r = c.as(bob, http.MethodGet, "/api/v1/rooms/"+design.ID, nil)
	expectStatus(t, r, http.StatusOK)
	if decode[roomBody](t, r).IsMember {
		t.Error("bob should be able to read the public room without joining")
	}
	r = c.as(bob, http.MethodPost, "/api/v1/rooms/"+design.ID+"/join", nil)
	expectStatus(t, r, http.StatusOK)
	if got := decode[roomBody](t, r); !got.IsMember || *got.MemberCount != 2 {
		t.Errorf("joined room = %s", r.body)
	}

	// private ルームは、追加されるまで一覧にも出ず、取得も 404。
	r = c.as(alice, http.MethodPost, base+"/rooms", map[string]string{"kind": "private", "name": "リリース準備"})
	expectStatus(t, r, http.StatusCreated)
	private := decode[roomBody](t, r)
	expectProblem(t, c.as(bob, http.MethodGet, "/api/v1/rooms/"+private.ID, nil), http.StatusNotFound, "not-found")
	expectProblem(t, c.as(bob, http.MethodPost, "/api/v1/rooms/"+private.ID+"/join", nil), http.StatusNotFound, "not-found")
	expectProblem(t, c.as(alice, http.MethodPost, "/api/v1/rooms/"+private.ID+"/members", map[string]string{"user_id": stranger.id}), http.StatusUnprocessableEntity, "user-not-in-workspace")
	expectProblem(t, c.as(alice, http.MethodPost, "/api/v1/rooms/"+private.ID+"/members", map[string]string{}), http.StatusUnprocessableEntity, "validation-error")
	expectStatus(t, c.as(alice, http.MethodPost, "/api/v1/rooms/"+private.ID+"/members", map[string]string{"user_id": bob.id}), http.StatusNoContent)

	// DM: 新規は 201、相手から作っても同じルームを 200 で返す。
	r = c.as(bob, http.MethodPost, base+"/rooms", map[string]string{"kind": "dm", "user_id": alice.id})
	expectStatus(t, r, http.StatusCreated)
	dm := decode[roomBody](t, r)
	if dm.Kind != "dm" || dm.Name != nil || dm.DMPeer == nil || dm.DMPeer.ID != alice.id || !strings.Contains(string(r.body), `"name":null`) {
		t.Fatalf("dm = %s", r.body)
	}
	r = c.as(alice, http.MethodPost, base+"/rooms", map[string]string{"kind": "dm", "user_id": bob.id})
	expectStatus(t, r, http.StatusOK)
	if got := decode[roomBody](t, r); got.ID != dm.ID || got.DMPeer.ID != bob.id {
		t.Errorf("reverse dm = %s", r.body)
	}
	expectProblem(t, c.as(bob, http.MethodPost, base+"/rooms", map[string]string{"kind": "dm", "user_id": bob.id}), http.StatusUnprocessableEntity, "validation-error")
	expectProblem(t, c.as(owner, http.MethodGet, "/api/v1/rooms/"+dm.ID, nil), http.StatusNotFound, "not-found")

	// bob のサイドバー: 参加しているルームと、参加していない public ルーム。
	r = c.as(bob, http.MethodGet, base+"/rooms", nil)
	expectStatus(t, r, http.StatusOK)
	list := decode[struct {
		Rooms []roomBody `json:"rooms"`
	}](t, r)
	got := map[string]bool{}
	for _, room := range list.Rooms {
		got[room.ID] = room.IsMember
		if room.MemberCount != nil {
			t.Errorf("list includes member_count: %s", r.body)
		}
	}
	if len(got) != 4 || !got[general.ID] || !got[design.ID] || !got[private.ID] || !got[dm.ID] {
		t.Errorf("bob's rooms = %s", r.body)
	}
	r = c.as(owner, http.MethodGet, base+"/rooms", nil)
	expectStatus(t, r, http.StatusOK)
	if strings.Contains(string(r.body), private.ID) || strings.Contains(string(r.body), dm.ID) {
		t.Errorf("owner's rooms include a private room or someone else's dm: %s", r.body)
	}

	// ルームのメンバー一覧（ワークスペースでのロール付き）
	r = c.as(owner, http.MethodGet, "/api/v1/rooms/"+design.ID+"/members", nil)
	expectStatus(t, r, http.StatusOK)
	members := decode[membersBody](t, r)
	if len(members.Members) != 2 || members.NextCursor != nil {
		t.Errorf("room members = %s", r.body)
	}
	for _, m := range members.Members {
		if m.Role != "member" {
			t.Errorf("member role = %q, want the workspace role", m.Role)
		}
	}

	// ルームから外す: member は他人を外せない。admin 以上は外せる。自分は抜けられる。DM は固定。
	expectProblem(t, c.as(alice, http.MethodDelete, "/api/v1/rooms/"+design.ID+"/members/"+bob.id, nil), http.StatusForbidden, "forbidden")
	expectStatus(t, c.as(owner, http.MethodDelete, "/api/v1/rooms/"+design.ID+"/members/"+bob.id, nil), http.StatusNoContent)
	expectStatus(t, c.as(bob, http.MethodDelete, "/api/v1/rooms/"+private.ID+"/members/"+bob.id, nil), http.StatusNoContent)
	expectProblem(t, c.as(bob, http.MethodGet, "/api/v1/rooms/"+private.ID, nil), http.StatusNotFound, "not-found")
	expectProblem(t, c.as(bob, http.MethodDelete, "/api/v1/rooms/"+dm.ID+"/members/"+bob.id, nil), http.StatusForbidden, "forbidden")
	expectProblem(t, c.as(stranger, http.MethodGet, base+"/rooms", nil), http.StatusNotFound, "not-found")
}
