package httpx

import (
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/auth"
)

// Refresh Token の受け渡し方法の分岐は、このファイルだけに閉じ込める（CLAUDE.md ルール 2、ADR 0010）。
//
//   - Web（X-Hibari-Client: web）: httpOnly Cookie。JavaScript から読めないので、XSS で盗まれない
//   - それ以外（ネイティブアプリ、curl）: JSON ボディ。安全な保存先（Keychain など）はクライアントが選ぶ
//
// 認証ドメイン（internal/auth）は、どちらで届いたかを知らずに生のトークン文字列だけを扱う。
const (
	clientHeader    = "X-Hibari-Client"
	clientWeb       = "web"
	refreshCookie   = "hibari_refresh"
	refreshCookieAt = "/api/v1/auth"
)

// refreshTokenTransport は Refresh Token をリクエストから読み、レスポンスに載せる。
type refreshTokenTransport interface {
	// read はリクエストから Refresh Token を取り出す。見つからなければ空文字列を返す。
	read(w http.ResponseWriter, r *http.Request) (string, error)
	// write は s の Refresh Token をレスポンスに載せる。ボディ方式なら resp のフィールドを埋める。
	write(w http.ResponseWriter, resp *tokenResponse, s auth.Session)
	// clear はクライアントに保存された Refresh Token を消させる。
	clear(w http.ResponseWriter)
}

// transportFor はリクエストに応じた受け渡し方法を返す。
//
// 判定には Cookie の有無ではなく明示的なヘッダを使う。ログインの時点では Cookie はまだないのと、
// カスタムヘッダ付きのリクエストは CORS のプリフライトなしに他のオリジンから送れないので、
// Cookie で refresh する経路の CSRF 対策を兼ねるため（SameSite=Strict と二重にする）。
func transportFor(r *http.Request, cookieSecure bool) refreshTokenTransport {
	if r.Header.Get(clientHeader) == clientWeb {
		return cookieTransport{secure: cookieSecure}
	}
	return bodyTransport{}
}

type cookieTransport struct {
	secure bool
}

func (cookieTransport) read(_ http.ResponseWriter, r *http.Request) (string, error) {
	// Cookie がないのはエラーではなく「トークンなし」として扱い、判断はドメインに任せる。
	if c, err := r.Cookie(refreshCookie); err == nil {
		return c.Value, nil
	}
	return "", nil
}

func (t cookieTransport) write(w http.ResponseWriter, _ *tokenResponse, s auth.Session) {
	http.SetCookie(w, &http.Cookie{
		Name:  refreshCookie,
		Value: s.RefreshToken,
		// refresh と logout にだけ送らせる。他の API のリクエストに毎回載せない。
		Path:     refreshCookieAt,
		MaxAge:   int(auth.RefreshTokenTTL / time.Second),
		HttpOnly: true,
		// ローカルの http://localhost でもブラウザは Secure の Cookie を扱えるので、既定は true。
		Secure:   t.secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func (t cookieTransport) clear(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Path:     refreshCookieAt,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   t.secure,
		SameSite: http.SameSiteStrictMode,
	})
}

type bodyTransport struct{}

type refreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (bodyTransport) read(w http.ResponseWriter, r *http.Request) (string, error) {
	var req refreshTokenRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return "", err
	}
	return req.RefreshToken, nil
}

func (bodyTransport) write(_ http.ResponseWriter, resp *tokenResponse, s auth.Session) {
	resp.RefreshToken = s.RefreshToken
	exp := s.RefreshTokenExpiresAt
	resp.RefreshTokenExpiresAt = &exp
}

func (bodyTransport) clear(http.ResponseWriter) {}
