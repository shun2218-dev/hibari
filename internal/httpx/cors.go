package httpx

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// CORS の設定（ADR 0021）。
//
// Web クライアント（Next.js）はブラウザから API を直接呼ぶ。Next.js を経由させないのは、
// Route Handler にビジネスロジックを置かず（CLAUDE.md）、レート制限に使うクライアント IP をそのまま取るため。
const (
	// corsAllowMethods は ServeMux に登録しているメソッド。
	corsAllowMethods = "GET, POST, PATCH, DELETE"
	// corsAllowHeaders はクライアントが付けるヘッダ。X-Hibari-Client は Refresh Token を Cookie で受け渡す合図（ADR 0010）。
	corsAllowHeaders = "Authorization, Content-Type, X-Hibari-Client"
	// corsExposeHeaders は JS から読ませるヘッダ。どちらも CORS の既定では読めない。
	// X-Request-Id は問い合わせの手がかりに、Retry-After はレート制限のあとの再試行の間隔に使う。
	corsExposeHeaders = "X-Request-Id, Retry-After"
	// corsMaxAge はプリフライトの結果をブラウザに覚えさせる時間。Chromium は 2 時間で打ち切る。
	corsMaxAge = 2 * time.Hour
)

// OriginOf は URL のオリジン（scheme://host[:port]）を返す。Origin ヘッダと同じ表記にする。
func OriginOf(u *url.URL) string {
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

// withCORS は、許可したオリジンからのリクエストにだけ CORS のヘッダを付ける。
//
//   - 許可するのは完全に一致するオリジンだけ。ワイルドカードや前方一致にしない。
//     Access-Control-Allow-Credentials を付ける（Refresh Token の Cookie のため）ので、`*` は使えないうえ、
//     第三者のページから Cookie 付きで refresh / logout を呼べてしまう。
//   - 許可していないオリジンには何も付けない。ブラウザがレスポンスを JS に渡さないだけで、サーバーの処理は変わらない。
//     CSRF を防ぐのは CORS ではなく、プリフライトが必要なヘッダと Content-Type の強制（ADR 0010）。
//   - プリフライト（OPTIONS）は ServeMux に登録していないので、ここで 204 を返して終える。
func withCORS(allowed []string, next http.Handler) http.Handler {
	origins := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		origins[strings.ToLower(o)] = struct{}{}
	}
	maxAge := strconv.Itoa(int(corsMaxAge.Seconds()))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			// ネイティブアプリや curl。CORS は関係しない。
			next.ServeHTTP(w, r)
			return
		}

		h := w.Header()
		// Origin によってレスポンスのヘッダが変わるので、共有キャッシュに別のオリジンの結果を使わせない。
		h.Add("Vary", "Origin")
		_, ok := origins[strings.ToLower(origin)]

		preflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
		if preflight {
			h.Add("Vary", "Access-Control-Request-Method")
			h.Add("Vary", "Access-Control-Request-Headers")
			if ok {
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Set("Access-Control-Allow-Methods", corsAllowMethods)
				h.Set("Access-Control-Allow-Headers", corsAllowHeaders)
				h.Set("Access-Control-Max-Age", maxAge)
			}
			// 許可しないオリジンにも 204 を返す。ヘッダがないのでブラウザが本体のリクエストを送らない。
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if ok {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Expose-Headers", corsExposeHeaders)
		}
		next.ServeHTTP(w, r)
	})
}
