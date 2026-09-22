package httpx

import (
	"net/http"

	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// email の確認とパスワードの再設定（ADR 0053）。どちらもワンタイムトークンで、
// 宛先が存在するかどうかを応答から読み取れないようにする。

type emailVerificationRequest struct {
	// Next は検証したあとに進む先。登録と同じく確認メールのリンクに載る（ADR 0053 決定 3）。
	Next string `json:"next,omitzero"`
}

// requestEmailVerification は確認メールを送り直す。確認済みでも同じ 202 を返す（クライアントは me で状態を見る）。
//
// ボディは省略できる（戻り先がなければ要らない。Phase 6.10.5 より前のクライアントもボディを送らない）。
func (h *authHandlers) requestEmailVerification(w http.ResponseWriter, r *http.Request) {
	id, _ := authn.FromContext(r.Context())
	var req emailVerificationRequest
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeError(h.logger, w, r, err)
			return
		}
	}
	if err := h.svc.RequestEmailVerification(r.Context(), id.UserID, req.Next); err != nil {
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
