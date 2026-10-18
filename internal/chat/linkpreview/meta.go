package linkpreview

import (
	"bytes"
	"io"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

// 長さの上限（rune 単位。ADR 0065 決定 9）。超えたら切って「…」を付ける。
const (
	titleMax       = 300
	descriptionMax = 1000
	siteNameMax    = 100
)

// Meta はページの HTML から読んだ、カードに出すもの（ADR 0065 決定 9）。
type Meta struct {
	Title       string
	Description string
	// SiteName は og:site_name。なければ空（ホスト名で埋めるのは呼ぶ側。本文に書かれた URL のホストにするため）。
	SiteName string
	// ImageURL は画像の絶対 URL。なければ空。
	ImageURL string
	// IconURLs は、サイトのアイコンとして試す絶対 URL を試す順に並べたもの（ADR 0065 決定 14）。最後は /favicon.ico。
	IconURLs []string
}

// HasText は、カードにする文字（タイトルか説明）があるか。どちらもなければカードを作らない（ADR 0065 決定 9）。
func (m Meta) HasText() bool { return m.Title != "" || m.Description != "" }

// ParseHTML はページの HTML からメタデータを読む。<body> に入ったら読むのをやめる（メタデータは <head> にある）。
//
// contentType は応答の Content-Type（charset の判定に使う）。base はリダイレクトを辿った後の URL で、相対 URL を解決する。
// 途中で切れた HTML（上限までしか読んでいない）でも、読めたところまでで返す。
func ParseHTML(body []byte, contentType string, base *url.URL) Meta {
	// Shift_JIS や EUC-JP のサイトが化けないよう、Content-Type・BOM・<meta charset> から文字コードを決めて UTF-8 にする
	var r io.Reader = bytes.NewReader(body)
	if cr, err := charset.NewReader(r, contentType); err == nil {
		r = cr
	}

	var (
		metas   = map[string]string{}
		title   string
		inTitle bool
		icons   []iconCandidate
	)
	z := html.NewTokenizer(r)
loop:
	for {
		switch z.Next() {
		case html.ErrorToken:
			break loop
		case html.TextToken:
			if inTitle && title == "" {
				title = string(z.Text())
			}
		case html.EndTagToken:
			if name, _ := z.TagName(); string(name) == "title" {
				inTitle = false
			}
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			switch string(name) {
			case "body":
				break loop
			case "title":
				inTitle = true
			case "meta":
				if hasAttr {
					readMeta(z, metas)
				}
			case "link":
				if hasAttr {
					if c, ok := readIcon(z, base); ok {
						icons = append(icons, c)
					}
				}
			}
		}
	}

	m := Meta{
		Title:       clean(first(metas, "og:title", "twitter:title"), titleMax),
		Description: clean(first(metas, "og:description", "twitter:description", "description"), descriptionMax),
		SiteName:    clean(metas["og:site_name"], siteNameMax),
	}
	if m.Title == "" {
		m.Title = clean(title, titleMax)
	}
	if u := resolve(base, first(metas, "og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src")); u != "" {
		m.ImageURL = u
	}
	m.IconURLs = iconURLs(icons, base)
	return m
}

// readMeta は <meta property|name content> を metas に入れる。同じ名前は最初のものを使う。
func readMeta(z *html.Tokenizer, metas map[string]string) {
	var key, content string
	hasContent := false
	for {
		k, v, more := z.TagAttr()
		switch string(k) {
		case "property", "name":
			if key == "" {
				key = strings.ToLower(strings.TrimSpace(string(v)))
			}
		case "content":
			content, hasContent = string(v), true
		}
		if !more {
			break
		}
	}
	if key == "" || !hasContent {
		return
	}
	if _, ok := metas[key]; !ok {
		metas[key] = content
	}
}

type iconCandidate struct {
	url string
	// size は sizes の大きい方の辺。書いていなければ 0。
	size int
}

// readIcon は <link rel="icon"> などをアイコンの候補にする。SVG は受け付けないので、候補にもしない（ADR 0065 決定 14）。
func readIcon(z *html.Tokenizer, base *url.URL) (iconCandidate, bool) {
	var rel, href, sizes, typ string
	for {
		k, v, more := z.TagAttr()
		switch string(k) {
		case "rel":
			rel = strings.ToLower(string(v))
		case "href":
			href = string(v)
		case "sizes":
			sizes = strings.ToLower(string(v))
		case "type":
			typ = strings.ToLower(string(v))
		}
		if !more {
			break
		}
	}
	isIcon := false
	for _, r := range strings.Fields(rel) {
		// mask-icon は Safari のピン留めタブ用の単色の SVG
		if r == "icon" || r == "apple-touch-icon" || r == "apple-touch-icon-precomposed" {
			isIcon = true
		}
	}
	u := resolve(base, href)
	if !isIcon || u == "" || typ == "image/svg+xml" || strings.HasSuffix(strings.ToLower(pathOf(u)), ".svg") {
		return iconCandidate{}, false
	}
	c := iconCandidate{url: u}
	for _, s := range strings.Fields(sizes) {
		w, h, ok := strings.Cut(s, "x")
		if !ok {
			continue
		}
		wi, err1 := strconv.Atoi(w)
		hi, err2 := strconv.Atoi(h)
		if err1 == nil && err2 == nil {
			c.size = max(c.size, wi, hi)
		}
	}
	return c, true
}

// iconURLs は試す順のアイコンの URL（ADR 0065 決定 14）。
// 32px 以上のうち最も小さいもの、なければ最初のもの。最後に /favicon.ico を足す。
func iconURLs(cands []iconCandidate, base *url.URL) []string {
	var out []string
	sized := slices.DeleteFunc(slices.Clone(cands), func(c iconCandidate) bool { return c.size < 32 })
	switch {
	case len(sized) > 0:
		out = append(out, slices.MinFunc(sized, func(a, b iconCandidate) int { return a.size - b.size }).url)
	case len(cands) > 0:
		out = append(out, cands[0].url)
	}
	if base != nil {
		fav := (&url.URL{Scheme: base.Scheme, Host: base.Host, Path: "/favicon.ico"}).String()
		if !slices.Contains(out, fav) {
			out = append(out, fav)
		}
	}
	return out
}

// first は、keys の順に最初に空でない値を返す。
func first(metas map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(metas[k]); v != "" {
			return v
		}
	}
	return ""
}

// resolve は ref を base で解決した絶対 URL を返す。http / https でなければ空（data: や javascript: を取りに行かない）。
func resolve(base *url.URL, ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	u, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	if u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
		return ""
	}
	return u.String()
}

func pathOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return path.Clean(u.Path)
}

// clean は空白と改行を 1 つの空白に詰め、制御文字を落とし、max を超えたら切って「…」を付ける（ADR 0065 決定 9）。
func clean(s string, maxRunes int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && !unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	runes := []rune(s)
	return strings.TrimSpace(string(runes[:maxRunes-1])) + "…"
}
