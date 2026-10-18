package emoji_test

import (
	"strings"
	"testing"

	"github.com/shun2218-dev/hibari/internal/chat/emoji"
)

func TestValid(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   string
		want bool
	}{
		{"素の絵文字", "👍", true},
		{"記号寄りの絵文字", "🎉", true},
		{"異体字セレクタ付き", "❤️", true},
		{"異体字セレクタなし（別の値として通す。ADR 0044 決定 5）", "❤", true},
		{"肌の色の修飾子", "👍🏽", true},
		{"ZWJ の合成（家族）", "👨‍👩‍👧", true},
		{"ZWJ の合成（職業）", "👩‍💻", true},
		{"国旗（地域指示子 2 つで 1 クラスタ）", "🇯🇵", true},
		{"キーキャップ（ピッカーが出すので通す）", "1️⃣", true},
		{"キーキャップ（#）", "#️⃣", true},
		{"異体字セレクタなしのキーキャップ", "1\u20e3", true},
		{"キーキャップの囲みだけ", "\u20e3", false},
		{"空", "", false},
		{"ASCII の文字", "a", false},
		{"数字", "1", false},
		{"記号", "!", false},
		{"ひらがな", "あ", false},
		{"漢字", "字", false},
		{"絵文字 2 つ", "👍👎", false},
		{"絵文字と文字", "👍です", false},
		{"前後の空白", " 👍", false},
		{"改行", "👍\n", false},
		{"ゼロ幅スペースだけ", "\u200b", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := emoji.Valid(tt.in); got != tt.want {
				t.Errorf("Valid(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestValidRejectsLongInput(t *testing.T) {
	t.Parallel()

	// ZWJ で繋ぎすぎた「絵文字」。1 クラスタではあるが、保存する値としては長すぎる。
	long := strings.Repeat("👨‍", 12) + "👨"
	if len(long) <= emoji.MaxBytes {
		t.Fatalf("テストの前提が崩れている: len = %d", len(long))
	}
	if emoji.Valid(long) {
		t.Errorf("Valid(%d バイト) = true, want false", len(long))
	}
}
