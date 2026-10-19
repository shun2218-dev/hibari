// Package plaintext は、メッセージの本文（ADR 0051 の記法）を通知に出す平文にする（ADR 0069 決定 7）。
//
// プッシュ通知の本文はサーバーが作る（Service Worker は本文を解釈する仕組みもメンションの名前も持たない）。
// タブの通知（ADR 0057）は Web の plainText（web/lib/chat/notifications/desktop-notification.ts）が作るので、
// 同じ規則が 2 か所にある。両方のテストが testdata/format/plaintext.json を読んでずれを防ぐ。
//
// 書式の解釈の正本は Web（web/lib/chat/format/body-format.ts の parseBody）。ここは平文にするのに要る部分だけを写す:
// 木は作らず、記号を外した文字列を直接組み立てる。平文では入れ子の深さや番号の有無が結果に効かないため。
//
// 位置はバイトで数える。書式の記号はすべて ASCII なので、多バイトの文字の途中が記号に見えることはない
// （UTF-8 の 2 バイト目以降は 0x80 以上）。空白の判定だけは文字（rune）で見る。
package plaintext

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// UnknownUser は、メンションの相手の名前が引けない（存在しないユーザー）ときの名前。Web と同じ文言。
const UnknownUser = "不明なユーザー"

// UnresolvedChannel は、チャンネルへのリンクの名前が引けない（読めない private・削除済み・別のワークスペース）ときの名前。
// Web の UNRESOLVED_CHANNEL_NAME（ADR 0062 決定 3）と同じ文言。
const UnresolvedChannel = "アクセスできないチャンネル"

// Names は、本文のトークンを名前に置き換える表。キーは本文に書かれた ID の文字列そのもの（Web も書かれたままで引く）。
type Names struct {
	// Users はメンションの相手の表示名。
	Users map[string]string
	// Channels は、受け取る人が読めるチャンネルの名前。ここにないチャンネルは UnresolvedChannel になる。
	Channels map[string]string
}

const (
	fence     = "```"
	underline = "__"
)

// 行の正規表現。JavaScript の `.` は改行の類（\r・U+2028・U+2029）に一致しないので、Go でも除いてそろえる
// （「- a\r」のような行は Web でリストにならない）。
var (
	quoteLine = regexp.MustCompile(`^>(?: |$)([^\r\x{2028}\x{2029}]*)$`)
	// labeledLink は文字付きのリンク。linkpreview の labeledLink と同じ（JavaScript の \s に合わせて \p{Z} と BOM を足す）。
	labeledLink = regexp.MustCompile("^<(https?://[^\\s\\p{Z}\\x{feff}<>`|]+)\\|([^<>`\\n]+)>")
	mentionTok  = regexp.MustCompile(`^(?:<@([0-9A-Za-z]{26})>|<!(channel|here)>)`)
	channelTok  = regexp.MustCompile(`^<#([0-9A-Za-z]{26})>`)
	urlTrailing = regexp.MustCompile(`[.,;:!?)\]}'"*_~]+$`)
	urlScheme   = regexp.MustCompile(`^https?://[^/]`)
)

// listLineRe は Web の LIST_LINE。字下げと番号は平文に出ないので、項目の文字だけを取る。
var listLineRe = regexp.MustCompile(`^ *(?:[-*•]|[0-9]{1,9}\.) ([^\r\x{2028}\x{2029}]*)$`)

// Render は本文を平文にする。書式の記号を外し、メンションは `@名前`、チャンネルへのリンクは `#名前`、
// リンクは文字（なければ URL）にする。空白の並びは 1 つにまとめ、前後の空白を落とす。
func Render(body string, names Names) string {
	return renderer{names: names}.body(body)
}

// FilesSent は、本文がなく添付だけの投稿の通知の本文（docs/ui の「届く通知の中身」）。
// 「ファイルを 2 件送りました: a.pdf、b.png」。Web の filesSentText（タブの通知）と同じ文言で、
// 両方のテストが testdata/format/files-sent.json を読んでずれを防ぐ（ADR 0069 決定 7）。
func FilesSent(fileNames []string) string {
	return "ファイルを " + strconv.Itoa(len(fileNames)) + " 件送りました: " + strings.Join(fileNames, "、")
}

// ChannelIDs は、本文のチャンネルへのリンクの ID を出てきた順に返す（重複もそのまま）。コードの中は含めない。
// 呼ぶ側は、受け取る人が読めるチャンネルの名前だけを Names.Channels に入れる。Render と同じ解釈で探すので、
// 「名前を引いたのに平文に出ない」「平文に出るのに名前を引いていない」が起きない。
func ChannelIDs(body string) []string {
	var ids []string
	renderer{onChannel: func(id string) { ids = append(ids, id) }}.body(body)
	return ids
}

func (r renderer) body(body string) string {
	var parts []string
	for _, seg := range splitFences(body) {
		if seg.code {
			parts = append(parts, seg.text)
			continue
		}
		parts = append(parts, r.lines(strings.Split(seg.text, "\n"))...)
	}
	return collapse(strings.Join(parts, " "))
}

type segment struct {
	text string
	code bool
}

// splitFences はコードブロックとそれ以外に分ける。閉じていない ``` はただの文字として残す（Web の splitFences）。
func splitFences(body string) []segment {
	var out []segment
	rest := body
	for {
		open := strings.Index(rest, fence)
		if open < 0 {
			break
		}
		closing := strings.Index(rest[open+len(fence):], fence)
		if closing < 0 {
			break
		}
		closing += open + len(fence)
		// フェンスの前後の改行 1 つは記号の一部として落とす
		before := strings.TrimSuffix(rest[:open], "\n")
		code := strings.TrimSuffix(strings.TrimPrefix(rest[open+len(fence):closing], "\n"), "\n")
		if before != "" {
			out = append(out, segment{text: before})
		}
		out = append(out, segment{text: code, code: true})
		rest = strings.TrimPrefix(rest[closing+len(fence):], "\n")
	}
	if rest != "" || len(out) == 0 {
		out = append(out, segment{text: rest})
	}
	return out
}

type renderer struct {
	names Names
	// onChannel はチャンネルへのリンクを読むたびに呼ばれる（ChannelIDs が使う）。nil なら呼ばない。
	onChannel func(id string)
}

// lines は行の並びをブロックごとの平文にする（Web の parseLines）。
// 引用は中身を同じ規則で読み、リストは各行の文字を、それ以外は続く行を 1 つの段落として読む。
func (r renderer) lines(lines []string) []string {
	var out []string
	for i := 0; i < len(lines); {
		switch {
		case quoteLine.MatchString(lines[i]):
			var quoted []string
			for ; i < len(lines); i++ {
				m := quoteLine.FindStringSubmatch(lines[i])
				if m == nil {
					break
				}
				quoted = append(quoted, m[1])
			}
			out = append(out, strings.Join(r.lines(quoted), " "))
		case listLineRe.MatchString(lines[i]):
			// 入れ子の深さと番号は平文に出ないので、行の順に項目の文字を並べるだけでよい
			// （Web の buildLists も、項目を行の順に親の項目の後ろへ置く）
			var items []string
			for ; i < len(lines); i++ {
				m := listLineRe.FindStringSubmatch(lines[i])
				if m == nil {
					break
				}
				items = append(items, r.inline(m[1]))
			}
			out = append(out, strings.Join(items, " "))
		default:
			start := i
			for i < len(lines) && !quoteLine.MatchString(lines[i]) && !listLineRe.MatchString(lines[i]) {
				i++
			}
			out = append(out, r.inline(strings.Join(lines[start:i], "\n")))
		}
	}
	return out
}

// inline はインラインの書式を外す（Web の parseInline）。書式は行をまたがない。
func (r renderer) inline(text string) string {
	var b strings.Builder
	for i := 0; i < len(text); {
		if s, end, ok := r.atom(text, i); ok {
			b.WriteString(s)
			i = end
			continue
		}
		// 下線（`__`）は斜体（`_`）より先に見る
		marker := text[i : i+1]
		if strings.HasPrefix(text[i:], underline) {
			marker = underline
		}
		if isEmphasis(marker) {
			if closing := findCloser(text, i, marker); closing > 0 {
				b.WriteString(r.inline(text[i+len(marker) : closing]))
				i = closing + len(marker)
				continue
			}
		}
		b.WriteByte(text[i])
		i++
	}
	return b.String()
}

func isEmphasis(marker string) bool {
	switch marker {
	case "*", "_", "~", underline:
		return true
	}
	return false
}

// atom は、中を解釈しない部品（インラインコード・リンク・チャンネル・メンション・URL）が i から始まるなら、
// その平文と終わりの位置を返す（Web の readAtom）。
func (r renderer) atom(text string, i int) (string, int, bool) {
	s, end, ok := readAtom(text, i)
	if !ok {
		return "", 0, false
	}
	switch s.kind {
	case atomUser:
		name, found := r.names.Users[s.id]
		if !found {
			name = UnknownUser
		}
		return "@" + name, end, true
	case atomChannel:
		if r.onChannel != nil {
			r.onChannel(s.id)
		}
		name, found := r.names.Channels[s.id]
		if !found {
			name = UnresolvedChannel
		}
		return "#" + name, end, true
	}
	return s.text, end, true
}

type atomKind int

const (
	atomText atomKind = iota
	atomUser
	atomChannel
)

type atomValue struct {
	kind atomKind
	// text は atomText のときの平文。
	text string
	// id は atomUser / atomChannel のときの ID。
	id string
}

// readAtom は名前を引かずに部品を読む。findCloser が部品を飛ばすのにも使う。
func readAtom(text string, i int) (atomValue, int, bool) {
	switch text[i] {
	case '`':
		rest := text[i+1:]
		closing := strings.IndexByte(rest, '`')
		newline := strings.IndexByte(rest, '\n')
		// 中身が空のもの（``）と、行をまたぐものはコードにしない
		if closing > 0 && (newline < 0 || closing < newline) {
			return atomValue{text: rest[:closing]}, i + 1 + closing + 1, true
		}
	case '<':
		rest := text[i:]
		if m := labeledLink.FindStringSubmatch(rest); m != nil {
			return atomValue{text: m[2]}, i + len(m[0]), true
		}
		if m := channelTok.FindStringSubmatch(rest); m != nil {
			return atomValue{kind: atomChannel, id: m[1]}, i + len(m[0]), true
		}
		if m := mentionTok.FindStringSubmatch(rest); m != nil {
			if m[1] != "" {
				return atomValue{kind: atomUser, id: m[1]}, i + len(m[0]), true
			}
			return atomValue{text: "@" + m[2]}, i + len(m[0]), true
		}
	case 'h':
		if (strings.HasPrefix(text[i:], "https://") || strings.HasPrefix(text[i:], "http://")) && (i == 0 || !isWordChar(text[i-1])) {
			end := i
			for end < len(text) && isURLChar(text[end]) {
				end++
			}
			u := urlTrailing.ReplaceAllString(text[i:end], "")
			// スキームだけ（`https://`）はリンクにしない
			if urlScheme.MatchString(u) {
				return atomValue{text: u}, i + len(u), true
			}
		}
	}
	return atomValue{}, 0, false
}

// findCloser は、i にある書式の記号が開く記号なら、対になる閉じる記号の位置を返す。なければ -1（Web の findCloser）。
//
// 境界は「ASCII の英数字でないこと」。開く記号の直後と閉じる記号の直前は空白であってはいけない。
// 中の部品は飛ばし、斜体の `_` を探すときは下線の `__` を飛ばす。
func findCloser(text string, i int, marker string) int {
	after := i + len(marker)
	if (i > 0 && isWordChar(text[i-1])) || after >= len(text) || isSpaceAt(text, after) || text[after] == marker[0] {
		return -1
	}
	for j := after; j < len(text); {
		if text[j] == '\n' {
			return -1
		}
		if _, end, ok := readAtom(text, j); ok {
			j = end
			continue
		}
		if marker == "_" && strings.HasPrefix(text[j:], underline) {
			j += len(underline)
			continue
		}
		next := j + len(marker)
		if strings.HasPrefix(text[j:], marker) && !isSpaceBefore(text, j) &&
			(next >= len(text) || !isWordChar(text[next]) && text[next] != marker[0]) {
			return j
		}
		j++
	}
	return -1
}

func isWordChar(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

// isURLChar は URL に含める文字か。ASCII の表示文字で、`<` `>` と “ ` “ は含めない（Web の URL_CHAR と URL_EXCLUDED）。
func isURLChar(c byte) bool {
	return c >= '!' && c <= '~' && c != '<' && c != '>' && c != '`'
}

func isSpaceAt(text string, i int) bool {
	r, _ := utf8.DecodeRuneInString(text[i:])
	return isJSSpace(r)
}

func isSpaceBefore(text string, i int) bool {
	r, _ := utf8.DecodeLastRuneInString(text[:i])
	return isJSSpace(r)
}

// isJSSpace は JavaScript の \s（と String.prototype.trim が落とす文字）。
// Go の unicode.IsSpace とは U+0085 と U+FEFF の扱いが違うので、Web とそろえるために自分で並べる。
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// collapse は空白の並びを 1 つの空白にし、前後の空白を落とす（Web の `.replace(/\s+/gu, " ").trim()`）。
func collapse(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if isJSSpace(r) {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}
