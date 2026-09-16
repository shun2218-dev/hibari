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
	RequestEmailVerification(ctx context.Context, userID ulid.ULID) error
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

// requestEmailVerification は確認メールを送り直す。確認済みでも同じ 202 を返す（クライアントは me で状態を見る）。
func (h *authHandlers) requestEmailVerification(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	if err := h.svc.RequestEmailVerification(r.Context(), id.UserID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

type oneTimeTokenRequest struct {
	Token string `json:"token"`
}

func (h *authHandlers) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var req oneTimeTokenRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.VerifyEmail(r.Context(), req.Token); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type passwordResetRequest struct {
	Email string `json:"email"`
}

// requestPasswordReset はアカウントの有無に関係なく 202 を返す。
func (h *authHandlers) requestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req passwordResetRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.RequestPasswordReset(r.Context(), req.Email, clientOf(r)); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

type passwordResetConfirmRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

// resetPassword はパスワードを変える。全セッションが失効するので、クライアントはログインし直す。
func (h *authHandlers) resetPassword(w http.ResponseWriter, r *http.Request) {
	var req passwordResetConfirmRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.ResetPassword(r.Context(), req.Token, req.Password); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

// updateProfileRequest は表示名とハンドルの部分更新（ADR 0019）。
// 省略した項目（JSON にないか null）は変えない。
type updateProfileRequest struct {
	DisplayName *string `json:"display_name"`
	Handle      *string `json:"handle"`
}

func (h *authHandlers) updateProfile(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	var req updateProfileRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	u, err := h.svc.UpdateProfile(r.Context(), id.UserID, auth.ProfileInput{DisplayName: req.DisplayName, Handle: req.Handle})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newUserResponse(u))
}

// sessionResponse は設定画面の「ログイン中のデバイス」の 1 行。
// user_agent は保存したまま返し、「Chrome · macOS」のような表示はクライアントが作る（ADR 0019）。IP は返さない。
type sessionResponse struct {
	ID         string    `json:"id"`
	UserAgent  string    `json:"user_agent"`
	Current    bool      `json:"current"`
	StartedAt  time.Time `json:"started_at"`
	LastUsedAt time.Time `json:"last_used_at"`
}

func (h *authHandlers) listSessions(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	sessions, err := h.svc.Sessions(r.Context(), id.UserID, id.SessionID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	out := make([]sessionResponse, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, sessionResponse{
			ID:         s.ID.String(),
			UserAgent:  s.UserAgent,
			Current:    s.Current,
			StartedAt:  s.StartedAt,
			LastUsedAt: s.LastUsedAt,
		})
	}
	writeJSON(w, http.StatusOK, struct {
		Sessions []sessionResponse `json:"sessions"`
	}{Sessions: out})
}

func (h *authHandlers) revokeSession(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	// 読めない ID は、存在しないセッションと同じく 404 にする（他人のセッションの存在を明かさない）。
	sessionID, err := ulid.ParseStrict(r.PathValue("sessionID"))
	if err != nil {
		writeError(h.logger, w, r, auth.ErrSessionNotFound)
		return
	}
	if err := h.svc.RevokeSession(r.Context(), id.UserID, sessionID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// revokeOtherSessions は、いま使っているセッション以外をすべて失効させる（「他のすべてのデバイスからログアウト」）。
func (h *authHandlers) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	revoked, err := h.svc.RevokeOtherSessions(r.Context(), id.UserID, id.SessionID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		RevokedCount int `json:"revoked_count"`
	}{RevokedCount: revoked})
}

// avatarUploadRequest はアバター画像の申告（ADR 0020）。署名に含めるので、実際の PUT と一致していなければ拒否される。
type avatarUploadRequest struct {
	ContentType string `json:"content_type"`
	SizeBytes   *int64 `json:"size_bytes"`
}

func (h *authHandlers) createAvatarUpload(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	var req avatarUploadRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	up, err := h.svc.CreateAvatarUpload(r.Context(), id.UserID, auth.AvatarUploadInput{ContentType: req.ContentType, SizeBytes: req.SizeBytes})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, struct {
		UploadID string         `json:"upload_id"`
		Upload   uploadResponse `json:"upload"`
	}{
		UploadID: up.UploadID.String(),
		Upload:   uploadResponse{Method: up.Method, URL: up.URL, Headers: up.Header, ExpiresAt: up.ExpiresAt},
	})
}

// completeAvatarUploadRequest は、発行した upload_id と、PUT したものの申告。
type completeAvatarUploadRequest struct {
	UploadID    string `json:"upload_id"`
	ContentType string `json:"content_type"`
	SizeBytes   *int64 `json:"size_bytes"`
}

func (h *authHandlers) completeAvatarUpload(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	var req completeAvatarUploadRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	uploadID, err := ulid.ParseStrict(req.UploadID)
	if err != nil {
		// 発行していない ID は、置かれていないのと同じ扱いにする。
		writeError(h.logger, w, r, auth.ErrAvatarNotUploaded)
		return
	}
	u, err := h.svc.CompleteAvatarUpload(r.Context(), id.UserID, uploadID,
		auth.AvatarUploadInput{ContentType: req.ContentType, SizeBytes: req.SizeBytes})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newUserResponse(u))
}

func (h *authHandlers) deleteAvatar(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	u, err := h.svc.DeleteAvatar(r.Context(), id.UserID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newUserResponse(u))
}

// avatarURLs は、画面に出すユーザーのアバターの URL をまとめて返す（ADR 0020）。
// 画像を持たないユーザーは結果に入らない（クライアントは頭文字のアバターを出す）。
func (h *authHandlers) avatarURLs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserIDs []string `json:"user_ids"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	ids := make([]ulid.ULID, 0, len(req.UserIDs))
	for _, s := range req.UserIDs {
		id, err := ulid.ParseStrict(s)
		if err != nil {
			// 読めない ID は「その人の画像はない」として黙って落とす。ID の形の違いを画面の分岐にしない。
			continue
		}
		ids = append(ids, id)
	}
	urls, err := h.svc.AvatarURLs(r.Context(), ids)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	out := make(map[string]avatarURLResponse, len(urls))
	for userID, a := range urls {
		out[userID.String()] = avatarURLResponse{URL: a.URL, ExpiresAt: a.ExpiresAt}
	}
	writeJSON(w, http.StatusOK, struct {
		Avatars map[string]avatarURLResponse `json:"avatars"`
	}{Avatars: out})
}

type avatarURLResponse struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}
