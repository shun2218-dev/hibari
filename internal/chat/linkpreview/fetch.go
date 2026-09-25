package linkpreview

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"mime"
	"net/http"
	"net/url"
	"sync"
	"time"

	// image.DecodeConfig で寸法を読む形式。SVG はスクリプトを含められるので読まない（ADR 0013 / 0065 決定 7）。
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"

	"github.com/shun2218-dev/hibari/internal/platform/safehttp"
)

const (
	// FetchTimeout は 1 つのプレビューの取得の上限。ページを取ってから、画像とアイコンを並行して取る（ADR 0065 決定 8）。
	// 入力欄の API はこれを待つので、長くしない。
	FetchTimeout = 10 * time.Second

	// pageMaxBytes はページの HTML を読む上限。メタデータは <head> にあるので、先頭だけで足りる。
	pageMaxBytes = 1 << 20
	// imageMaxBytes と iconMaxBytes は画像とアイコンの上限（ADR 0065 決定 7・14）。超えたものは使わない。
	imageMaxBytes = 5 << 20
	iconMaxBytes  = 100 << 10
)

// imageTypes はカードの画像として受け付ける形式（ADR 0013 の inline 表示と同じ）。
var imageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

// iconTypes はサイトのアイコンとして受け付ける形式。ICO を足す（ADR 0065 決定 14）。
var iconTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true, "image/x-icon": true}

// Image は取れた画像かアイコン。形式は中身から判定したもので、相手のサーバーの申告ではない。
type Image struct {
	Data        []byte
	ContentType string
	// Width と Height は画像のヘッダーから読んだ寸法。アイコンでは測らない（0）。
	Width, Height int
}

// Preview は 1 つの URL のプレビュー。
type Preview struct {
	Title       string
	Description string
	SiteName    string
	// Image と Icon は取れなければ nil。どちらがなくてもカードは作る。
	Image *Image
	Icon  *Image
}

// FailKind は取れなかった理由の種類。ログに出すのはこれだけにする（URL もホスト名も出さない。ADR 0065 決定 11）。
type FailKind string

const (
	FailTimeout    FailKind = "timeout"
	FailBlocked    FailKind = "blocked_address"
	FailHTTPStatus FailKind = "http_status"
	FailNotHTML    FailKind = "not_html"
	FailNoMetadata FailKind = "no_metadata"
	FailNetwork    FailKind = "network"
)

// FetchError は取れなかったこと。Err はログに出さない（URL を含むことがある）。
type FetchError struct {
	Kind FailKind
	Err  error
}

func (e *FetchError) Error() string { return fmt.Sprintf("linkpreview: %s", e.Kind) }
func (e *FetchError) Unwrap() error { return e.Err }

// Fetcher はページ・画像・アイコンを取りに行く。接続の検査は safehttp に任せる。
type Fetcher struct {
	client *safehttp.Client
}

// NewFetcher は Fetcher を返す。
func NewFetcher(client *safehttp.Client) *Fetcher {
	return &Fetcher{client: client}
}

// Fetch は rawURL（本文に書かれた URL）のプレビューを取る。カードにならなければ *FetchError。
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (Preview, error) {
	ctx, cancel := context.WithTimeout(ctx, FetchTimeout)
	defer cancel()

	posted, err := url.Parse(rawURL)
	if err != nil {
		return Preview{}, &FetchError{Kind: FailBlocked, Err: err}
	}
	page, err := f.client.Get(ctx, rawURL, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", pageMaxBytes)
	if err != nil {
		return Preview{}, classify(err)
	}
	if page.ContentType != "text/html" && page.ContentType != "application/xhtml+xml" {
		return Preview{}, &FetchError{Kind: FailNotHTML}
	}
	contentType := page.ContentType
	if page.Charset != "" {
		contentType = mime.FormatMediaType(page.ContentType, map[string]string{"charset": page.Charset})
	}
	meta := ParseHTML(page.Body, contentType, page.URL)
	if !meta.HasText() {
		return Preview{}, &FetchError{Kind: FailNoMetadata}
	}

	p := Preview{Title: meta.Title, Description: meta.Description, SiteName: meta.SiteName}
	if p.SiteName == "" {
		// 本文に書かれた URL のホスト（リダイレクトの後ではない。読む人が見ている URL と揃える）
		p.SiteName = clean(posted.Hostname(), siteNameMax)
	}

	// 画像とアイコンは取れなくてもカードは作るので、失敗は捨てる
	var wg sync.WaitGroup
	if meta.ImageURL != "" {
		wg.Go(func() { p.Image = f.getImage(ctx, meta.ImageURL, imageMaxBytes, imageTypes, true) })
	}
	wg.Go(func() {
		for _, u := range meta.IconURLs {
			if p.Icon = f.getImage(ctx, u, iconMaxBytes, iconTypes, false); p.Icon != nil {
				return
			}
		}
	})
	wg.Wait()
	return p, nil
}

// getImage は画像を取り、形式（中身で判定する）と大きさを確かめる。使えなければ nil。
func (f *Fetcher) getImage(ctx context.Context, rawURL string, maxBytes int64, types map[string]bool, measure bool) *Image {
	res, err := f.client.Get(ctx, rawURL, "image/*", maxBytes)
	if err != nil || res.Truncated || len(res.Body) == 0 {
		return nil
	}
	// 相手の Content-Type は信じない。SVG を image/png と偽っても、中身で弾く
	ct := http.DetectContentType(res.Body)
	if !types[ct] {
		return nil
	}
	img := &Image{Data: res.Body, ContentType: ct}
	if measure {
		cfg, _, err := image.DecodeConfig(bytes.NewReader(res.Body))
		if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
			return nil
		}
		img.Width, img.Height = cfg.Width, cfg.Height
	}
	return img
}

// classify は safehttp のエラーを、ログに出す種類に分ける。
func classify(err error) *FetchError {
	var se *safehttp.StatusError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return &FetchError{Kind: FailTimeout, Err: err}
	case errors.Is(err, safehttp.ErrBlocked):
		return &FetchError{Kind: FailBlocked, Err: err}
	case errors.As(err, &se):
		return &FetchError{Kind: FailHTTPStatus, Err: err}
	default:
		return &FetchError{Kind: FailNetwork, Err: err}
	}
}
