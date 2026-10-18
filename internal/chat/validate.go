package chat

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// workspaceNameMax はワークスペース名の長さの上限（rune 単位）。サイドバーと切り替えメニューに収まる長さにする。
const workspaceNameMax = 50

// normalizeName は前後の空白を除いた名前を返し、問題があれば fields に追加する。
func normalizeName(fields *fieldErrors, field, name string, maxRunes int) string {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		fields.add(field, ReasonRequired)
	case utf8.RuneCountInString(name) > maxRunes:
		fields.add(field, ReasonTooLong)
	case strings.ContainsFunc(name, unicode.IsControl):
		// 改行やタブを含む名前は、一覧の 1 行の表示を崩す。
		fields.add(field, ReasonInvalidFormat)
	}
	return name
}
