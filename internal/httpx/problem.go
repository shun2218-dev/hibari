package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// problemTypePrefix は problem の type に付ける接頭辞。
//
// RFC 9457 の type は URI だが、解決できる URL（ドキュメントのページ）を用意していないので、
// 登録なしで一意な識別子を作れる tag URI（RFC 4151）にする。クライアントは type の値で分岐し、title は表示に使わない。
const problemTypePrefix = "tag:hibari,2026:problem:"

// problemType は Problem Details の type から接頭辞を除いた部分。クライアントはこの値で分岐する。
type problemType string

const (
	problemBadRequest            problemType = "bad-request"
	problemNotFound              problemType = "not-found"
	problemForbidden             problemType = "forbidden"
	problemInviteInvalid         problemType = "invite-invalid"
	problemInviteExpired         problemType = "invite-expired"
	problemInviteExhausted       problemType = "invite-exhausted"
	problemRoomNameTaken         problemType = "room-name-taken"
	problemUserNotInWorkspace    problemType = "user-not-in-workspace"
	problemMessageDeleted        problemType = "message-deleted"
	problemAttachmentNotUploaded problemType = "attachment-not-uploaded"
	problemAttachmentMismatch    problemType = "attachment-mismatch"
	problemOwnerMustTransfer     problemType = "owner-must-transfer"
	problemRateLimited           problemType = "rate-limited"
	problemInvalidOneTimeToken   problemType = "invalid-one-time-token"
	problemInvalidCredentials    problemType = "invalid-credentials"
	problemInvalidRefreshToken   problemType = "invalid-refresh-token"
	problemHandleTaken           problemType = "handle-taken"
	problemEmailTaken            problemType = "email-taken"
	problemAvatarNotUploaded     problemType = "avatar-not-uploaded"
	problemAvatarMismatch        problemType = "avatar-mismatch"
	problemInternal              problemType = "internal"
	problemValidationError       problemType = "validation-error"
	problemUnauthenticated       problemType = "unauthenticated"
	problemWSTicketInvalid       problemType = "ws-ticket-invalid"
)

// problem は RFC 9457 の Problem Details。
type problem struct {
	Type   problemType `json:"type"`
	Title  string      `json:"title"`
	Status int         `json:"status"`
	Detail string      `json:"detail,omitempty"`
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
		verr  *auth.ValidationError
		cverr *chat.ValidationError
		berr  *errBadRequest
		lerr  *auth.RateLimitedError
	)
	switch {
	case errors.As(err, &berr):
		writeProblem(w, r, problem{Type: problemBadRequest, Title: "Bad request", Status: berr.status, Detail: berr.detail})
	case errors.As(err, &verr):
		fields := make([]problemFieldError, len(verr.Fields))
		for i, f := range verr.Fields {
			fields[i] = problemFieldError{Field: f.Field, Reason: f.Reason}
		}
		writeValidationProblem(w, r, fields)
	case errors.As(err, &cverr):
		fields := make([]problemFieldError, len(cverr.Fields))
		for i, f := range cverr.Fields {
			fields[i] = problemFieldError{Field: f.Field, Reason: f.Reason}
		}
		writeValidationProblem(w, r, fields)
	case errors.Is(err, chat.ErrNotFound):
		writeProblem(w, r, problem{Type: problemNotFound, Title: "Not found", Status: http.StatusNotFound})
	case errors.Is(err, chat.ErrForbidden):
		writeProblem(w, r, problem{Type: problemForbidden, Title: "You are not allowed to do this", Status: http.StatusForbidden})
	case errors.Is(err, chat.ErrInviteInvalid):
		writeProblem(w, r, problem{Type: problemInviteInvalid, Title: "The invite link is invalid", Status: http.StatusNotFound})
	case errors.Is(err, chat.ErrInviteExpired):
		writeProblem(w, r, problem{Type: problemInviteExpired, Title: "The invite link has expired", Status: http.StatusGone})
	case errors.Is(err, chat.ErrInviteExhausted):
		writeProblem(w, r, problem{Type: problemInviteExhausted, Title: "The invite link has reached its usage limit", Status: http.StatusGone})
	case errors.Is(err, chat.ErrRoomNameTaken):
		writeProblem(w, r, problem{Type: problemRoomNameTaken, Title: "A room with this name already exists", Status: http.StatusConflict})
	case errors.Is(err, chat.ErrUserNotInWorkspace):
		writeProblem(w, r, problem{Type: problemUserNotInWorkspace, Title: "The user is not a member of the workspace", Status: http.StatusUnprocessableEntity})
	case errors.Is(err, chat.ErrMessageDeleted):
		writeProblem(w, r, problem{Type: problemMessageDeleted, Title: "The message has been deleted", Status: http.StatusConflict})
	case errors.Is(err, chat.ErrAttachmentNotUploaded):
		writeProblem(w, r, problem{Type: problemAttachmentNotUploaded, Title: "The file has not been uploaded", Status: http.StatusConflict})
	case errors.Is(err, chat.ErrAttachmentMismatch):
		writeProblem(w, r, problem{Type: problemAttachmentMismatch, Title: "The uploaded file does not match the declared size or type", Status: http.StatusConflict})
	case errors.Is(err, chat.ErrOwnerMustTransfer):
		writeProblem(w, r, problem{Type: problemOwnerMustTransfer, Title: "Transfer ownership before leaving", Status: http.StatusConflict})
	case errors.As(err, &lerr):
		// Retry-After は秒の整数（RFC 9110 §10.2.3）。0 秒にならないよう切り上げる。
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(lerr.RetryAfter.Seconds())))))
		writeProblem(w, r, problem{Type: problemRateLimited, Title: "Too many requests", Status: http.StatusTooManyRequests})
	case errors.Is(err, auth.ErrInvalidOneTimeToken):
		writeProblem(w, r, problem{Type: problemInvalidOneTimeToken, Title: "The link is invalid or has expired", Status: http.StatusBadRequest})
	case errors.Is(err, auth.ErrInvalidCredentials):
		// email とパスワードのどちらが違うかは言わない。
		writeProblem(w, r, problem{Type: problemInvalidCredentials, Title: "Email or password is incorrect", Status: http.StatusUnauthorized})
	case errors.Is(err, auth.ErrInvalidRefreshToken):
		writeProblem(w, r, problem{Type: problemInvalidRefreshToken, Title: "Refresh token is invalid or expired", Status: http.StatusUnauthorized})
	case errors.Is(err, auth.ErrHandleTaken):
		writeProblem(w, r, problem{Type: problemHandleTaken, Title: "Handle is already taken", Status: http.StatusConflict})
	case errors.Is(err, auth.ErrEmailTaken):
		writeProblem(w, r, problem{Type: problemEmailTaken, Title: "Email is already registered", Status: http.StatusConflict})
	case errors.Is(err, auth.ErrAvatarNotUploaded):
		writeProblem(w, r, problem{Type: problemAvatarNotUploaded, Title: "The avatar has not been uploaded", Status: http.StatusConflict})
	case errors.Is(err, auth.ErrAvatarMismatch):
		writeProblem(w, r, problem{Type: problemAvatarMismatch, Title: "The uploaded avatar does not match the request", Status: http.StatusConflict})
	case errors.Is(err, auth.ErrSessionNotFound):
		// 他人のセッション ID を指定されても、存在しないものと区別しない（ADR 0019）。
		writeProblem(w, r, problem{Type: problemNotFound, Title: "Not found", Status: http.StatusNotFound})
	case errors.Is(err, authn.ErrMissingToken), errors.Is(err, authn.ErrInvalidToken), errors.Is(err, auth.ErrUserNotFound):
		writeUnauthorized(w, r, err)
	default:
		logger.ErrorContext(r.Context(), "request failed",
			slog.String("request_id", RequestID(r.Context())),
			slog.String("method", r.Method),
			slog.String("path", loggedPath(r)),
			slog.Any("error", err))
		writeProblem(w, r, problem{Type: problemInternal, Title: "Internal server error", Status: http.StatusInternalServerError})
	}
}

func writeValidationProblem(w http.ResponseWriter, r *http.Request, fields []problemFieldError) {
	writeProblem(w, r, problem{Type: problemValidationError, Title: "Invalid input", Status: http.StatusUnprocessableEntity, Errors: fields})
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
	writeProblem(w, r, problem{Type: problemUnauthenticated, Title: "Authentication required", Status: http.StatusUnauthorized})
}
