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
// 本文から「特別な部分」を見つける処理は、Phase 6.10（本文の書式）でまとめて作る予定になっている。
// ここに閉じ込めておけば、6.10 の解釈からこのパッケージを呼ぶだけで済み、同じ解釈を 2 か所に書かずにすむ。
// 6.10 が入るまでは、コードブロックや引用の中のメンションも区別しない（除外は 6.10 と同時に足す）。
package mention

import (
	"regexp"

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
	matches := tokenRe.FindAllStringSubmatch(body, -1)
	if matches == nil {
		return nil
	}
	var (
		out      []Mention
		seenUser = make(map[ulid.ULID]bool, len(matches))
		seenAll  = make(map[Kind]bool, 2)
	)
	for _, m := range matches {
		switch {
		case m[1] != "":
			id, err := ulid.ParseStrict(m[1])
			if err != nil || seenUser[id] {
				continue
			}
			seenUser[id] = true
			out = append(out, Mention{Kind: KindUser, UserID: id})
		default:
			kind := Kind(m[2])
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
