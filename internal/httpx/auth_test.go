package httpx_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/shun2218-dev/hibari/internal/auth/authtest"
	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
	"github.com/shun2218-dev/hibari/internal/chat/presence"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/httpx"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/ratelimit"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// 実物の Postgres に対してルーター全体を組み立て、HTTP の入出力を確かめる統合テスト。
type apiClient struct {
	t        *testing.T
	env      *authtest.Env
	srv      *httptest.Server
	hub      *realtime.Hub
	broker   *realtime.Broker
	presence *presence.Store
	redis    *goredis.Client
	// instanceID はこのサーバー（インスタンス）の ID。presence のフィールドの名前になる。
	instanceID ulid.ULID
}

// testWSConfig は WebSocket の設定。ping を待つテスト以外で ping が割り込まないよう、間隔は既定のまま長くする。
func testWSConfig() httpx.WSConfig {
	return httpx.DefaultWSConfig(nil)
}

type apiOptions struct {
	auth    []authtest.Option
	ws      httpx.WSConfig
	trusted httpx.TrustedProxies
}

// apiOption は newAPI の組み立てを変える。
type apiOption func(*apiOptions)

func withAuthOptions(opts ...authtest.Option) apiOption {
	return func(o *apiOptions) { o.auth = append(o.auth, opts...) }
}

func withWSConfig(cfg httpx.WSConfig) apiOption {
	return func(o *apiOptions) { o.ws = cfg }
}

// withTrustedProxies は X-Forwarded-For を信用するプロキシを設定する。
func withTrustedProxies(prefixes ...string) apiOption {
	return func(o *apiOptions) {
		for _, p := range prefixes {
			o.trusted = append(o.trusted, netip.MustParsePrefix(p))
		}
	}
}

func newAPI(t *testing.T, opts ...apiOption) *apiClient {
	t.Helper()
	o := apiOptions{ws: testWSConfig()}
	for _, opt := range opts {
		opt(&o)
	}
	env := authtest.New(t, o.auth...)
	return startInstance(t, env, o)
}

// newInstance は、同じ DB・Redis・鍵を使う 2 台目のサーバー（インスタンス）を立てる。
// インスタンスの間の配信は Redis Pub/Sub だけを通る（ADR 0016）。
func (c *apiClient) newInstance(opts ...apiOption) *apiClient {
	c.t.Helper()
	o := apiOptions{ws: testWSConfig()}
	for _, opt := range opts {
		opt(&o)
	}
	return startInstance(c.t, c.env, o)
}

// startInstance は 1 台分のサーバー（Hub・Broker・presence・ルーター）を組み立てて起動する。
func startInstance(t *testing.T, env *authtest.Env, o apiOptions) *apiClient {
	t.Helper()
	jwks, err := env.AccessTokens.JWKS()
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.DiscardHandler)
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })

	instanceID := env.IDs.New()
	broker, err := realtime.NewBroker(t.Context(), rdb, instanceID, logger)
	if err != nil {
		t.Fatal(err)
	}
	delivery := realtime.NewRedisDelivery(rdb, env.IDs, logger)
	presenceStore := presence.New(rdb, instanceID)
	hub := realtime.NewHub(realtime.Deps{
		Authorizer: chat.NewSubscriptionAuthorizer(env.Pool),
		Presence:   presenceStore,
		Sessions:   env.Service,
		Publisher:  delivery,
		Subscriber: broker,
		Logger:     logger,
	})
	brokerCtx, stopBroker := context.WithCancel(context.Background())
	brokerDone := make(chan struct{})
	go func() {
		defer close(brokerDone)
		broker.Run(brokerCtx, hub)
	}()

	h := httpx.NewRouter(httpx.Deps{
		Logger:              logger,
		Clock:               env.Clock,
		IDs:                 id.NewGenerator(env.Clock, rand.Reader),
		TrustedProxies:      o.trusted,
		Auth:                env.Service,
		Verifier:            env.Verifier,
		JWKS:                jwks,
		RefreshCookieSecure: true,
		// auth と同じ DB・時計で組み立てる。chat の統合テストは、auth で登録したユーザーを使う。
		Chat: chat.NewService(chat.Deps{
			DB: env.Pool, Clock: env.Clock, IDs: env.IDs, Random: rand.Reader, Logger: logger,
			Storage: chattest.NewStorage(t), AttachmentLimits: chattest.AttachmentLimits,
			Delivery: delivery, Presence: presenceStore,
		}),
		Realtime:  hub,
		WSTickets: authn.NewWSTickets(rdb, rand.Reader),
		Sessions:  env.Service,
		WS:        o.ws,
	})
	srv := httptest.NewServer(h)
	t.Cleanup(func() {
		// httptest.Server.Close はアップグレード済みの接続を待たないので、先に Hub に閉じさせて登録が外れるのを待つ。
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := hub.Shutdown(ctx); err != nil {
			t.Errorf("hub shutdown: %v", err)
		}
		srv.Close()
		stopBroker()
		<-brokerDone
	})
	return &apiClient{t: t, env: env, srv: srv, hub: hub, broker: broker, presence: presenceStore, redis: rdb, instanceID: instanceID}
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

func TestEmailVerificationEndpoints(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg})
	token := decode[tokenBody](t, r).AccessToken

	// 再送には Access Token が要る。
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/verify-email/request"})
	expectProblem(t, r, http.StatusUnauthorized, "unauthenticated")

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/verify-email/request", headers: bearer(token)})
	if r.status != http.StatusAccepted {
		t.Fatalf("request = %d %s", r.status, r.body)
	}
	link := c.env.Mailer.Last(t, reg["email"]).Token()

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/verify-email/confirm", body: map[string]string{"token": link}})
	if r.status != http.StatusNoContent {
		t.Fatalf("confirm = %d %s", r.status, r.body)
	}
	r = c.do(request{method: http.MethodGet, path: "/api/v1/users/me", headers: bearer(token)})
	if !strings.Contains(string(r.body), `"email_verified":true`) {
		t.Fatalf("me after verify = %s", r.body)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/verify-email/confirm", body: map[string]string{"token": link}})
	expectProblem(t, r, http.StatusBadRequest, "invalid-one-time-token")
}

func TestPasswordResetEndpoints(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg})
	session := decode[tokenBody](t, r)

	// アカウントの有無に関係なく同じ 202。
	for _, email := range []string{"nobody-" + reg["email"], reg["email"]} {
		r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/password-reset/request", body: map[string]string{"email": email}})
		if r.status != http.StatusAccepted || len(r.body) != 0 {
			t.Fatalf("request(%s) = %d %s", email, r.status, r.body)
		}
	}
	link := c.env.Mailer.Last(t, reg["email"])
	if link.Kind != "password_reset" {
		t.Fatalf("last mail = %+v", link)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/password-reset/confirm", body: map[string]string{"token": link.Token(), "password": "short"}})
	p := expectProblem(t, r, http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "password" || p.Errors[0].Reason != "too_short" {
		t.Fatalf("errors = %+v", p.Errors)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/password-reset/confirm", body: map[string]string{"token": link.Token(), "password": "a brand new passphrase"}})
	if r.status != http.StatusNoContent {
		t.Fatalf("confirm = %d %s", r.status, r.body)
	}

	// 既存のセッションは失効し、新しいパスワードでログインし直す。
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/refresh", body: map[string]string{"refresh_token": *session.RefreshToken}})
	expectProblem(t, r, http.StatusUnauthorized, "invalid-refresh-token")
	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/login", body: map[string]string{"email": reg["email"], "password": "a brand new passphrase"}})
	if r.status != http.StatusOK {
		t.Fatalf("login with new password = %d %s", r.status, r.body)
	}

	r = c.do(request{method: http.MethodPost, path: "/api/v1/auth/password-reset/confirm", body: map[string]string{"token": link.Token(), "password": "another passphrase"}})
	expectProblem(t, r, http.StatusBadRequest, "invalid-one-time-token")
}

func TestLoginRateLimitedResponse(t *testing.T) {
	limits := authtest.GenerousRateLimits
	limits.LoginPerAccount = ratelimit.Rule{Name: authtest.RuleName("login-account"), Limit: 1, Window: 15 * time.Minute}
	c := newAPI(t, withAuthOptions(authtest.WithRateLimits(limits)))
	reg := registerBody(c)
	c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg})

	login := request{method: http.MethodPost, path: "/api/v1/auth/login", body: map[string]string{"email": reg["email"], "password": "wrong password"}}
	expectProblem(t, c.do(login), http.StatusUnauthorized, "invalid-credentials")
	r := c.do(login)
	expectProblem(t, r, http.StatusTooManyRequests, "rate-limited")
	// Clock は 12:00 ちょうどなので、ウィンドウの終わりまで 900 秒。
	if got := r.header.Get("Retry-After"); got != "900" {
		t.Fatalf("Retry-After = %q, want 900", got)
	}
}

// クライアント IP（ADR 0017）は、レート制限と refresh_tokens.ip の両方で同じ値になる。
func TestClientIPForRateLimitAndRefreshToken(t *testing.T) {
	limits := authtest.GenerousRateLimits
	limits.RegisterPerIP = ratelimit.Rule{Name: authtest.RuleName("register-ip"), Limit: 1, Window: time.Hour}
	register := func(c *apiClient, xff string) response {
		return c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: registerBody(c), headers: map[string]string{"X-Forwarded-For": xff}})
	}

	t.Run("信頼するプロキシ経由なら XFF のクライアントごとに数え、その IP を保存する", func(t *testing.T) {
		// httptest のサーバーへの接続元はループバックなので、それを前段のプロキシとして信頼する。
		c := newAPI(t, withAuthOptions(authtest.WithRateLimits(limits)), withTrustedProxies("127.0.0.0/8", "::1/128"))
		r := register(c, "198.51.100.1")
		if r.status != http.StatusCreated {
			t.Fatalf("register = %d %s", r.status, r.body)
		}
		expectProblem(t, register(c, "198.51.100.1"), http.StatusTooManyRequests, "rate-limited")
		if r := register(c, "198.51.100.2"); r.status != http.StatusCreated {
			t.Fatalf("register from another client = %d %s", r.status, r.body)
		}

		var ip string
		userID := decode[tokenBody](t, r).User.ID
		err := c.env.Pool.QueryRow(t.Context(), "SELECT host(ip) FROM refresh_tokens WHERE user_id = $1", ulid.MustParse(userID)).Scan(&ip)
		if err != nil {
			t.Fatal(err)
		}
		if ip != "198.51.100.1" {
			t.Fatalf("refresh_tokens.ip = %q, want 198.51.100.1", ip)
		}
	})

	t.Run("TRUSTED_PROXIES が空なら XFF を変えても制限を逃れられない", func(t *testing.T) {
		c := newAPI(t, withAuthOptions(authtest.WithRateLimits(limits)))
		if r := register(c, "198.51.100.1"); r.status != http.StatusCreated {
			t.Fatalf("register = %d %s", r.status, r.body)
		}
		expectProblem(t, register(c, "198.51.100.2"), http.StatusTooManyRequests, "rate-limited")
	})
}
