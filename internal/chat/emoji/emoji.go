// Package emoji は、リアクションに使える絵文字かどうかを判定する（ADR 0044 決定 5）。
//
// 判定は「絵文字の一覧に載っているか」ではなく **Unicode の性質**で行う。
// 一覧で持つと、Unicode が増えるたびに新しい絵文字を弾いてしまい、
// 肌の色や ZWJ で合成した絵文字（👨‍👩‍👧 など）も落ちる。
package emoji

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/rivo/uniseg"
)

// MaxBytes は保存する絵文字の長さの上限。
// ZWJ でいくつも繋いだ絵文字でも 64 バイトあれば収まり、これを超えるものは絵文字として扱わない。
const MaxBytes = 64

// Valid は s がリアクションに使える絵文字かを返す。
//
//   - 1 書記素クラスタであること（見た目に 1 文字。「👍👍」や「👍 です」を弾く）
//   - MaxBytes 以内であること
//   - **先頭のコードポイント**が絵文字であること
//
// 先頭だけを見るのは、肌の色（👍🏽 = 👍 + 肌色）や ZWJ の合成を通すため。
// 2 文字目以降には修飾子・ZWJ・異体字セレクタが並ぶので、そこまで絵文字であることは求めない。
func Valid(s string) bool {
	if s == "" || len(s) > MaxBytes {
		return false
	}
	if uniseg.GraphemeClusterCount(s) != 1 {
		return false
	}
	if isKeycap(s) {
		return true
	}
	r, _ := utf8.DecodeRuneInString(s)
	return r != utf8.RuneError && unicode.Is(pictographic, r)
}

// isKeycap はキーキャップ（1️⃣ / #️⃣ / *️⃣）かを返す。
//
// キーキャップだけは**先頭が ASCII**（0-9・#・*）で、絵文字であることは後ろの U+20E3 が決める。
// 先頭のコードポイントを見る規則から外れる唯一の形なので、ここで別に通す。
// ピッカー（emoji-mart）が出す以上、押したら 422 になる絵文字を残さない。
func isKeycap(s string) bool {
	// 先頭が ASCII でなければ、1 バイト目は 0x80 以上になるのでここで落ちる。
	if s == "" || !strings.ContainsRune("0123456789#*", rune(s[0])) {
		return false
	}
	// 異体字セレクタ（U+FE0F）は付いていても付いていなくてもよい。
	return strings.TrimPrefix(s[1:], "\ufe0f") == "\u20e3"
}

// pictographic は Unicode の Extended_Pictographic と Emoji_Presentation を合わせた範囲。
//
// github.com/rivo/uniseg v0.4.7 が持つ同じ名前の表（Unicode 15.0.0 の emoji-data.txt 由来）から、
// 隣り合う範囲をつないで作った。uniseg 側が公開していないので、ここに写している。
// Unicode を上げるときは uniseg を上げてから作り直す。
var pictographic = &unicode.RangeTable{
	R16: []unicode.Range16{
		{0x00A9, 0x00A9, 1},
		{0x00AE, 0x00AE, 1},
		{0x203C, 0x203C, 1},
		{0x2049, 0x2049, 1},
		{0x2122, 0x2122, 1},
		{0x2139, 0x2139, 1},
		{0x2194, 0x2199, 1},
		{0x21A9, 0x21AA, 1},
		{0x231A, 0x231B, 1},
		{0x2328, 0x2328, 1},
		{0x2388, 0x2388, 1},
		{0x23CF, 0x23CF, 1},
		{0x23E9, 0x23F3, 1},
		{0x23F8, 0x23FA, 1},
		{0x24C2, 0x24C2, 1},
		{0x25AA, 0x25AB, 1},
		{0x25B6, 0x25B6, 1},
		{0x25C0, 0x25C0, 1},
		{0x25FB, 0x25FE, 1},
		{0x2600, 0x2605, 1},
		{0x2607, 0x2612, 1},
		{0x2614, 0x2685, 1},
		{0x2690, 0x2705, 1},
		{0x2708, 0x2712, 1},
		{0x2714, 0x2714, 1},
		{0x2716, 0x2716, 1},
		{0x271D, 0x271D, 1},
		{0x2721, 0x2721, 1},
		{0x2728, 0x2728, 1},
		{0x2733, 0x2734, 1},
		{0x2744, 0x2744, 1},
		{0x2747, 0x2747, 1},
		{0x274C, 0x274C, 1},
		{0x274E, 0x274E, 1},
		{0x2753, 0x2755, 1},
		{0x2757, 0x2757, 1},
		{0x2763, 0x2767, 1},
		{0x2795, 0x2797, 1},
		{0x27A1, 0x27A1, 1},
		{0x27B0, 0x27B0, 1},
		{0x27BF, 0x27BF, 1},
		{0x2934, 0x2935, 1},
		{0x2B05, 0x2B07, 1},
		{0x2B1B, 0x2B1C, 1},
		{0x2B50, 0x2B50, 1},
		{0x2B55, 0x2B55, 1},
		{0x3030, 0x3030, 1},
		{0x303D, 0x303D, 1},
		{0x3297, 0x3297, 1},
		{0x3299, 0x3299, 1},
	},
	R32: []unicode.Range32{
		{0x1F000, 0x1F0FF, 1},
		{0x1F10D, 0x1F10F, 1},
		{0x1F12F, 0x1F12F, 1},
		{0x1F16C, 0x1F171, 1},
		{0x1F17E, 0x1F17F, 1},
		{0x1F18E, 0x1F18E, 1},
		{0x1F191, 0x1F19A, 1},
		{0x1F1AD, 0x1F1FF, 1},
		{0x1F201, 0x1F20F, 1},
		{0x1F21A, 0x1F21A, 1},
		{0x1F22F, 0x1F22F, 1},
		{0x1F232, 0x1F23A, 1},
		{0x1F23C, 0x1F23F, 1},
		{0x1F249, 0x1F53D, 1},
		{0x1F546, 0x1F64F, 1},
		{0x1F680, 0x1F6FF, 1},
		{0x1F774, 0x1F77F, 1},
		{0x1F7D5, 0x1F7FF, 1},
		{0x1F80C, 0x1F80F, 1},
		{0x1F848, 0x1F84F, 1},
		{0x1F85A, 0x1F85F, 1},
		{0x1F888, 0x1F88F, 1},
		{0x1F8AE, 0x1F8FF, 1},
		{0x1F90C, 0x1F93A, 1},
		{0x1F93C, 0x1F945, 1},
		{0x1F947, 0x1FAFF, 1},
		{0x1FC00, 0x1FFFD, 1},
	},
}
