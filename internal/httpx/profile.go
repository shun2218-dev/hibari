package httpx

import (
	"net/http"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// 自分のプロフィール（表示名・ハンドル）の更新。

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
