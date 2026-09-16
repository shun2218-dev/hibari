package httpx_test

import (
	"net/http"
	"strings"
	"testing"
)

type sessionBody struct {
	ID         string `json:"id"`
	UserAgent  string `json:"user_agent"`
	Current    bool   `json:"current"`
	StartedAt  string `json:"started_at"`
	LastUsedAt string `json:"last_used_at"`
}

type sessionsBody struct {
	Sessions []sessionBody `json:"sessions"`
}

type userBody struct {
	ID          string `json:"id"`
	Handle      string `json:"handle"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	AvatarURL   string `json:"avatar_url"`
}

// login は同じアカウントでもう 1 つセッションを作り、そのトークンを返す。
func login(t *testing.T, c *apiClient, reg map[string]string, userAgent string) tokenBody {
	t.Helper()
	r := c.do(request{
		method:  http.MethodPost,
		path:    "/api/v1/auth/login",
		body:    map[string]string{"email": reg["email"], "password": reg["password"]},
		headers: map[string]string{"User-Agent": userAgent},
	})
	if r.status != http.StatusOK {
		t.Fatalf("login status = %d: %s", r.status, r.body)
	}
	return decode[tokenBody](t, r)
}

// 設定画面の「ログイン中のデバイス」: 一覧 → 1 つログアウト → 他のすべてからログアウト（ADR 0019）。
func TestSessionEndpoints(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg, headers: map[string]string{"User-Agent": "Chrome"}})
	if r.status != http.StatusCreated {
		t.Fatalf("register status = %d: %s", r.status, r.body)
	}
	mine := decode[tokenBody](t, r)
	phone := login(t, c, reg, "hibari for iOS")
	tablet := login(t, c, reg, "Safari")

	list := decode[sessionsBody](t, c.do(request{method: http.MethodGet, path: "/api/v1/auth/sessions", headers: bearer(mine.AccessToken)}))
	if len(list.Sessions) != 3 {
		t.Fatalf("sessions = %d, want 3: %+v", len(list.Sessions), list.Sessions)
	}
	var current *sessionBody
	agents := map[string]bool{}
	for i, s := range list.Sessions {
		agents[s.UserAgent] = true
		if s.Current {
			current = &list.Sessions[i]
		}
		if s.StartedAt == "" || s.LastUsedAt == "" {
			t.Errorf("session %+v has no timestamps", s)
		}
	}
	if current == nil {
		t.Fatal("no session is marked as current")
	}
	if !agents["Chrome"] || !agents["hibari for iOS"] || !agents["Safari"] {
		t.Errorf("user agents = %v, want one per session", agents)
	}
	// IP は返さない（ADR 0019）。
	if strings.Contains(string(c.do(request{method: http.MethodGet, path: "/api/v1/auth/sessions", headers: bearer(mine.AccessToken)}).body), "127.0.0.1") {
		t.Error("sessions response contains an IP address")
	}

	// 1 つ（スマートフォン）を失効させる。そのセッションの Refresh Token は使えなくなる。
	phoneID := sessionIDByUserAgent(t, list.Sessions, "hibari for iOS")
	if r := c.do(request{method: http.MethodDelete, path: "/api/v1/auth/sessions/" + phoneID, headers: bearer(mine.AccessToken)}); r.status != http.StatusNoContent {
		t.Fatalf("delete session status = %d: %s", r.status, r.body)
	}
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *phone.RefreshToken}})
	expectProblem(t, r, http.StatusUnauthorized, "invalid-refresh-token")

	// もう一度消すと 404（すでにないセッション）。
	expectProblem(t, c.do(request{method: http.MethodDelete, path: "/api/v1/auth/sessions/" + phoneID, headers: bearer(mine.AccessToken)}), http.StatusNotFound, "not-found")

	// 他のすべてからログアウトする。残るのは自分のセッションだけ。
	r = c.do(request{method: http.MethodDelete, path: "/api/v1/auth/sessions", headers: bearer(mine.AccessToken)})
	if r.status != http.StatusOK {
		t.Fatalf("delete other sessions status = %d: %s", r.status, r.body)
	}
	if got := decode[struct {
		RevokedCount int `json:"revoked_count"`
	}](t, r); got.RevokedCount != 1 {
		t.Errorf("revoked count = %d, want 1 (only the tablet was left)", got.RevokedCount)
	}
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *tablet.RefreshToken}})
	expectProblem(t, r, http.StatusUnauthorized, "invalid-refresh-token")

	list = decode[sessionsBody](t, c.do(request{method: http.MethodGet, path: "/api/v1/auth/sessions", headers: bearer(mine.AccessToken)}))
	if len(list.Sessions) != 1 || !list.Sessions[0].Current {
		t.Fatalf("sessions after logging out the others = %+v, want only the current one", list.Sessions)
	}
	// 自分の Refresh Token はそのまま使える。
	if r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *mine.RefreshToken}}); r.status != http.StatusOK {
		t.Fatalf("refresh with my own token = %d: %s", r.status, r.body)
	}
}

func sessionIDByUserAgent(t *testing.T, sessions []sessionBody, userAgent string) string {
	t.Helper()
	for _, s := range sessions {
		if s.UserAgent == userAgent {
			return s.ID
		}
	}
	t.Fatalf("no session with user agent %q in %+v", userAgent, sessions)
	return ""
}

// 他人のセッションや存在しない ID は 404（存在を明かさない）。
func TestRevokeSessionNotFound(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	me := decode[tokenBody](t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg}))

	// 他人のセッションも、存在しない ID と同じく 404 にする。
	otherReg := registerBody(c)
	otherToken := decode[tokenBody](t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: otherReg}))
	otherSessions := decode[sessionsBody](t, c.do(request{method: http.MethodGet, path: "/api/v1/auth/sessions", headers: bearer(otherToken.AccessToken)}))
	if len(otherSessions.Sessions) != 1 {
		t.Fatalf("other user sessions = %+v", otherSessions.Sessions)
	}
	expectProblem(t, c.do(request{
		method:  http.MethodDelete,
		path:    "/api/v1/auth/sessions/" + otherSessions.Sessions[0].ID,
		headers: bearer(me.AccessToken),
	}), http.StatusNotFound, "not-found")
	// 相手のセッションは生きたまま。
	if r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *otherToken.RefreshToken}}); r.status != http.StatusOK {
		t.Fatalf("victim session after a failed revoke = %d: %s", r.status, r.body)
	}

	for _, path := range []string{
		"/api/v1/auth/sessions/01J8ZH5K000000000000000001",
		"/api/v1/auth/sessions/not-a-ulid",
	} {
		r := c.do(request{method: http.MethodDelete, path: path, headers: bearer(me.AccessToken)})
		expectProblem(t, r, http.StatusNotFound, "not-found")
	}
}

func TestSessionEndpointsRequireAuth(t *testing.T) {
	c := newAPI(t)
	for _, req := range []request{
		{method: http.MethodGet, path: "/api/v1/auth/sessions"},
		{method: http.MethodDelete, path: "/api/v1/auth/sessions"},
		{method: http.MethodDelete, path: "/api/v1/auth/sessions/01J8ZH5K000000000000000001"},
		{method: http.MethodPatch, path: "/api/v1/users/me", body: map[string]string{"display_name": "x"}},
	} {
		if r := c.do(req); r.status != http.StatusUnauthorized {
			t.Errorf("%s %s without a token = %d, want 401", req.method, req.path, r.status)
		}
	}
}

func TestUpdateProfileEndpoint(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	me := decode[tokenBody](t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg}))

	// 表示名だけを変える。ハンドルは変わらない。
	got := decode[userBody](t, c.do(request{
		method:  http.MethodPatch,
		path:    "/api/v1/users/me",
		body:    map[string]string{"display_name": "佐藤 直樹"},
		headers: bearer(me.AccessToken),
	}))
	if got.DisplayName != "佐藤 直樹" || got.Handle != reg["handle"] {
		t.Fatalf("profile = %+v, want the handle unchanged", got)
	}

	// 変えた値は me にも出る。
	after := decode[userBody](t, c.do(request{method: http.MethodGet, path: "/api/v1/users/me", headers: bearer(me.AccessToken)}))
	if after.DisplayName != "佐藤 直樹" {
		t.Fatalf("me after update = %+v", after)
	}

	// 使われているハンドルは 409。
	otherReg := registerBody(c)
	c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: otherReg})
	r := c.do(request{
		method:  http.MethodPatch,
		path:    "/api/v1/users/me",
		body:    map[string]string{"handle": otherReg["handle"]},
		headers: bearer(me.AccessToken),
	})
	expectProblem(t, r, http.StatusConflict, "handle-taken")

	// 形式が不正なら、どの項目がなぜ駄目かを返す。
	r = c.do(request{
		method:  http.MethodPatch,
		path:    "/api/v1/users/me",
		body:    map[string]string{"handle": "ab"},
		headers: bearer(me.AccessToken),
	})
	p := expectProblem(t, r, http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "handle" {
		t.Fatalf("errors = %+v, want one about the handle", p.Errors)
	}
}
