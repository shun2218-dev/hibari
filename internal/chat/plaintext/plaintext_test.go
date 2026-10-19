package plaintext

import (
	"encoding/json/v2"
	"os"
	"slices"
	"testing"
)

// TestRenderSharedCases は、Web の plainText と同じ例（testdata/format/plaintext.json）で同じ平文になることを確かめる。
// タブの通知とプッシュ通知で本文の見え方が違わないようにするため（ADR 0069 決定 7）。
func TestRenderSharedCases(t *testing.T) {
	data, err := os.ReadFile("../../../testdata/format/plaintext.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Name     string            `json:"name"`
			Body     string            `json:"body"`
			Users    map[string]string `json:"users"`
			Channels map[string]string `json:"channels"`
			Text     string            `json:"text"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			got := Render(c.Body, Names{Users: c.Users, Channels: c.Channels})
			if got != c.Text {
				t.Errorf("Render(%q) = %q, want %q", c.Body, got, c.Text)
			}
		})
	}
}

func TestChannelIDs(t *testing.T) {
	const a, b = "01J8ZZZZZZZZZZZZZZZZZZZZZA", "01J8ZZZZZZZZZZZZZZZZZZZZZB"
	tests := []struct {
		name string
		body string
		want []string
	}{
		{"なし", "ただの文", nil},
		{"出てきた順", "<#" + b + "> と <#" + a + ">", []string{b, a}},
		{"引用と書式の中も", "> *<#" + a + ">*", []string{a}},
		{"コードの中は含めない", "`<#" + a + ">` と ```\n<#" + b + ">\n```", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ChannelIDs(tt.body); !slices.Equal(got, tt.want) {
				t.Errorf("ChannelIDs(%q) = %v, want %v", tt.body, got, tt.want)
			}
		})
	}
}

// 表に置かない（Web の結果が JavaScript の文字の数え方に依る）が、壊れた入力で panic しないことだけを確かめる。
func TestRenderDoesNotPanicOnEdges(t *testing.T) {
	for _, body := range []string{"*", "_", "__", "`", "<", "h", "http://", "*\xff*", "> ", "- ", "```", "``````", "a\r\n- b\r"} {
		_ = Render(body, Names{})
	}
}
