package httpx_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

type memberProfileBody struct {
	memberBody
	Presence string  `json:"presence"`
	Email    *string `json:"email"`
}

// verifyEmail は u の email を検証済みにする（確認メールのリンクを踏む代わりに SQL で）。
func (c *apiClient) verifyEmail(u apiUser) {
	c.t.Helper()
	if _, err := c.env.Pool.Exec(c.t.Context(), `UPDATE users SET email_verified_at = $2 WHERE id = $1`,
		ulid.MustParse(u.id), c.env.Clock.Now()); err != nil {
		c.t.Fatal(err)
	}
}

// TestMemberProfile は GET /workspaces/{id}/members/{userID}（ADR 0050 決定 1 / 2）。
func TestMemberProfile(t *testing.T) {
	c := newAPI(t)
	owner, member, outsider, kicked := c.registerUser(), c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	base := "/api/v1/workspaces/" + ws.ID + "/members/"
	c.addMember(ws.ID, member, "member")
	c.addMember(ws.ID, kicked, "member")
	expectStatus(t, c.as(owner, http.MethodDelete, base+kicked.id, nil), http.StatusNoContent)

	r = c.as(outsider, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "別の会社"})
	expectStatus(t, r, http.StatusCreated)
	otherWS := decode[workspaceBody](t, r)

	t.Run("未検証の email は null として返す（キーは省かない）", func(t *testing.T) {
		r := c.as(member, http.MethodGet, base+owner.id, nil)
		expectStatus(t, r, http.StatusOK)
		if !strings.Contains(string(r.body), `"email":null`) {
			t.Errorf("body = %s, want \"email\":null", r.body)
		}
		got := decode[memberProfileBody](t, r)
		if got.User.ID != owner.id || got.Role != "owner" || got.Presence == "" {
			t.Errorf("profile = %+v", got)
		}
	})

	t.Run("検証済みなら email を返す", func(t *testing.T) {
		c.verifyEmail(owner)
		r := c.as(member, http.MethodGet, base+owner.id, nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[memberProfileBody](t, r); got.Email == nil || !strings.Contains(*got.Email, "@") {
			t.Errorf("email = %v, want the verified address", got.Email)
		}
	})

	t.Run("返らないものは、どれも 404", func(t *testing.T) {
		c.verifyEmail(kicked)
		c.verifyEmail(outsider)
		for name, tc := range map[string]struct {
			as   apiUser
			path string
		}{
			"メンバーでない人":             {outsider, base + owner.id},
			"外されたユーザー":             {member, base + kicked.id},
			"別のワークスペースのユーザー":       {member, base + outsider.id},
			"別のワークスペースを指して自分の同僚を引く": {member, "/api/v1/workspaces/" + otherWS.ID + "/members/" + owner.id},
			"ULID でない ID":           {member, base + "not-a-ulid"},
		} {
			t.Run(name, func(t *testing.T) {
				expectProblem(t, c.as(tc.as, http.MethodGet, tc.path, nil), http.StatusNotFound, "not-found")
			})
		}
	})

	t.Run("ログインしていなければ 401", func(t *testing.T) {
		r := c.do(request{method: http.MethodGet, path: base + owner.id})
		expectStatus(t, r, http.StatusUnauthorized)
	})
}
