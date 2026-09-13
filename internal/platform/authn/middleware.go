package authn

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ErrMissingToken は Authorization ヘッダに Bearer トークンがないことを表す。
var ErrMissingToken = errors.New("authn: missing bearer token")

// UnauthorizedFunc は認証に失敗したときのレスポンスを書く。
// レスポンスの形式（problem+json）は httpx の責務なので、authn は書き方を知らずに呼び出し側から受け取る。
type UnauthorizedFunc func(w http.ResponseWriter, r *http.Request, err error)

// Require は Bearer の Access Token を検証し、Identity を context に詰めてから next を呼ぶ。
//
// トークンは Authorization ヘッダからだけ読む。クエリ文字列や Cookie からは読まない。
// URL はアクセスログやブラウザの履歴に残り、Cookie は CSRF の対象になるため（CLAUDE.md、ADR 0010）。
func Require(v *Verifier, unauthorized UnauthorizedFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, err := bearerToken(r)
			if err != nil {
				unauthorized(w, r, err)
				return
			}
			id, err := v.Verify(raw)
			if err != nil {
				unauthorized(w, r, err)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithIdentity(r.Context(), id)))
		})
	}
}

func bearerToken(r *http.Request) (string, error) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return "", ErrMissingToken
	}
	// 認証スキーム名は大文字小文字を区別しない（RFC 9110 §11.1）。
	scheme, token, ok := strings.Cut(h, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", fmt.Errorf("%w: malformed authorization header", ErrInvalidToken)
	}
	return token, nil
}
