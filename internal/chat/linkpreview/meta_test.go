package linkpreview

import (
	"net/url"
	"slices"
	"strings"
	"testing"

	"golang.org/x/text/encoding/japanese"
)

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestParseHTMLReadsOGP(t *testing.T) {
	const page = `<!doctype html><html><head>
<title>ページのタイトル</title>
<meta property="og:title" content="OGP のタイトル">
<meta property="og:description" content="OGP の説明">
<meta property="og:site_name" content="Example">
<meta property="og:image" content="/images/ogp.png">
<meta name="twitter:title" content="Twitter のタイトル">
<link rel="icon" href="/favicon-16.png" sizes="16x16">
<link rel="icon" href="/favicon-64.png" sizes="64x64">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
</head><body><meta property="og:title" content="body の中は読まない"></body></html>`
	m := ParseHTML([]byte(page), "text/html; charset=utf-8", mustURL(t, "https://example.com/posts/1"))

	want := Meta{
		Title:       "OGP のタイトル",
		Description: "OGP の説明",
		SiteName:    "Example",
		ImageURL:    "https://example.com/images/ogp.png",
		IconURLs:    []string{"https://example.com/favicon-32.png", "https://example.com/favicon.ico"},
	}
	if m.Title != want.Title || m.Description != want.Description || m.SiteName != want.SiteName || m.ImageURL != want.ImageURL ||
		!slices.Equal(m.IconURLs, want.IconURLs) {
		t.Errorf("ParseHTML = %+v, want %+v", m, want)
	}
}

func TestParseHTMLFallbacks(t *testing.T) {
	tests := []struct {
		name string
		head string
		want Meta
	}{
		{
			"OGP がなければ twitter: を使う",
			`<meta name="twitter:title" content="T"><meta name="twitter:description" content="D"><meta name="twitter:image" content="https://cdn.example/t.png">`,
			Meta{Title: "T", Description: "D", ImageURL: "https://cdn.example/t.png"},
		},
		{
			"どちらもなければ <title> と description",
			`<title>  タイトル &amp; 記号  </title><meta name="description" content="説明">`,
			Meta{Title: "タイトル & 記号", Description: "説明"},
		},
		{
			"og:image:secure_url を優先する",
			`<meta property="og:image" content="http://example.com/a.png"><meta property="og:image:secure_url" content="https://example.com/a.png">`,
			Meta{ImageURL: "https://example.com/a.png"},
		},
		{
			"同じ名前は最初のもの",
			`<meta property="og:title" content="1 つ目"><meta property="og:title" content="2 つ目">`,
			Meta{Title: "1 つ目"},
		},
		{
			"http でない画像は取りに行かない",
			`<meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="T">`,
			Meta{Title: "T"},
		},
		{
			"空白と改行は 1 つにまとめる",
			"<meta property=\"og:description\" content=\"1 行目\n\n  2 行目\t3\">",
			Meta{Description: "1 行目 2 行目 3"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := ParseHTML([]byte("<html><head>"+tt.head+"</head></html>"), "text/html", mustURL(t, "https://example.com/p"))
			if m.Title != tt.want.Title || m.Description != tt.want.Description || m.ImageURL != tt.want.ImageURL {
				t.Errorf("got title=%q desc=%q image=%q, want %+v", m.Title, m.Description, m.ImageURL, tt.want)
			}
		})
	}
}

func TestParseHTMLHasText(t *testing.T) {
	m := ParseHTML([]byte(`<html><head><meta property="og:image" content="/a.png"></head></html>`), "text/html", mustURL(t, "https://example.com/"))
	if m.HasText() {
		t.Error("画像だけのページはカードにしない")
	}
}

func TestParseHTMLIcons(t *testing.T) {
	tests := []struct {
		name string
		head string
		want []string
	}{
		{"アイコンがなければ /favicon.ico", ``, []string{"https://example.com/favicon.ico"}},
		{"sizes がなければ最初のもの", `<link rel="shortcut icon" href="/a.ico"><link rel="icon" href="/b.png">`,
			[]string{"https://example.com/a.ico", "https://example.com/favicon.ico"}},
		{"32px 以上がなければ最初のもの", `<link rel="icon" href="/16.png" sizes="16x16"><link rel="icon" href="/24.png" sizes="24x24">`,
			[]string{"https://example.com/16.png", "https://example.com/favicon.ico"}},
		{"apple-touch-icon も候補にする", `<link rel="apple-touch-icon" href="/touch.png" sizes="180x180">`,
			[]string{"https://example.com/touch.png", "https://example.com/favicon.ico"}},
		{"SVG は候補にしない", `<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="mask-icon" href="/mask.svg">`,
			[]string{"https://example.com/favicon.ico"}},
		{"/favicon.ico を指していれば重ねない", `<link rel="icon" href="/favicon.ico">`, []string{"https://example.com/favicon.ico"}},
		{"別のホストのアイコン", `<link rel="icon" href="https://cdn.example/i.png">`,
			[]string{"https://cdn.example/i.png", "https://example.com/favicon.ico"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := ParseHTML([]byte("<html><head>"+tt.head+"</head></html>"), "text/html", mustURL(t, "https://example.com/p/q"))
			if !slices.Equal(m.IconURLs, tt.want) {
				t.Errorf("IconURLs = %q, want %q", m.IconURLs, tt.want)
			}
		})
	}
}

func TestParseHTMLCharset(t *testing.T) {
	const page = `<html><head><meta charset="Shift_JIS"><meta property="og:title" content="日本語のタイトル"></head></html>`
	sjis, err := japanese.ShiftJIS.NewEncoder().String(page)
	if err != nil {
		t.Fatal(err)
	}
	base := mustURL(t, "https://example.jp/")

	// <meta charset> から決める
	if m := ParseHTML([]byte(sjis), "text/html", base); m.Title != "日本語のタイトル" {
		t.Errorf("meta charset: title = %q", m.Title)
	}
	// Content-Type の charset から決める
	eucPage := strings.Replace(page, `<meta charset="Shift_JIS">`, "", 1)
	euc, err := japanese.EUCJP.NewEncoder().String(eucPage)
	if err != nil {
		t.Fatal(err)
	}
	if m := ParseHTML([]byte(euc), "text/html; charset=EUC-JP", base); m.Title != "日本語のタイトル" {
		t.Errorf("content-type charset: title = %q", m.Title)
	}
}

func TestParseHTMLTruncated(t *testing.T) {
	// 上限で切れた HTML でも、読めたところまでで返す
	page := `<html><head><meta property="og:title" content="タイトル"><meta property="og:descr`
	if m := ParseHTML([]byte(page), "text/html", mustURL(t, "https://example.com/")); m.Title != "タイトル" {
		t.Errorf("title = %q", m.Title)
	}
}

func TestClean(t *testing.T) {
	tests := []struct {
		in   string
		max  int
		want string
	}{
		{"そのまま", 10, "そのまま"},
		{"  前後の空白  ", 10, "前後の空白"},
		{"制御\x00文字\x07", 10, "制御文字"},
		{"あいうえおかきくけこ", 10, "あいうえおかきくけこ"},
		{"あいうえおかきくけこさ", 10, "あいうえおかきくけ…"},
	}
	for _, tt := range tests {
		if got := clean(tt.in, tt.max); got != tt.want {
			t.Errorf("clean(%q, %d) = %q, want %q", tt.in, tt.max, got, tt.want)
		}
	}
}
