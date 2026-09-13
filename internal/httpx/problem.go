package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// problemTypePrefix は problem の type に付ける接頭辞。
//
// RFC 9457 の type は URI だが、解決できる URL（ドキュメントのページ）を用意していないので、
// 登録なしで一意な識別子を作れる tag URI（RFC 4151）にする。クライアントは type の値で分岐し、title は表示に使わない。
const problemTypePrefix = "tag:hibari,2026:problem:"

// problem は RFC 9457 の Problem Details。
type problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
	// RequestID は問い合わせのときにログと突き合わせるための拡張メンバー。
	RequestID string `json:"request_id,omitempty"`
	// Errors は入力の検証エラーの拡張メンバー。
	Errors []problemFieldError `json:"errors,omitempty"`
}

type problemFieldError struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}

func writeProblem(w http.ResponseWriter, r *http.Request, p problem) {
	p.Type = problemTypePrefix + p.Type
	p.RequestID = RequestID(r.Context())
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}

// errBadRequest はリクエストの形式が壊れていることを表す（JSON として読めない、Content-Type が違うなど）。
type errBadRequest struct {
	status int
	detail string
}

func (e *errBadRequest) Error() string { return e.detail }

// writeError はエラーを HTTP のレスポンスに変換する。ドメインエラーとステータスの対応はここにだけ書く。
//
// 想定外のエラーは 500 にして詳細をログにだけ残す（内部の構造をクライアントに見せない）。
func writeError(logger *slog.Logger, w http.ResponseWriter, r *http.Request, err error) {
	var (
		verr *auth.ValidationError
		berr *errBadRequest
	)
	switch {
	case errors.As(err, &berr):
		writeProblem(w, r, problem{Type: "bad-request", Title: "Bad request", Status: berr.status, Detail: berr.detail})
	case errors.As(err, &verr):
		fields := make([]problemFieldError, len(verr.Fields))
		for i, f := range verr.Fields {
			fields[i] = problemFieldError{Field: f.Field, Reason: f.Reason}
		}
		writeProblem(w, r, problem{Type: "validation-error", Title: "Invalid input", Status: http.StatusUnprocessableEntity, Errors: fields})
	case errors.Is(err, auth.ErrInvalidCredentials):
		// email とパスワードのどちらが違うかは言わない。
		writeProblem(w, r, problem{Type: "invalid-credentials", Title: "Email or password is incorrect", Status: http.StatusUnauthorized})
	case errors.Is(err, auth.ErrInvalidRefreshToken):
		writeProblem(w, r, problem{Type: "invalid-refresh-token", Title: "Refresh token is invalid or expired", Status: http.StatusUnauthorized})
	case errors.Is(err, auth.ErrHandleTaken):
		writeProblem(w, r, problem{Type: "handle-taken", Title: "Handle is already taken", Status: http.StatusConflict})
	case errors.Is(err, auth.ErrEmailTaken):
		writeProblem(w, r, problem{Type: "email-taken", Title: "Email is already registered", Status: http.StatusConflict})
	case errors.Is(err, authn.ErrMissingToken), errors.Is(err, authn.ErrInvalidToken), errors.Is(err, auth.ErrUserNotFound):
		writeUnauthorized(w, r, err)
	default:
		logger.ErrorContext(r.Context(), "request failed",
			slog.String("request_id", RequestID(r.Context())),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Any("error", err))
		writeProblem(w, r, problem{Type: "internal", Title: "Internal server error", Status: http.StatusInternalServerError})
	}
}

// writeUnauthorized は Access Token による認証の失敗を返す（authn.Require の UnauthorizedFunc）。
//
// トークンがない場合とトークンが不正な場合で WWW-Authenticate の error を分ける（RFC 6750 §3.1）。
// クライアントは invalid_token を見て refresh を試みる。ユーザーが退会済みの場合も不正なトークンとして扱う。
func writeUnauthorized(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, authn.ErrMissingToken) {
		w.Header().Set("WWW-Authenticate", `Bearer`)
	} else {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
	}
	writeProblem(w, r, problem{Type: "unauthenticated", Title: "Authentication required", Status: http.StatusUnauthorized})
}
