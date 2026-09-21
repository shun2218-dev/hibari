package httpx_test

import (
	"net/http"
	"net/url"
	"testing"
)

// TestUnverifiedEmailCannotUseChat は、email を検証するまで chat の API と ws-ticket が 403 になり、
// auth の API は使えることを確かめる（ADR 0053 決定 1）。検証した後は、refresh したトークンで chat を使える（決定 2）。
func TestUnverifiedEmailCannotUseChat(t *testing.T) {
	c := newAPI(t, withVerifiedEmailRequired())
	reg := registerBody(c)
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg})
	expectStatus(t, r, http.StatusCreated)
	registered := decode[tokenBody](t, r)
	token := registered.AccessToken

	// chat の入り口。読むだけの API も、/users/me の下に置いた chat の API（離席）も止める。
	chatRequests := []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/api/v1/workspaces", nil},
		{http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "hibari"}},
		{http.MethodGet, "/api/v1/invites/abc", nil},
		{http.MethodPut, "/api/v1/users/me/presence", map[string]bool{"away": true}},
		{http.MethodPost, "/api/v1/ws/ticket", nil},
	}
	expectBlocked := func(t *testing.T, token string) {
		t.Helper()
		for _, req := range chatRequests {
			r := c.do(request{method: req.method, path: req.path, body: req.body, headers: bearer(token)})
			if r.status != http.StatusForbidden {
				t.Errorf("%s %s = %d, want 403: %s", req.method, req.path, r.status, r.body)
				continue
			}
			expectProblem(t, r, http.StatusForbidden, "email-unverified")
		}
	}
	expectBlocked(t, token)

	// 検証を済ませるのに要る操作と、自分のアカウントの操作は使える。
	authRequests := []struct {
		method, path string
		body         any
		want         int
	}{
		{http.MethodGet, "/api/v1/users/me", nil, http.StatusOK},
		{http.MethodPatch, "/api/v1/users/me", map[string]string{"display_name": "検証待ち"}, http.StatusOK},
		{http.MethodGet, "/api/v1/auth/sessions", nil, http.StatusOK},
		{http.MethodPost, "/api/v1/auth/verify-email/request", nil, http.StatusAccepted},
	}
	for _, req := range authRequests {
		r := c.do(request{method: req.method, path: req.path, body: req.body, headers: bearer(token)})
		if r.status != req.want {
			t.Errorf("%s %s = %d, want %d: %s", req.method, req.path, r.status, req.want, r.body)
		}
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/verify-email/confirm",
		body: map[string]string{"token": c.env.Mailer.Last(t, reg["email"]).Token()}})
	expectStatus(t, r, http.StatusNoContent)

	// 検証の前に発行したトークンは、期限まで止まったまま（止める側にしか間違えない）。
	expectBlocked(t, token)

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *registered.RefreshToken}})
	expectStatus(t, r, http.StatusOK)
	refreshed := decode[tokenBody](t, r).AccessToken

	r = c.do(request{method: http.MethodGet, path: "/api/v1/workspaces", headers: bearer(refreshed)})
	expectStatus(t, r, http.StatusOK)
	r = c.do(request{method: http.MethodPost, path: "/api/v1/workspaces", body: map[string]string{"name": "hibari"}, headers: bearer(refreshed)})
	expectStatus(t, r, http.StatusCreated)
	r = c.do(request{method: http.MethodPost, path: "/api/v1/ws/ticket", headers: bearer(refreshed)})
	expectStatus(t, r, http.StatusOK)
}

// TestUnverifiedEmailAllowedInDevelopment は、検証を外した設定（開発環境。ADR 0053 決定 4）では止めないことを確かめる。
func TestUnverifiedEmailAllowedInDevelopment(t *testing.T) {
	c := newAPI(t)
	u := c.registerUser()
	expectStatus(t, c.as(u, http.MethodGet, "/api/v1/workspaces", nil), http.StatusOK)
	expectStatus(t, c.as(u, http.MethodPost, "/api/v1/ws/ticket", nil), http.StatusOK)
}

// TestEmailVerificationNext は、登録と再送で受け取った戻り先を確認メールのリンクに載せ、
// アプリの外を指す戻り先は 422 で断ることを確かめる（ADR 0053 決定 3）。
func TestEmailVerificationNext(t *testing.T) {
	c := newAPI(t, withVerifiedEmailRequired())
	nextOf := func(t *testing.T, email string) string {
		t.Helper()
		u, err := url.Parse(c.env.Mailer.Last(t, email).Link)
		if err != nil {
			t.Fatal(err)
		}
		return u.Query().Get("next")
	}

	reg := registerBody(c)
	reg["next"] = "/invite/abc"
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg})
	expectStatus(t, r, http.StatusCreated)
	token := decode[tokenBody](t, r).AccessToken
	if got := nextOf(t, reg["email"]); got != "/invite/abc" {
		t.Fatalf("next in the link after register = %q", got)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/verify-email/request",
		body: map[string]string{"next": "/invite/def"}, headers: bearer(token)})
	expectStatus(t, r, http.StatusAccepted)
	if got := nextOf(t, reg["email"]); got != "/invite/def" {
		t.Fatalf("next in the resent link = %q", got)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/verify-email/request",
		body: map[string]string{"next": "https://evil.example/"}, headers: bearer(token)})
	p := expectProblem(t, r, http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "next" {
		t.Fatalf("errors = %+v, want one on next", p.Errors)
	}

	bad := registerBody(c)
	bad["next"] = "//evil.example/"
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: bad})
	p = expectProblem(t, r, http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "next" {
		t.Fatalf("errors = %+v, want one on next", p.Errors)
	}
}
