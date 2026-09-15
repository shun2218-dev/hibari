package httpx

import (
	"context"
	"net/http"
	"net/netip"
	"strings"
)

// クライアント IP の決定（ADR 0017）。
//
// IP はレート制限・refresh_tokens.ip・アクセスログ・WebSocket のハンドシェイクで使う。それぞれが RemoteAddr や
// X-Forwarded-For を読むと、どこか 1 箇所だけ偽装した XFF を信用する、という事故が起きる。
// そこで、RemoteAddr と X-Forwarded-For を読むのは resolveClientIP だけにし、ミドルウェアが 1 回だけ求めて context に入れる。
// ハンドラは clientIPFrom で context から読む。

// clientIPKey は context のキー。
type clientIPKey struct{}

// TrustedProxies は、X-Forwarded-For を書き込むと信用してよい前段のプロキシのアドレス（TRUSTED_PROXIES）。
// 空なら XFF を一切読まない。設定を忘れても「全員が同じ IP として制限される」側に倒れ、「偽装で制限を逃れられる」側には倒れない。
type TrustedProxies []netip.Prefix

func (t TrustedProxies) contains(addr netip.Addr) bool {
	for _, p := range t {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// resolveClientIP はリクエストのクライアント IP を決める。分からなければ無効な値（netip.Addr{}）を返す。
//
//  1. RemoteAddr（TCP の接続元）が信頼するプロキシでなければ、それがクライアント。XFF は見ない（偽装できるため）。
//  2. 信頼するプロキシなら、XFF を右端から見ていき、信頼するプロキシのアドレスを飛ばして、最初に現れたそれ以外のアドレスをクライアントにする。
//     右端の 1 つを取るだけにしないのは、プロキシが多段（Fly のプロキシの後ろに別のプロキシ、など）になっても正しく求めるため。
//     右端から見るのは、左側はクライアントが自由に書けるから（信頼するプロキシは受け取った XFF の右に追記する）。
//  3. XFF の値が壊れていたら、そこより左は信用できないので、それまでに見た中で最も左の（クライアントに近い）信頼するアドレスを返す。
//     XFF が全部信頼するアドレスだった場合も同じ。
func resolveClientIP(r *http.Request, trusted TrustedProxies) netip.Addr {
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return netip.Addr{}
	}
	client := ap.Addr().Unmap()
	if len(trusted) == 0 || !trusted.contains(client) {
		return client
	}
	// ヘッダが複数行に分かれていても、つなげると 1 つのリストとして読める（RFC 9110 §5.3）。
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return client
		}
		client = hop.Unmap()
		if !trusted.contains(client) {
			return client
		}
	}
	return client
}

// withClientIP はクライアント IP を 1 回だけ求めて context に入れる。
func withClientIP(trusted TrustedProxies, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := resolveClientIP(r, trusted)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPKey{}, ip)))
	})
}

// clientIPFrom は withClientIP が求めたクライアント IP を返す。分からなければ無効な値。
func clientIPFrom(ctx context.Context) netip.Addr {
	ip, _ := ctx.Value(clientIPKey{}).(netip.Addr)
	return ip
}
