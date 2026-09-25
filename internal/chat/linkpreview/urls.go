// Package linkpreview は外部のリンクのプレビュー（ADR 0065）の、DB に依らない部分を持つ。
//
//   - 本文から、展開する URL を取り出す（urls.go）
//   - ページの HTML から、カードに出すメタデータを読む（meta.go）
//   - ページ・画像・アイコンを取りに行く（fetch.go。接続の検査は platform/safehttp）
//
// 取れた結果を DB とストレージに置き、メッセージに付けて配るのは internal/chat の仕事。
package linkpreview

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/shun2218-dev/hibari/internal/chat/mention"
)

// MaxLinks は、展開するメッセージの URL の数の上限。これより多ければ、どれも展開しない（Slack と同じ。ADR 0065 決定 3）。
const MaxLinks = 5

// labeledLink は文字付きのリンク（`<https://…|文字>`。ADR 0051 決定 4 の追記）。Web の LABELED_LINK と同じ。
// JavaScript の \s は Unicode の空白を含むので、\p{Z} と BOM も足してそろえる。
var labeledLink = regexp.MustCompile("^<(https?://[^\\s\\p{Z}\\x{feff}<>`|]+)\\|([^<>`\\n]+)>")

// urlTrailing は URL の末尾から落とす文字（句読点・閉じ括弧・書式の記号）。Web の URL_TRAILING と同じ。
var urlTrailing = regexp.MustCompile(`[.,;:!?)\]}'"*_~]+$`)

// ExtractURLs は、本文の中の URL を出てきた順に返す。重複もそのまま返す。コードの中は含めない。
//
// 表示の解釈は Web（web/lib/chat/format/body-format.ts の findUrls）にあり、ここは URL を見つけるのに要る部分だけを写す。
// 書式（太字など）は URL の境界に効かないので読まない。ずれは testdata/format/urls.json を両方のテストで読んで防ぐ。
func ExtractURLs(body string) []string {
	code := mention.CodeRanges(body)
	var urls []string
	for i := 0; i < len(body); {
		if mention.InRanges(code, i) {
			i++
			continue
		}
		switch {
		case body[i] == '<':
			// 文字付きのリンクは、中の URL を取って丸ごと飛ばす（`|` の後ろの文字を URL の続きとして読まないように）
			if m := labeledLink.FindStringSubmatch(body[i:]); m != nil {
				urls = append(urls, m[1])
				i += len(m[0])
				continue
			}
		case body[i] == 'h' && (strings.HasPrefix(body[i:], "https://") || strings.HasPrefix(body[i:], "http://")) &&
			(i == 0 || !isWordChar(body[i-1])):
			end := i
			for end < len(body) && isURLChar(body[end]) {
				end++
			}
			u := urlTrailing.ReplaceAllString(body[i:end], "")
			// スキームだけ（`https://`）はリンクにしない
			if rest := strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://"); rest != "" && rest[0] != '/' {
				urls = append(urls, u)
				i += len(u)
				continue
			}
		}
		i++
	}
	return urls
}

// Candidates は、本文から展開する URL を決める（ADR 0065 決定 3）。
//
//   - URL が MaxLinks より多ければ、どれも展開しない（nil）
//   - 自分のアプリ（app と同じオリジン）の URL は展開しない。パーマリンクには ADR 0040 のカードが出る
//   - 同じ URL は 1 件にまとめる。並びは本文に出てきた順
func Candidates(body string, app *url.URL) []string {
	all := ExtractURLs(body)
	if len(all) > MaxLinks {
		return nil
	}
	var out []string
	seen := make(map[string]bool, len(all))
	for _, raw := range all {
		if seen[raw] {
			continue
		}
		seen[raw] = true
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			continue
		}
		if IsAppURL(u, app) {
			continue
		}
		out = append(out, raw)
	}
	return out
}

// IsAppURL は、u が自分のアプリ（app）と同じオリジンか。app が nil なら false。
func IsAppURL(u, app *url.URL) bool {
	return app != nil && strings.EqualFold(u.Scheme, app.Scheme) && strings.EqualFold(u.Host, app.Host)
}

func isWordChar(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

// isURLChar は URL に含める文字か。ASCII の表示文字で、`<` `>` “ ` “ は含めない（Web の URL_CHAR と URL_EXCLUDED）。
func isURLChar(c byte) bool {
	return c >= '!' && c <= '~' && c != '<' && c != '>' && c != '`'
}
