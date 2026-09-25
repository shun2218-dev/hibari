// Package mention は、メッセージの本文からメンションを取り出す（ADR 0041）。
//
// 本文にはユーザーの ID をそのまま入れたトークンを保存し、名前への置き換えは表示のときに行う。
// 表示名を保存すると、改名した瞬間に古い発言が誰を指しているか分からなくなるため。
//
//	<@01J8XXXXXXXXXXXXXXXXXXXXXX>  そのユーザー
//	<!channel>                     ルームの全員
//	<!here>                        送った瞬間にオンラインのルームのメンバー
//
// 誰がメンションされたかは、クライアントの申告ではなくサーバーがこの解釈で決める。
// 申告を信じると、本文に出てこない相手の件数を増やせてしまう。
//
// コード（コードブロックとインラインコード）の中のトークンはメンションにしない（ADR 0051 決定 5）。
// 表示はコードの中をチップにしないので、ここで数えると「通知は来たのに本文のどこにもメンションがない」が起きる。
// 書式の解釈は Web（web/lib/chat/format/body-format.ts）にあり、サーバーが知るのはコードの範囲だけにする（太字などは件数に効かない）。
// 同じ規則を 2 か所に書くことになるので、両方のテストが testdata/format/mentions.json を読んでずれを防ぐ。
// 引用の中のメンションは数える（ADR 0051 決定 5）。
package mention

import (
	"regexp"
	"strings"

	"github.com/oklog/ulid/v2"
)

// Kind はメンションの種類。
type Kind string

const (
	// KindUser は個人へのメンション。UserID を持つ。
	KindUser Kind = "user"
	// KindChannel はルームの全員（@channel）。
	KindChannel Kind = "channel"
	// KindHere は送った瞬間にオンラインのルームのメンバー（@here）。
	KindHere Kind = "here"
)

// Mention は本文から見つけた 1 件のメンション。
type Mention struct {
	Kind Kind
	// UserID は Kind が KindUser のときだけ入る。
	UserID ulid.ULID
}

// ULID は 26 文字の Crockford base32。長さと文字種はここで絞り、値としての正しさは ulid.ParseStrict に任せる
// （I / L / O / U のような紛らわしい文字と、桁あふれを弾く）。
var tokenRe = regexp.MustCompile(`<@([0-9A-Za-z]{26})>|<!(channel|here)>`)

// Parse は本文からメンションを出現順に返す。同じ対象は 1 件にまとめる。
// 読めない ID（存在しないユーザーを含む）は、ただの文字列として無視する。エラーにはしない。
func Parse(body string) []Mention {
	matches := tokenRe.FindAllStringSubmatchIndex(body, -1)
	if matches == nil {
		return nil
	}
	code := CodeRanges(body)
	var (
		out      []Mention
		seenUser = make(map[ulid.ULID]bool, len(matches))
		seenAll  = make(map[Kind]bool, 2)
	)
	for _, m := range matches {
		// トークンはバッククォートを含まないので、コードの範囲にまたがることはない。始まりだけを見ればよい
		if InRanges(code, m[0]) {
			continue
		}
		switch {
		case m[2] >= 0:
			id, err := ulid.ParseStrict(body[m[2]:m[3]])
			if err != nil || seenUser[id] {
				continue
			}
			seenUser[id] = true
			out = append(out, Mention{Kind: KindUser, UserID: id})
		default:
			kind := Kind(body[m[4]:m[5]])
			if seenAll[kind] {
				continue
			}
			seenAll[kind] = true
			out = append(out, Mention{Kind: kind})
		}
	}
	return out
}

// UserIDs は Parse の結果から個人へのメンションの ID だけを出現順に返す。
func UserIDs(ms []Mention) []ulid.ULID {
	var ids []ulid.ULID
	for _, m := range ms {
		if m.Kind == KindUser {
			ids = append(ids, m.UserID)
		}
	}
	return ids
}

// Has は ms に kind のメンションがあるか。
func Has(ms []Mention, kind Kind) bool {
	for _, m := range ms {
		if m.Kind == kind {
			return true
		}
	}
	return false
}

// fence はコードブロックの記号。
const fence = "```"

// CodeRanges は、本文の中のコードの範囲（記号を含む、バイトの [始まり, 終わり)）を前から順に返す（ADR 0051 決定 2）。
//
//   - コードブロック: ``` を前から順に対にする。行の途中でもよい。閉じていない ``` はコードではない
//   - インラインコード: コードブロックの外で、` から同じ行の次の ` まで。中身が空のもの（バッククォートが 2 つ続くだけ）はコードではない
//
// Web の解釈（body-format.ts の splitFences と readAtom）と同じ結果になるように書く。
func CodeRanges(body string) [][2]int {
	var ranges [][2]int
	pos := 0
	for {
		open := strings.Index(body[pos:], fence)
		if open < 0 {
			break
		}
		open += pos
		closing := strings.Index(body[open+len(fence):], fence)
		if closing < 0 {
			break
		}
		end := open + len(fence) + closing + len(fence)
		ranges = appendInlineCode(ranges, body, pos, open)
		ranges = append(ranges, [2]int{open, end})
		pos = end
	}
	return appendInlineCode(ranges, body, pos, len(body))
}

// appendInlineCode は、body[from:to] の中のインラインコードの範囲を ranges に足す。
// コードブロックで区切られた両側のバッククォートは対にしない（Web もコードブロックの前後を別々に解釈する）。
func appendInlineCode(ranges [][2]int, body string, from, to int) [][2]int {
	s := body[from:to]
	for i := 0; i < len(s); i++ {
		if s[i] != '`' {
			continue
		}
		rest := s[i+1:]
		closing := strings.IndexByte(rest, '`')
		newline := strings.IndexByte(rest, '\n')
		// 中身が 1 文字以上あり、同じ行で閉じるものだけ。閉じなければ、次のバッククォートから探し直す（``a` の a はコード）
		if closing > 0 && (newline < 0 || closing < newline) {
			ranges = append(ranges, [2]int{from + i, from + i + 1 + closing + 1})
			i += 1 + closing
		}
	}
	return ranges
}

// InRanges は pos がコードの範囲（CodeRanges の結果）の中にあるか。
func InRanges(ranges [][2]int, pos int) bool {
	for _, r := range ranges {
		if r[0] <= pos && pos < r[1] {
			return true
		}
	}
	return false
}
