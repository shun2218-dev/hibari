package chattest

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"net/url"
	"strings"
	"sync"

	"github.com/shun2218-dev/hibari/internal/chat/linkpreview"
)

// AppBaseURL はテストの Web クライアントの URL。同じオリジンの URL はプレビューを展開しない（ADR 0065 決定 3）。
var AppBaseURL = &url.URL{Scheme: "http", Host: "app.hibari.test"}

// PreviewImageWidth と PreviewImageHeight は Fetcher が返す画像の寸法。
const (
	PreviewImageWidth  = 120
	PreviewImageHeight = 63
)

// Fetcher は、URL だけで結果が決まる LinkPreviewFetcher。ネットワークに出ない。
//
// テスト用 DB はパッケージをまたいで共有するので、どのテストが取っても同じ結果になるように、結果を URL から決める。
//
//	https://<何でも>.ok.test/<path>          → タイトル「<path> のタイトル」、説明あり、サイト名「OK Test」
//	  ?image=1 を付けると画像（PNG、120×63）、?icon=1 を付けるとアイコン（PNG）も返す
//	それ以外                                  → カードにならない（no_metadata）
type Fetcher struct {
	mu    sync.Mutex
	calls map[string]int
}

// Fetch は linkpreview.Fetcher と同じ形で結果を返す。
func (f *Fetcher) Fetch(_ context.Context, rawURL string) (linkpreview.Preview, error) {
	f.mu.Lock()
	if f.calls == nil {
		f.calls = map[string]int{}
	}
	f.calls[rawURL]++
	f.mu.Unlock()

	u, err := url.Parse(rawURL)
	if err != nil || !strings.HasSuffix(u.Hostname(), ".ok.test") {
		return linkpreview.Preview{}, &linkpreview.FetchError{Kind: linkpreview.FailNoMetadata}
	}
	p := linkpreview.Preview{Title: u.Path + " のタイトル", Description: u.Path + " の説明", SiteName: "OK Test"}
	if u.Query().Get("image") == "1" {
		p.Image = &linkpreview.Image{Data: pngBytes(PreviewImageWidth, PreviewImageHeight), ContentType: "image/png", Width: PreviewImageWidth, Height: PreviewImageHeight}
	}
	if u.Query().Get("icon") == "1" {
		p.Icon = &linkpreview.Image{Data: pngBytes(16, 16), ContentType: "image/png"}
	}
	return p, nil
}

// Calls は、この Fetcher が rawURL を取りに行った回数。
func (f *Fetcher) Calls(rawURL string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[rawURL]
}

func pngBytes(w, h int) []byte {
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		panic(err) // メモリ上の画像の符号化は失敗しない
	}
	return b.Bytes()
}
