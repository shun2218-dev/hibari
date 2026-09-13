package httpx

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/netip"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// AuthService は httpx が使う認証のユースケース（auth.Service が実装する）。
type AuthService interface {
	Register(ctx context.Context, in auth.RegisterInput, c auth.Client) (auth.User, auth.Session, error)
	Login(ctx context.Context, email, password string, c auth.Client) (auth.User, auth.Session, error)
	Refresh(ctx context.Context, rawToken string, c auth.Client) (auth.Session, error)
	Logout(ctx context.Context, rawToken string) error
	Me(ctx context.Context, userID ulid.ULID) (auth.User, error)
}

type authHandlers struct {
	svc          AuthService
	logger       *slog.Logger
	jwks         []byte
	cookieSecure bool
}

func registerAuthRoutes(mux *http.ServeMux, d Deps) {
	h := &authHandlers{svc: d.Auth, logger: d.Logger, jwks: d.JWKS, cookieSecure: d.RefreshCookieSecure}
	requireAuth := authn.Require(d.Verifier, writeUnauthorized)

	mux.HandleFunc("POST /api/v1/auth/register", h.register)
	mux.HandleFunc("POST /api/v1/auth/login", h.login)
	mux.HandleFunc("POST /api/v1/auth/refresh", h.refresh)
	mux.HandleFunc("POST /api/v1/auth/logout", h.logout)
	mux.Handle("GET /api/v1/users/me", requireAuth(http.HandlerFunc(h.me)))
	mux.HandleFunc("GET /.well-known/jwks.json", h.jwksJSON)
}

type userResponse struct {
	ID            string    `json:"id"`
	Handle        string    `json:"handle"`
	DisplayName   string    `json:"display_name"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
}

func newUserResponse(u auth.User) *userResponse {
	return &userResponse{
		ID:            u.ID.String(),
		Handle:        u.Handle,
		DisplayName:   u.DisplayName,
		Email:         u.Email,
		EmailVerified: u.EmailVerified,
		CreatedAt:     u.CreatedAt,
	}
}

// tokenResponse はトークンを返すレスポンス。フィールド名は OAuth 2.0 のトークンレスポンス（RFC 6749 §5.1）に寄せる。
type tokenResponse struct {
	User        *userResponse `json:"user,omitempty"`
	AccessToken string        `json:"access_token"`
	TokenType   string        `json:"token_type"`
	ExpiresIn   int           `json:"expires_in"`
	// Refresh Token はボディ方式のときだけ入る。Cookie 方式ではレスポンスのボディに出さない。
	RefreshToken          string     `json:"refresh_token,omitempty"`
	RefreshTokenExpiresAt *time.Time `json:"refresh_token_expires_at,omitempty"`
}

func (h *authHandlers) writeSession(w http.ResponseWriter, r *http.Request, status int, u *auth.User, s auth.Session) {
	resp := tokenResponse{
		AccessToken: s.AccessToken,
		TokenType:   "Bearer",
		ExpiresIn:   int(auth.AccessTokenTTL / time.Second),
	}
	if u != nil {
		resp.User = newUserResponse(*u)
	}
	transportFor(r, h.cookieSecure).write(w, &resp, s)
	writeJSON(w, status, resp)
}

type registerRequest struct {
	Handle      string `json:"handle"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Password    string `json:"password"`
}

func (h *authHandlers) register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	u, s, err := h.svc.Register(r.Context(), auth.RegisterInput{
		Handle:      req.Handle,
		DisplayName: req.DisplayName,
		Email:       req.Email,
		Password:    req.Password,
	}, clientOf(r))
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	h.writeSession(w, r, http.StatusCreated, &u, s)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *authHandlers) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	u, s, err := h.svc.Login(r.Context(), req.Email, req.Password, clientOf(r))
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	h.writeSession(w, r, http.StatusOK, &u, s)
}

func (h *authHandlers) refresh(w http.ResponseWriter, r *http.Request) {
	tr := transportFor(r, h.cookieSecure)
	raw, err := tr.read(w, r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	s, err := h.svc.Refresh(r.Context(), raw, clientOf(r))
	if err != nil {
		// 使えないトークンを Cookie に残しておくと、クライアントが refresh を繰り返し試みるので消させる。
		if errors.Is(err, auth.ErrInvalidRefreshToken) {
			tr.clear(w)
		}
		writeError(h.logger, w, r, err)
		return
	}
	h.writeSession(w, r, http.StatusOK, nil, s)
}

func (h *authHandlers) logout(w http.ResponseWriter, r *http.Request) {
	tr := transportFor(r, h.cookieSecure)
	raw, err := tr.read(w, r)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.Logout(r.Context(), raw); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	tr.clear(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *authHandlers) me(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	u, err := h.svc.Me(r.Context(), id.UserID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newUserResponse(u))
}

// jwksJSON は検証用の公開鍵を返す。鍵のローテーション時に古い鍵をしばらく残す前提で、短めにキャッシュさせる。
func (h *authHandlers) jwksJSON(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Content-Type", "application/jwk-set+json")
	_, _ = w.Write(h.jwks)
}

// clientOf はリクエストから監査用のクライアント情報を取り出す。
//
// IP は接続元のアドレス（RemoteAddr）だけを使い、X-Forwarded-For は信用しない。
// 信頼できるプロキシを経由する構成（Phase 5 の Caddy）になったら、そのときにプロキシのアドレスを設定で受け取って読む。
func clientOf(r *http.Request) auth.Client {
	c := auth.Client{UserAgent: r.UserAgent()}
	if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
		c.IP = ap.Addr()
	}
	return c
}
