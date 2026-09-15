package httpx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
)

func prefixes(s ...string) TrustedProxies {
	out := make(TrustedProxies, len(s))
	for i, p := range s {
		out[i] = netip.MustParsePrefix(p)
	}
	return out
}

func TestResolveClientIP(t *testing.T) {
	// ローカルの Caddy を 1 台だけ信頼する構成と、Fly のプロキシ（172.16.0.0/12 と fdaa::/16）の構成（docs/deploy.md）。
	caddy := prefixes("172.28.0.10/32")
	fly := prefixes("172.16.0.0/12", "fdaa::/16", "203.0.113.7/32")

	tests := []struct {
		name       string
		remoteAddr string
		xff        []string // X-Forwarded-For の各行
		trusted    TrustedProxies
		want       string // 空なら無効な値
	}{
		{
			name:       "TRUSTED_PROXIES が空なら XFF があっても無視する",
			remoteAddr: "172.28.0.10:40000",
			xff:        []string{"198.51.100.1"},
			trusted:    nil,
			want:       "172.28.0.10",
		},
		{
			name:       "信頼していない接続元からの偽装した XFF は採用しない",
			remoteAddr: "198.51.100.99:40000",
			xff:        []string{"192.0.2.1"},
			trusted:    caddy,
			want:       "198.51.100.99",
		},
		{
			name:       "信頼するプロキシ経由ならクライアント IP を取る",
			remoteAddr: "172.28.0.10:40000",
			xff:        []string{"198.51.100.1"},
			trusted:    caddy,
			want:       "198.51.100.1",
		},
		{
			// クライアントが先頭に偽の値を書いても、信頼するプロキシが右に追記したアドレスが使われる。
			name:       "クライアントが書いた左側の値は使わない",
			remoteAddr: "172.28.0.10:40000",
			xff:        []string{"192.0.2.1, 198.51.100.1"},
			trusted:    caddy,
			want:       "198.51.100.1",
		},
		{
			// 右端がアプリ自身の IP（Fly）、その左がプロキシの内部アドレス、でも飛ばしてクライアントに届く。
			name:       "右端から信頼するアドレスを飛ばす（多段）",
			remoteAddr: "[fdaa:0:1::3]:40000",
			xff:        []string{"192.0.2.1, 198.51.100.1, 172.16.5.4", "203.0.113.7"},
			trusted:    fly,
			want:       "198.51.100.1",
		},
		{
			name:       "IPv6 のクライアント",
			remoteAddr: "172.28.0.10:40000",
			xff:        []string{" 2001:db8::1 "},
			trusted:    caddy,
			want:       "2001:db8::1",
		},
		{
			name:       "IPv4-mapped の表記は IPv4 にそろえる",
			remoteAddr: "[::ffff:172.28.0.10]:40000",
			xff:        []string{"::ffff:198.51.100.1"},
			trusted:    caddy,
			want:       "198.51.100.1",
		},
		{
			name:       "信頼するプロキシ経由でも XFF がなければプロキシのアドレス",
			remoteAddr: "172.28.0.10:40000",
			trusted:    caddy,
			want:       "172.28.0.10",
		},
		{
			// 壊れた値より左は信用できない。制限が緩む側に倒さず、最後に信用できたアドレスを使う。
			name:       "壊れた値に当たったら、それまでに見た信頼するアドレス",
			remoteAddr: "[fdaa:0:1::3]:40000",
			xff:        []string{"198.51.100.1, not-an-ip, 172.16.5.4"},
			trusted:    fly,
			want:       "172.16.5.4",
		},
		{
			name:       "ポート付きの値は壊れた値として扱う",
			remoteAddr: "172.28.0.10:40000",
			xff:        []string{"198.51.100.1:1234"},
			trusted:    caddy,
			want:       "172.28.0.10",
		},
		{
			name:       "XFF が全部信頼するアドレスなら、最も左のもの",
			remoteAddr: "[fdaa:0:1::3]:40000",
			xff:        []string{"172.16.9.9, 172.16.5.4"},
			trusted:    fly,
			want:       "172.16.9.9",
		},
		{
			name:       "RemoteAddr が読めなければ分からない",
			remoteAddr: "@",
			xff:        []string{"198.51.100.1"},
			trusted:    caddy,
			want:       "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = tt.remoteAddr
			for _, v := range tt.xff {
				r.Header.Add("X-Forwarded-For", v)
			}
			got := resolveClientIP(r, tt.trusted)
			var want netip.Addr
			if tt.want != "" {
				want = netip.MustParseAddr(tt.want)
			}
			if got != want {
				t.Fatalf("resolveClientIP() = %v, want %v", got, want)
			}
		})
	}
}

// アクセスログは、ハンドラと同じ（withClientIP が求めた）クライアント IP を出す。
func TestAccessLogUsesResolvedClientIP(t *testing.T) {
	clk := clock.NewFake(time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC))
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	var seen netip.Addr
	h := withClientIP(prefixes("172.28.0.10/32"), withAccessLog(logger, clk, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = clientIPFrom(r.Context())
	})))

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "172.28.0.10:40000"
	r.Header.Set("X-Forwarded-For", "198.51.100.1")
	h.ServeHTTP(httptest.NewRecorder(), r)

	var entry struct {
		ClientIP string `json:"client_ip"`
	}
	if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
		t.Fatalf("log is not JSON: %v", err)
	}
	if entry.ClientIP != "198.51.100.1" || seen != netip.MustParseAddr("198.51.100.1") {
		t.Fatalf("log client_ip = %q, handler saw %v, want 198.51.100.1 for both", entry.ClientIP, seen)
	}
}
