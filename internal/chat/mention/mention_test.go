package mention_test

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/mention"
)

func TestParse(t *testing.T) {
	t.Parallel()

	alice := ulid.MustParse("01J8ZZZZZZZZZZZZZZZZZZZZZA")
	bob := ulid.MustParse("01J8ZZZZZZZZZZZZZZZZZZZZZB")

	tests := []struct {
		name string
		body string
		want []mention.Mention
	}{
		{name: "メンションがない", body: "こんにちは", want: nil},
		{name: "空の本文", body: "", want: nil},
		{
			name: "個人",
			body: "<@" + alice.String() + "> おはよう",
			want: []mention.Mention{{Kind: mention.KindUser, UserID: alice}},
		},
		{
			name: "複数の人は出現順",
			body: "<@" + bob.String() + "> と <@" + alice.String() + ">",
			want: []mention.Mention{{Kind: mention.KindUser, UserID: bob}, {Kind: mention.KindUser, UserID: alice}},
		},
		{
			name: "同じ人を 2 回書いても 1 件",
			body: "<@" + alice.String() + "> <@" + alice.String() + ">",
			want: []mention.Mention{{Kind: mention.KindUser, UserID: alice}},
		},
		{
			name: "channel と here",
			body: "<!channel> と <!here>",
			want: []mention.Mention{{Kind: mention.KindChannel}, {Kind: mention.KindHere}},
		},
		{
			name: "同じ全員宛ても 1 件",
			body: "<!here> <!here>",
			want: []mention.Mention{{Kind: mention.KindHere}},
		},
		{
			name: "混在",
			body: "<!channel> <@" + alice.String() + "> です",
			want: []mention.Mention{{Kind: mention.KindChannel}, {Kind: mention.KindUser, UserID: alice}},
		},
		{
			name: "改行や記号に挟まれていても見つける",
			body: "（<@" + alice.String() + ">）\n<!here>、よろしく",
			want: []mention.Mention{{Kind: mention.KindUser, UserID: alice}, {Kind: mention.KindHere}},
		},
		// 読めないトークンは、ただの文字列として無視する（エラーにしない）。
		{name: "26 文字でない", body: "<@01J8> <@" + alice.String() + "X>", want: nil},
		{name: "ULID にない文字（I / L / O / U）", body: "<@01J8IIIIIIIIIIIIIIIIIIIIII>", want: nil},
		{name: "桁あふれ", body: "<@ZZZZZZZZZZZZZZZZZZZZZZZZZZ>", want: nil},
		{name: "閉じていない", body: "<@" + alice.String(), want: nil},
		{name: "@ を素で書いただけ", body: "@alice @channel @here", want: nil},
		{name: "知らない全員宛て", body: "<!everyone>", want: nil},
		{
			// 小文字で書かれても同じ人として扱う（クライアントが小文字にしても壊れない）。
			name: "小文字の ID",
			body: "<@" + strings.ToLower(alice.String()) + ">",
			want: []mention.Mention{{Kind: mention.KindUser, UserID: alice}},
		},
		{
			// コードの中の同じ人を先に書いても、コードの外の出現で 1 件になる
			name: "コードの中はメンションにしない",
			body: "`<@" + alice.String() + ">` <@" + bob.String() + "> <@" + alice.String() + ">",
			want: []mention.Mention{{Kind: mention.KindUser, UserID: bob}, {Kind: mention.KindUser, UserID: alice}},
		},
		{
			name: "大文字と小文字の同じ ID は 1 件",
			body: "<@" + alice.String() + "> <@" + strings.ToLower(alice.String()) + ">",
			want: []mention.Mention{{Kind: mention.KindUser, UserID: alice}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := mention.Parse(tt.body)
			if len(got) != len(tt.want) {
				t.Fatalf("Parse(%q) = %v, want %v", tt.body, got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("Parse(%q)[%d] = %v, want %v", tt.body, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestUserIDsAndHas(t *testing.T) {
	t.Parallel()

	alice := ulid.MustParse("01J8ZZZZZZZZZZZZZZZZZZZZZA")
	ms := mention.Parse("<!channel> <@" + alice.String() + ">")

	ids := mention.UserIDs(ms)
	if len(ids) != 1 || ids[0] != alice {
		t.Errorf("UserIDs = %v, want [%v]", ids, alice)
	}
	if !mention.Has(ms, mention.KindChannel) {
		t.Error("Has(channel) = false, want true")
	}
	if mention.Has(ms, mention.KindHere) {
		t.Error("Has(here) = true, want false")
	}
	if mention.UserIDs(nil) != nil {
		t.Error("UserIDs(nil) is not nil")
	}
}

// TestParseSharedCases は、Web の解釈と共通の例（testdata/format/mentions.json）で、コードの範囲の規則がそろっていることを確かめる（ADR 0051 決定 5）。
func TestParseSharedCases(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "format", "mentions.json"))
	if err != nil {
		t.Fatalf("read shared cases: %v", err)
	}
	var file struct {
		Cases []struct {
			Name     string   `json:"name"`
			Body     string   `json:"body"`
			Mentions []string `json:"mentions"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("decode shared cases: %v", err)
	}
	if len(file.Cases) == 0 {
		t.Fatal("no shared cases")
	}
	for _, tc := range file.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			t.Parallel()
			got := []string{}
			for _, m := range mention.Parse(tc.Body) {
				got = append(got, token(m))
			}
			if strings.Join(got, " ") != strings.Join(tc.Mentions, " ") {
				t.Errorf("Parse(%q) = %v, want %v", tc.Body, got, tc.Mentions)
			}
		})
	}
}

// token は Mention を本文のトークンの形に戻す。
func token(m mention.Mention) string {
	if m.Kind == mention.KindUser {
		return "<@" + m.UserID.String() + ">"
	}
	return "<!" + string(m.Kind) + ">"
}
