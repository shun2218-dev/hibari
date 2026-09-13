package httpx

import (
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 添付ファイルの API（ロードマップ Phase 3c / ADR 0013）。ルートの登録は registerChatRoutes にまとめている。
//
// レスポンスには署名付き URL が入る。URL そのものが閲覧の権限なので、ログに出さない（CLAUDE.md「ログ」）。

type attachmentResponse struct {
	ID          string    `json:"id"`
	RoomID      string    `json:"room_id"`
	Status      string    `json:"status"`
	FileName    string    `json:"file_name"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	Width       *int      `json:"width"`
	Height      *int      `json:"height"`
	CreatedAt   time.Time `json:"created_at"`
}

func newAttachmentResponse(a chat.Attachment) attachmentResponse {
	return attachmentResponse{
		ID: a.ID.String(), RoomID: a.RoomID.String(), Status: string(a.Status), FileName: a.FileName, ContentType: a.ContentType,
		SizeBytes: a.SizeBytes, Width: a.Width, Height: a.Height, CreatedAt: a.CreatedAt,
	}
}

type messageAttachmentResponse struct {
	ID          string `json:"id"`
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	Width       *int   `json:"width"`
	Height      *int   `json:"height"`
}

func newMessageAttachmentsResponse(as []chat.MessageAttachment) []messageAttachmentResponse {
	resp := make([]messageAttachmentResponse, len(as))
	for i, a := range as {
		resp[i] = messageAttachmentResponse{ID: a.ID.String(), FileName: a.FileName, ContentType: a.ContentType, SizeBytes: a.SizeBytes, Width: a.Width, Height: a.Height}
	}
	return resp
}

type createAttachmentRequest struct {
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type"`
	SizeBytes   *int64 `json:"size_bytes"`
	Width       *int   `json:"width"`
	Height      *int   `json:"height"`
}

type uploadResponse struct {
	Method string `json:"method"`
	URL    string `json:"url"`
	// Headers はクライアントが PUT に付けなければならないヘッダー。値が違うと署名が合わずにストレージが拒否する。
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expires_at"`
}

// createAttachment は pending の添付を作り、ストレージに直接 PUT するための署名付き URL を返す。
func (h *chatHandlers) createAttachment(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req createAttachmentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	created, err := h.svc.CreateAttachment(r.Context(), actorOf(r), roomID, chat.AttachmentInput{
		FileName: req.FileName, ContentType: req.ContentType, SizeBytes: req.SizeBytes, Width: req.Width, Height: req.Height,
	})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	u := created.Upload
	writeJSON(w, http.StatusCreated, struct {
		Attachment attachmentResponse `json:"attachment"`
		Upload     uploadResponse     `json:"upload"`
	}{
		Attachment: newAttachmentResponse(created.Attachment),
		Upload:     uploadResponse{Method: u.Method, URL: u.URL, Headers: u.Header, ExpiresAt: u.ExpiresAt},
	})
}

// completeAttachment は PUT が済んだことを HEAD で確かめて、添付をメッセージに付けられる状態にする。冪等。
func (h *chatHandlers) completeAttachment(w http.ResponseWriter, r *http.Request) {
	attachmentID, err := pathID(r, "attachmentID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	att, err := h.svc.CompleteAttachment(r.Context(), actorOf(r), attachmentID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newAttachmentResponse(att))
}

// getAttachmentURL はメッセージに付いた添付の署名付き GET URL を返す。
func (h *chatHandlers) getAttachmentURL(w http.ResponseWriter, r *http.Request) {
	attachmentID, err := pathID(r, "attachmentID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	dl, err := h.svc.GetAttachmentURL(r.Context(), actorOf(r), attachmentID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		URL       string    `json:"url"`
		ExpiresAt time.Time `json:"expires_at"`
	}{URL: dl.URL, ExpiresAt: dl.ExpiresAt})
}
