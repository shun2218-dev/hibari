package httpx

import (
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 外部のリンクのプレビュー（ADR 0065）。

// linkPreviewResponse はメッセージに付いたプレビュー（決定 6）。見せるもの（取れていて、本人が消していない）だけが並ぶ。
// 画像とアイコンの URL は入れない。表示するときに GET …/link-previews/{id}/urls で取る（添付と同じ。ADR 0013）。
type linkPreviewResponse struct {
	ID string `json:"id"`
	// URL は本文に書かれた URL。タイトルのリンク先（リダイレクトの後の URL ではない）。
	URL         string `json:"url"`
	SiteName    string `json:"site_name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Image は画像の寸法。読み込む前に枠を確保するのに使う。画像がなければ null。
	Image   *linkPreviewImageResponse `json:"image"`
	HasIcon bool                      `json:"has_icon"`
}

type linkPreviewImageResponse struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

func newLinkPreviewsResponse(ps []chat.MessageLinkPreview) []linkPreviewResponse {
	out := make([]linkPreviewResponse, len(ps))
	for i, p := range ps {
		out[i] = linkPreviewResponse{ID: p.ID.String(), URL: p.URL, SiteName: p.SiteName, Title: p.Title, Description: p.Description, HasIcon: p.HasIcon}
		if p.Image != nil {
			out[i].Image = &linkPreviewImageResponse{Width: p.Image.Width, Height: p.Image.Height}
		}
	}
	return out
}

type previewLinkRequest struct {
	URL string `json:"url"`
}

// composerLinkPreviewResponse は入力欄のプレビュー（決定 13）。まだメッセージに付いていないので、署名付き URL を直接入れる。
type composerLinkPreviewResponse struct {
	URL         string                            `json:"url"`
	SiteName    string                            `json:"site_name"`
	Title       string                            `json:"title"`
	Description string                            `json:"description"`
	Image       *composerLinkPreviewImageResponse `json:"image"`
	Icon        *signedURLResponse                `json:"icon"`
}

type composerLinkPreviewImageResponse struct {
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

type previewLinkResponse struct {
	// Preview はカードにならなければ null。理由（内部のアドレス・タイムアウト・OGP がない）は区別しない（決定 13）。
	Preview *composerLinkPreviewResponse `json:"preview"`
}

// previewLink は入力欄のプレビューを取る（決定 13）。その場で取りに行くので、最大で 10 秒ほど待つ。
func (h *chatHandlers) previewLink(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req previewLinkRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	p, err := h.svc.PreviewLink(r.Context(), actorOf(r), roomID, req.URL)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := previewLinkResponse{}
	if p != nil {
		c := &composerLinkPreviewResponse{URL: p.URL, SiteName: p.SiteName, Title: p.Title, Description: p.Description}
		if p.Image != nil {
			c.Image = &composerLinkPreviewImageResponse{
				Width: p.Image.Width, Height: p.Image.Height, URL: p.Image.URL, ExpiresAt: p.Image.ExpiresAt,
			}
		}
		if p.Icon != nil {
			c.Icon = &signedURLResponse{URL: p.Icon.URL, ExpiresAt: p.Icon.ExpiresAt}
		}
		resp.Preview = c
	}
	writeJSON(w, http.StatusOK, resp)
}

// linkPreviewURLsResponse は、メッセージに付いたプレビューの画像とアイコンの署名付き URL（決定 7）。ないものは null。
type linkPreviewURLsResponse struct {
	Image *signedURLResponse `json:"image"`
	Icon  *signedURLResponse `json:"icon"`
}

// getLinkPreviewURLs は画像とアイコンの署名付き URL を返す。読めるルームのものだけ（決定 7）。
func (h *chatHandlers) getLinkPreviewURLs(w http.ResponseWriter, r *http.Request) {
	roomID, messageID, previewID, ok := h.linkPreviewPath(w, r)
	if !ok {
		return
	}
	image, icon, err := h.svc.LinkPreviewURLs(r.Context(), actorOf(r), roomID, messageID, previewID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := linkPreviewURLsResponse{}
	if image != nil {
		resp.Image = &signedURLResponse{URL: image.URL, ExpiresAt: image.ExpiresAt}
	}
	if icon != nil {
		resp.Icon = &signedURLResponse{URL: icon.URL, ExpiresAt: icon.ExpiresAt}
	}
	writeJSON(w, http.StatusOK, resp)
}

// removeLinkPreview は投稿した本人がプレビューを消す（決定 5）。消してあっても 204（冪等）。
// ほかの人の画面には message.updated で届く。
func (h *chatHandlers) removeLinkPreview(w http.ResponseWriter, r *http.Request) {
	roomID, messageID, previewID, ok := h.linkPreviewPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.RemoveLinkPreview(r.Context(), actorOf(r), roomID, messageID, previewID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *chatHandlers) linkPreviewPath(w http.ResponseWriter, r *http.Request) (roomID, messageID, previewID ulid.ULID, ok bool) {
	for _, p := range []struct {
		name string
		dst  *ulid.ULID
	}{{"roomID", &roomID}, {"messageID", &messageID}, {"previewID", &previewID}} {
		id, err := pathID(r, p.name)
		if err != nil {
			writeError(h.logger, w, r, err)
			return roomID, messageID, previewID, false
		}
		*p.dst = id
	}
	return roomID, messageID, previewID, true
}
