package httpx_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

// apiUser は API で登録したユーザー。
type apiUser struct {
	id    string
	token string
}

func (c *apiClient) registerUser() apiUser {
	c.t.Helper()
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: registerBody(c)})
	if r.status != http.StatusCreated {
		c.t.Fatalf("register status = %d: %s", r.status, r.body)
	}
	b := decode[tokenBody](c.t, r)
	return apiUser{id: b.User.ID, token: b.AccessToken}
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
