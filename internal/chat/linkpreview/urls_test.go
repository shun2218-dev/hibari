package linkpreview

import (
	"encoding/json/v2"
	"net/url"
	"os"
	"slices"
	"testing"
)

// TestExtractURLsSharedCases は、Web の findUrls と同じ例（testdata/format/urls.json）で同じ結果になることを確かめる。
func TestExtractURLsSharedCases(t *testing.T) {
	data, err := os.ReadFile("../../../testdata/format/urls.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Name string   `json:"name"`
			Body string   `json:"body"`
			URLs []string `json:"urls"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			got := ExtractURLs(c.Body)
			if len(got) == 0 && len(c.URLs) == 0 {
				return
			}
			if !slices.Equal(got, c.URLs) {
				t.Errorf("ExtractURLs(%q) = %q, want %q", c.Body, got, c.URLs)
			}
		})
	}
}

func TestCandidates(t *testing.T) {
	app, _ := url.Parse("https://app.hibari-chat.com")
	tests := []struct {
		name string
		body string
		want []string
	}{
		{"URL がなければ何もない", "おはようございます", nil},
		{"同じ URL は 1 件にまとめる", "https://a.example/ https://b.example/ https://a.example/", []string{"https://a.example/", "https://b.example/"}},
		{
			"自分のアプリの URL は展開しない",
			"https://app.hibari-chat.com/w/01J8ZZZZZZZZZZZZZZZZZZZZZA/r/01J8ZZZZZZZZZZZZZZZZZZZZZB?m=01J8ZZZZZZZZZZZZZZZZZZZZZC と https://a.example/",
			[]string{"https://a.example/"},
		},
		{"LP（apex）は自分のアプリと別のオリジンなので展開する", "https://hibari-chat.com/", []string{"https://hibari-chat.com/"}},
		{"5 件までは展開する", "https://1.example/ https://2.example/ https://3.example/ https://4.example/ https://5.example/",
			[]string{"https://1.example/", "https://2.example/", "https://3.example/", "https://4.example/", "https://5.example/"}},
		// 数えるのはまとめる前の URL（Slack の「5 つより多いリンク」）。自分のアプリの URL も数える
		{"6 件あればどれも展開しない", "https://1.example/ https://2.example/ https://3.example/ https://4.example/ https://5.example/ https://1.example/", nil},
		{"コードの中の URL は数えない", "```\nhttps://1.example/ https://2.example/ https://3.example/ https://4.example/ https://5.example/\n``` https://6.example/", []string{"https://6.example/"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Candidates(tt.body, app); !slices.Equal(got, tt.want) {
				t.Errorf("Candidates = %q, want %q", got, tt.want)
			}
		})
	}
}
