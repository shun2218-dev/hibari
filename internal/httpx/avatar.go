package httpx

import (
	"net/http"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// アバターの画像（ADR 0020 / 0028）。中身は Go サーバーを通さず、署名付き URL で直接やり取りする。

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
	writeJSON(w, http.StatusCreated, avatarUploadResponse{
		UploadID: up.UploadID.String(),
		Upload:   uploadResponse{Method: up.Method, URL: up.URL, Headers: up.Header, ExpiresAt: up.ExpiresAt},
	})
}

type avatarUploadResponse struct {
	UploadID string         `json:"upload_id"`
	Upload   uploadResponse `json:"upload"`
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
	var req avatarURLsRequest
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
	out := make(map[string]signedURLResponse, len(urls))
	for userID, a := range urls {
		out[userID.String()] = signedURLResponse{URL: a.URL, ExpiresAt: a.ExpiresAt}
	}
	writeJSON(w, http.StatusOK, avatarURLsResponse{Avatars: out})
}

type avatarURLsRequest struct {
	UserIDs []string `json:"user_ids"`
}

// avatarURLsResponse のキーはユーザー ID。
type avatarURLsResponse struct {
	Avatars map[string]signedURLResponse `json:"avatars"`
}
