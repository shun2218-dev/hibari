package httpx

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
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
	UpdateProfile(ctx context.Context, userID ulid.ULID, in auth.ProfileInput) (auth.User, error)
	CreateAvatarUpload(ctx context.Context, userID ulid.ULID, in auth.AvatarUploadInput) (auth.AvatarUpload, error)
	CompleteAvatarUpload(ctx context.Context, userID, uploadID ulid.ULID, in auth.AvatarUploadInput) (auth.User, error)
	DeleteAvatar(ctx context.Context, userID ulid.ULID) (auth.User, error)
	AvatarURLs(ctx context.Context, userIDs []ulid.ULID) (map[ulid.ULID]auth.AvatarURL, error)
	Sessions(ctx context.Context, userID, currentSessionID ulid.ULID) ([]auth.SessionInfo, error)
	RevokeSession(ctx context.Context, userID, sessionID ulid.ULID) error
	RevokeOtherSessions(ctx context.Context, userID, keepSessionID ulid.ULID) (int, error)
	RequestEmailVerification(ctx context.Context, userID ulid.ULID, next string) error
	VerifyEmail(ctx context.Context, rawToken string) error
	RequestPasswordReset(ctx context.Context, email string, c auth.Client) error
	ResetPassword(ctx context.Context, rawToken, newPassword string) error
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
	mux.Handle("POST /api/v1/auth/verify-email/request", requireAuth(http.HandlerFunc(h.requestEmailVerification)))
	mux.HandleFunc("POST /api/v1/auth/verify-email/confirm", h.verifyEmail)
	mux.HandleFunc("POST /api/v1/auth/password-reset/request", h.requestPasswordReset)
	mux.HandleFunc("POST /api/v1/auth/password-reset/confirm", h.resetPassword)
	mux.Handle("GET /api/v1/users/me", requireAuth(http.HandlerFunc(h.me)))
	mux.Handle("PATCH /api/v1/users/me", requireAuth(http.HandlerFunc(h.updateProfile)))
	mux.Handle("POST /api/v1/users/me/avatar", requireAuth(http.HandlerFunc(h.createAvatarUpload)))
	mux.Handle("POST /api/v1/users/me/avatar/complete", requireAuth(http.HandlerFunc(h.completeAvatarUpload)))
	mux.Handle("DELETE /api/v1/users/me/avatar", requireAuth(http.HandlerFunc(h.deleteAvatar)))
	mux.Handle("POST /api/v1/users/avatars", requireAuth(http.HandlerFunc(h.avatarURLs)))
	mux.Handle("GET /api/v1/auth/sessions", requireAuth(http.HandlerFunc(h.listSessions)))
	mux.Handle("DELETE /api/v1/auth/sessions", requireAuth(http.HandlerFunc(h.revokeOtherSessions)))
	mux.Handle("DELETE /api/v1/auth/sessions/{sessionID}", requireAuth(http.HandlerFunc(h.revokeSession)))
	mux.HandleFunc("GET /.well-known/jwks.json", h.jwksJSON)
}

type userResponse struct {
	ID            string `json:"id"`
	Handle        string `json:"handle"`
	DisplayName   string `json:"display_name"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	// AvatarURL は署名付きの GET URL。画像がなければ入らない（ADR 0020）。
	AvatarURL string    `json:"avatar_url,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func newUserResponse(u auth.User) *userResponse {
	return &userResponse{
		ID:            u.ID.String(),
		Handle:        u.Handle,
		DisplayName:   u.DisplayName,
		Email:         u.Email,
		EmailVerified: u.EmailVerified,
		AvatarURL:     u.AvatarURL,
		CreatedAt:     u.CreatedAt,
	}
}

// tokenResponse はトークンを返すレスポンス。フィールド名は OAuth 2.0 のトークンレスポンス（RFC 6749 §5.1）に寄せる。
type tokenResponse struct {
	User        *userResponse `json:"user,omitzero"`
	AccessToken string        `json:"access_token"`
	TokenType   string        `json:"token_type"`
	ExpiresIn   int           `json:"expires_in"`
	// Refresh Token はボディ方式のときだけ入る。Cookie 方式ではレスポンスのボディに出さない。
	RefreshToken          string     `json:"refresh_token,omitempty"`
	RefreshTokenExpiresAt *time.Time `json:"refresh_token_expires_at,omitzero"`
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
	// Next は email を検証したあとに進む先（招待の画面など）。確認メールのリンクに載る（ADR 0053 決定 3）。
	Next string `json:"next,omitzero"`
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
		Next:        req.Next,
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
// IP は withClientIP が求めた値だけを使う（ADR 0017）。ここで RemoteAddr や X-Forwarded-For を読まない。
func clientOf(r *http.Request) auth.Client {
	return auth.Client{UserAgent: r.UserAgent(), IP: clientIPFrom(r.Context())}
}
