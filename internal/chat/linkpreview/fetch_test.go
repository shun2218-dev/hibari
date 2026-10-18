package linkpreview

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/safehttp"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func gifBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := gif.Encode(&b, image.NewPaletted(image.Rect(0, 0, 4, 3), []color.Color{color.Black, color.White}), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// icoBytes は ICO のヘッダー（中身で image/x-icon と判定される）。
var icoBytes = append([]byte{0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0}, make([]byte, 64)...)

// site は、パスごとに応答を決めたテスト用のサイト。
type site struct {
	routes map[string]func(w http.ResponseWriter, r *http.Request)
	hits   atomic.Int64
}

func (s *site) serve(t *testing.T) (*httptest.Server, *Fetcher) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.hits.Add(1)
		if h, ok := s.routes[r.URL.Path]; ok {
			h(w, r)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	port, _ := strconv.ParseUint(u.Port(), 10, 16)
	client := safehttp.New(safehttp.Options{AllowAddr: func(a netip.Addr) bool { return a.IsLoopback() }, Ports: []uint16{uint16(port)}})
	return srv, NewFetcher(client)
}

func htmlPage(head string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><head>" + head + "</head><body></body></html>"))
	}
}

func raw(contentType string, body []byte) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", contentType)
		_, _ = w.Write(body)
	}
}

func TestFetchFull(t *testing.T) {
	s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/post": htmlPage(`<meta property="og:title" content="タイトル"><meta property="og:description" content="説明">
<meta property="og:site_name" content="Example"><meta property="og:image" content="/ogp.png"><link rel="icon" href="/icon.png">`),
	}}
	s.routes["/ogp.png"] = raw("image/png", pngBytes(t, 1200, 630))
	s.routes["/icon.png"] = raw("image/png", pngBytes(t, 32, 32))
	srv, f := s.serve(t)

	p, err := f.Fetch(context.Background(), srv.URL+"/post")
	if err != nil {
		t.Fatal(err)
	}
	if p.Title != "タイトル" || p.Description != "説明" || p.SiteName != "Example" {
		t.Errorf("preview = %+v", p)
	}
	if p.Image == nil || p.Image.ContentType != "image/png" || p.Image.Width != 1200 || p.Image.Height != 630 {
		t.Errorf("image = %+v", p.Image)
	}
	if p.Icon == nil || p.Icon.ContentType != "image/png" {
		t.Errorf("icon = %+v", p.Icon)
	}
}

func TestFetchSiteNameFallsBackToPostedHost(t *testing.T) {
	s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/post": htmlPage(`<title>タイトルだけ</title>`),
	}}
	srv, f := s.serve(t)

	p, err := f.Fetch(context.Background(), srv.URL+"/post")
	if err != nil {
		t.Fatal(err)
	}
	if p.SiteName != "127.0.0.1" || p.Image != nil || p.Icon != nil {
		t.Errorf("preview = %+v", p)
	}
}

func TestFetchImageChecks(t *testing.T) {
	tests := []struct {
		name  string
		image func(t *testing.T) func(http.ResponseWriter, *http.Request)
		want  string // 期待する ContentType。空なら画像なし
	}{
		{"PNG", func(t *testing.T) func(http.ResponseWriter, *http.Request) {
			return raw("image/png", pngBytes(t, 10, 10))
		}, "image/png"},
		{"GIF", func(t *testing.T) func(http.ResponseWriter, *http.Request) { return raw("image/gif", gifBytes(t)) }, "image/gif"},
		{"申告を信じず中身で判定する", func(t *testing.T) func(http.ResponseWriter, *http.Request) {
			return raw("application/octet-stream", pngBytes(t, 10, 10))
		}, "image/png"},
		{"SVG は受け付けない", func(*testing.T) func(http.ResponseWriter, *http.Request) {
			return raw("image/svg+xml", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
		}, ""},
		{"PNG と偽った HTML は受け付けない", func(*testing.T) func(http.ResponseWriter, *http.Request) {
			return raw("image/png", []byte("<html><body>not an image</body></html>"))
		}, ""},
		{"壊れた PNG は受け付けない", func(t *testing.T) func(http.ResponseWriter, *http.Request) {
			return raw("image/png", pngBytes(t, 10, 10)[:20])
		}, ""},
		{"5MB を超えたら使わない", func(t *testing.T) func(http.ResponseWriter, *http.Request) {
			return raw("image/png", append(pngBytes(t, 10, 10), make([]byte, imageMaxBytes)...))
		}, ""},
		{"取れなければ画像なし", func(*testing.T) func(http.ResponseWriter, *http.Request) { return http.NotFound }, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){
				"/post":        htmlPage(`<meta property="og:title" content="T"><meta property="og:image" content="/img">`),
				"/img":         tt.image(t),
				"/favicon.ico": http.NotFound,
			}}
			srv, f := s.serve(t)
			p, err := f.Fetch(context.Background(), srv.URL+"/post")
			if err != nil {
				t.Fatal(err)
			}
			got := ""
			if p.Image != nil {
				got = p.Image.ContentType
			}
			if got != tt.want {
				t.Errorf("image content type = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFetchIconFallsBackToFavicon(t *testing.T) {
	s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/post":        htmlPage(`<meta property="og:title" content="T"><link rel="icon" href="/broken.png">`),
		"/broken.png":  raw("image/png", []byte("not a png")),
		"/favicon.ico": raw("image/vnd.microsoft.icon", icoBytes),
	}}
	srv, f := s.serve(t)

	p, err := f.Fetch(context.Background(), srv.URL+"/post")
	if err != nil {
		t.Fatal(err)
	}
	if p.Icon == nil || p.Icon.ContentType != "image/x-icon" {
		t.Errorf("icon = %+v", p.Icon)
	}
}

func TestFetchIconTooLarge(t *testing.T) {
	s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/post":        htmlPage(`<meta property="og:title" content="T">`),
		"/favicon.ico": raw("image/png", append(pngBytes(t, 16, 16), make([]byte, iconMaxBytes)...)),
	}}
	srv, f := s.serve(t)

	p, err := f.Fetch(context.Background(), srv.URL+"/post")
	if err != nil {
		t.Fatal(err)
	}
	if p.Icon != nil {
		t.Errorf("icon = %+v, want nil", p.Icon)
	}
}

func TestFetchFailures(t *testing.T) {
	tests := []struct {
		name  string
		route func(http.ResponseWriter, *http.Request)
		want  FailKind
	}{
		{"タイトルも説明もない", htmlPage(`<meta property="og:image" content="/a.png">`), FailNoMetadata},
		{"HTML でない", raw("application/pdf", []byte("%PDF-1.7")), FailNotHTML},
		{"404", http.NotFound, FailHTTPStatus},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){"/post": tt.route}}
			srv, f := s.serve(t)
			_, err := f.Fetch(context.Background(), srv.URL+"/post")
			var fe *FetchError
			if !errors.As(err, &fe) || fe.Kind != tt.want {
				t.Errorf("err = %v, want %s", err, tt.want)
			}
		})
	}
}

func TestFetchBlocksInternalAddress(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(htmlPage(`<meta property="og:title" content="社内の秘密">`)))
	defer srv.Close()

	// 本番と同じ検査のクライアント
	f := NewFetcher(safehttp.New(safehttp.Options{}))
	_, err := f.Fetch(context.Background(), srv.URL)
	var fe *FetchError
	if !errors.As(err, &fe) || fe.Kind != FailBlocked {
		t.Fatalf("err = %v, want blocked_address", err)
	}
}

func TestFetchImageOnInternalAddressIsNotFetched(t *testing.T) {
	// ページは許された所にあっても、og:image が内部を指していれば取りに行かない
	var innerHits atomic.Int64
	inner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		innerHits.Add(1)
		_, _ = w.Write(pngBytes(t, 10, 10))
	}))
	defer inner.Close()

	s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/post": htmlPage(`<meta property="og:title" content="T"><meta property="og:image" content="` + inner.URL + `/img.png">`),
	}}
	srv, f := s.serve(t) // 許すのは site のポートだけ
	p, err := f.Fetch(context.Background(), srv.URL+"/post")
	if err != nil {
		t.Fatal(err)
	}
	if p.Image != nil || innerHits.Load() != 0 {
		t.Errorf("image = %+v, inner hits = %d", p.Image, innerHits.Load())
	}
}

func TestFetchTimeout(t *testing.T) {
	block := make(chan struct{})
	s := &site{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/post": func(_ http.ResponseWriter, r *http.Request) {
			select {
			case <-block:
			case <-r.Context().Done():
			}
		},
	}}
	srv, f := s.serve(t)
	defer close(block)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := f.Fetch(ctx, srv.URL+"/post")
	var fe *FetchError
	if !errors.As(err, &fe) || fe.Kind != FailTimeout {
		t.Fatalf("err = %v, want timeout", err)
	}
	if strings.Contains(fe.Error(), srv.URL) {
		t.Error("error message must not contain the URL")
	}
}
