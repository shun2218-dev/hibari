package httpx_test

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/auth/authtest"
	"github.com/shun2218-dev/hibari/internal/httpx"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// 実物の Postgres に対してルーター全体を組み立て、HTTP の入出力を確かめる統合テスト。
type apiClient struct {
	t   *testing.T
	env *authtest.Env
	srv *httptest.Server
}

func newAPI(t *testing.T) *apiClient {
	t.Helper()
	env := authtest.New(t)
	jwks, err := env.AccessTokens.JWKS()
	if err != nil {
		t.Fatal(err)
	}
	h := httpx.NewRouter(httpx.Deps{
		Logger:              slog.New(slog.DiscardHandler),
		Clock:               env.Clock,
		IDs:                 id.NewGenerator(env.Clock, rand.Reader),
		Auth:                env.Service,
		Verifier:            env.Verifier,
		JWKS:                jwks,
		RefreshCookieSecure: true,
	})
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &apiClient{t: t, env: env, srv: srv}
}

type request struct {
	method  string
	path    string
	body    any // string ならそのまま、それ以外は JSON にする
	headers map[string]string
	cookies []*http.Cookie
}

type response struct {
	status  int
	header  http.Header
	cookies []*http.Cookie
	body    []byte
}

func (c *apiClient) do(r request) response {
	c.t.Helper()
	var body io.Reader
	switch b := r.body.(type) {
	case nil:
	case string:
		body = strings.NewReader(b)
	default:
		j, err := json.Marshal(b)
		if err != nil {
			c.t.Fatal(err)
		}
		body = bytes.NewReader(j)
	}
	req, err := http.NewRequestWithContext(c.t.Context(), r.method, c.srv.URL+r.path, body)
	if err != nil {
		c.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	for _, ck := range r.cookies {
		req.AddCookie(ck)
	}
	resp, err := c.srv.Client().Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	return response{status: resp.StatusCode, header: resp.Header, cookies: resp.Cookies(), body: b}
}

func decode[T any](t *testing.T, r response) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(r.body, &v); err != nil {
		t.Fatalf("body is not JSON: %v: %s", err, r.body)
	}
	return v
}

type tokenBody struct {
	User *struct {
		ID            string `json:"id"`
		Handle        string `json:"handle"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	} `json:"user"`
	AccessToken           string  `json:"access_token"`
	TokenType             string  `json:"token_type"`
	ExpiresIn             int     `json:"expires_in"`
	RefreshToken          *string `json:"refresh_token"`
	RefreshTokenExpiresAt *string `json:"refresh_token_expires_at"`
}

type problemBody struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	Status    int    `json:"status"`
	RequestID string `json:"request_id"`
	Errors    []struct {
		Field  string `json:"field"`
		Reason string `json:"reason"`
	} `json:"errors"`
}

func expectProblem(t *testing.T, r response, status int, typ string) problemBody {
	t.Helper()
	if r.status != status {
		t.Fatalf("status = %d, want %d: %s", r.status, status, r.body)
	}
	if ct := r.header.Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
	p := decode[problemBody](t, r)
	if p.Type != "tag:hibari,2026:problem:"+typ || p.Status != status || p.RequestID == "" {
		t.Fatalf("problem = %+v, want type %q", p, typ)
	}
	return p
}

func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

var webClient = map[string]string{"X-Hibari-Client": "web"}

func registerBody(c *apiClient) map[string]string {
	in := c.env.NewRegisterInput()
	return map[string]string{"handle": in.Handle, "display_name": in.DisplayName, "email": in.Email, "password": in.Password}
}

// ネイティブアプリの流れ: Refresh Token は JSON ボディで受け渡し、Cookie は使わない。
func TestAuthFlowNative(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)

	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg})
	if r.status != http.StatusCreated {
		t.Fatalf("register status = %d: %s", r.status, r.body)
	}
	if len(r.cookies) != 0 {
		t.Errorf("native register set cookies: %v", r.cookies)
	}
	if cc := r.header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store for token responses", cc)
	}
	registered := decode[tokenBody](t, r)
	if registered.User == nil || registered.User.Handle != reg["handle"] || registered.User.EmailVerified {
		t.Fatalf("register user = %+v", registered.User)
	}
	if registered.TokenType != "Bearer" || registered.ExpiresIn != 900 || registered.RefreshToken == nil || registered.RefreshTokenExpiresAt == nil {
		t.Fatalf("register tokens = %+v", registered)
	}

	r = c.do(request{method: http.MethodGet, path: "/api/v1/users/me", headers: bearer(registered.AccessToken)})
	if r.status != http.StatusOK || !strings.Contains(string(r.body), `"email":"`+reg["email"]+`"`) {
		t.Fatalf("me = %d %s", r.status, r.body)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/login", body: map[string]string{"email": reg["email"], "password": reg["password"]}})
	if r.status != http.StatusOK {
		t.Fatalf("login status = %d: %s", r.status, r.body)
	}
	loggedIn := decode[tokenBody](t, r)

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *loggedIn.RefreshToken}})
	if r.status != http.StatusOK {
		t.Fatalf("refresh status = %d: %s", r.status, r.body)
	}
	refreshed := decode[tokenBody](t, r)
	if refreshed.User != nil || refreshed.RefreshToken == nil || *refreshed.RefreshToken == *loggedIn.RefreshToken {
		t.Fatalf("refresh body = %+v, want rotated tokens without user", refreshed)
	}

	r = c.do(request{method: http.MethodGet, path: "/api/v1/users/me", headers: bearer(refreshed.AccessToken)})
	if r.status != http.StatusOK {
		t.Fatalf("me with refreshed token = %d %s", r.status, r.body)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/logout", body: map[string]string{"refresh_token": *refreshed.RefreshToken}})
	if r.status != http.StatusNoContent {
		t.Fatalf("logout status = %d: %s", r.status, r.body)
	}
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *refreshed.RefreshToken}})
	expectProblem(t, r, http.StatusUnauthorized, "invalid-refresh-token")

	// ログアウトしたのはログインで作ったセッションだけ。登録時のセッションは使える。
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *registered.RefreshToken}})
	if r.status != http.StatusOK {
		t.Fatalf("refresh of the other session = %d: %s", r.status, r.body)
	}
}

// Web の流れ: Refresh Token は httpOnly Cookie だけで受け渡し、ボディには出さない。
func TestAuthFlowWebCookie(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)

	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg, headers: webClient})
	if r.status != http.StatusCreated {
		t.Fatalf("register status = %d: %s", r.status, r.body)
	}
	body := decode[tokenBody](t, r)
	if body.RefreshToken != nil || body.RefreshTokenExpiresAt != nil {
		t.Fatalf("web register leaked the refresh token in the body: %s", r.body)
	}
	cookie := findCookie(t, r, "hibari_refresh")
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/api/v1/auth" || cookie.MaxAge != 30*24*60*60 {
		t.Fatalf("cookie attributes = %+v", cookie)
	}

	// Cookie と X-Hibari-Client: web で refresh できる。ボディは要らない。
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", headers: webClient, cookies: []*http.Cookie{cookie}})
	if r.status != http.StatusOK {
		t.Fatalf("refresh status = %d: %s", r.status, r.body)
	}
	rotated := findCookie(t, r, "hibari_refresh")
	if rotated.Value == cookie.Value || decode[tokenBody](t, r).RefreshToken != nil {
		t.Fatal("refresh did not rotate the cookie, or leaked the token in the body")
	}

	// ヘッダのない（他のオリジンから CORS のプリフライトなしに送れる）リクエストでは、Cookie を読まない。
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", cookies: []*http.Cookie{rotated}})
	if r.status == http.StatusOK {
		t.Fatal("refresh succeeded with the cookie alone, without the client header")
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/logout", headers: webClient, cookies: []*http.Cookie{rotated}})
	if r.status != http.StatusNoContent {
		t.Fatalf("logout status = %d: %s", r.status, r.body)
	}
	if cleared := findCookie(t, r, "hibari_refresh"); cleared.MaxAge >= 0 || cleared.Value != "" {
		t.Fatalf("logout did not clear the cookie: %+v", cleared)
	}

	// 失効した Cookie で refresh すると 401 になり、Cookie を消させる。
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", headers: webClient, cookies: []*http.Cookie{rotated}})
	expectProblem(t, r, http.StatusUnauthorized, "invalid-refresh-token")
	if cleared := findCookie(t, r, "hibari_refresh"); cleared.MaxAge >= 0 {
		t.Fatalf("failed refresh did not clear the cookie: %+v", cleared)
	}

	// Cookie がなければ 401。
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", headers: webClient})
	expectProblem(t, r, http.StatusUnauthorized, "invalid-refresh-token")
}

func findCookie(t *testing.T, r response, name string) *http.Cookie {
	t.Helper()
	for _, c := range r.cookies {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("response has no %s cookie (Set-Cookie: %v)", name, r.header.Values("Set-Cookie"))
	return nil
}

func TestMeRequiresValidAccessToken(t *testing.T) {
	c := newAPI(t)
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: registerBody(c)})
	token := decode[tokenBody](t, r).AccessToken

	t.Run("no token", func(t *testing.T) {
		r := c.do(request{method: http.MethodGet, path: "/api/v1/users/me"})
		expectProblem(t, r, http.StatusUnauthorized, "unauthenticated")
		if got := r.header.Get("WWW-Authenticate"); got != "Bearer" {
			t.Errorf("WWW-Authenticate = %q", got)
		}
	})
	t.Run("tampered token", func(t *testing.T) {
		r := c.do(request{method: http.MethodGet, path: "/api/v1/users/me", headers: bearer(token + "x")})
		expectProblem(t, r, http.StatusUnauthorized, "unauthenticated")
		if got := r.header.Get("WWW-Authenticate"); got != `Bearer error="invalid_token"` {
			t.Errorf("WWW-Authenticate = %q", got)
		}
	})
	t.Run("expired token", func(t *testing.T) {
		c.env.Clock.Advance(16 * time.Minute)
		r := c.do(request{method: http.MethodGet, path: "/api/v1/users/me", headers: bearer(token)})
		expectProblem(t, r, http.StatusUnauthorized, "unauthenticated")
	})
}

func TestRegisterErrors(t *testing.T) {
	c := newAPI(t)
	existing := registerBody(c)
	if r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: existing}); r.status != http.StatusCreated {
		t.Fatalf("setup register = %d %s", r.status, r.body)
	}

	t.Run("wrong content type", func(t *testing.T) {
		r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: `{}`, headers: map[string]string{"Content-Type": "text/plain"}})
		expectProblem(t, r, http.StatusUnsupportedMediaType, "bad-request")
	})
	t.Run("malformed json", func(t *testing.T) {
		r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: `{"handle":`})
		expectProblem(t, r, http.StatusBadRequest, "bad-request")
	})
	t.Run("trailing data", func(t *testing.T) {
		r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: `{} {}`})
		expectProblem(t, r, http.StatusBadRequest, "bad-request")
	})
	t.Run("too large", func(t *testing.T) {
		r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: `{"handle":"` + strings.Repeat("a", 70<<10) + `"}`})
		expectProblem(t, r, http.StatusRequestEntityTooLarge, "bad-request")
	})
	t.Run("validation", func(t *testing.T) {
		r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: map[string]string{"handle": "a", "email": "x"}})
		p := expectProblem(t, r, http.StatusUnprocessableEntity, "validation-error")
		got := map[string]string{}
		for _, e := range p.Errors {
			got[e.Field] = e.Reason
		}
		want := map[string]string{"handle": "invalid_format", "display_name": "required", "email": "invalid_format", "password": "required"}
		if len(got) != len(want) {
			t.Fatalf("errors = %v, want %v", got, want)
		}
		for k, v := range want {
			if got[k] != v {
				t.Errorf("errors[%s] = %q, want %q", k, got[k], v)
			}
		}
	})
	t.Run("email taken", func(t *testing.T) {
		body := registerBody(c)
		body["email"] = existing["email"]
		expectProblem(t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: body}), http.StatusConflict, "email-taken")
	})
	t.Run("handle taken", func(t *testing.T) {
		body := registerBody(c)
		body["handle"] = existing["handle"]
		expectProblem(t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: body}), http.StatusConflict, "handle-taken")
	})
}

// ログインの失敗は、アカウントの有無で区別できない（request_id 以外は同じレスポンス）。
func TestLoginFailureDoesNotRevealAccountExistence(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg})

	wrongPassword := c.do(request{method: http.MethodPost, path: "/api/v1/auth/login", body: map[string]string{"email": reg["email"], "password": "wrong password"}})
	unknownEmail := c.do(request{method: http.MethodPost, path: "/api/v1/auth/login", body: map[string]string{"email": "nobody-" + reg["email"], "password": "wrong password"}})

	a := expectProblem(t, wrongPassword, http.StatusUnauthorized, "invalid-credentials")
	b := expectProblem(t, unknownEmail, http.StatusUnauthorized, "invalid-credentials")
	a.RequestID, b.RequestID = "", ""
	if ja, jb := mustJSON(t, a), mustJSON(t, b); ja != jb {
		t.Fatalf("responses differ:\n wrong password: %s\n unknown email:  %s", ja, jb)
	}
}

func TestJWKSEndpoint(t *testing.T) {
	c := newAPI(t)
	r := c.do(request{method: http.MethodGet, path: "/.well-known/jwks.json"})
	if r.status != http.StatusOK || r.header.Get("Content-Type") != "application/jwk-set+json" {
		t.Fatalf("jwks = %d %s", r.status, r.header.Get("Content-Type"))
	}
	if !strings.Contains(string(r.body), `"kid":"`+c.env.AccessTokens.PublicKey().ID+`"`) {
		t.Fatalf("jwks does not contain the signing key id: %s", r.body)
	}
}
