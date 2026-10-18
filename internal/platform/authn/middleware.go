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

// ErrEmailUnverified は、email を検証していない利用者が、検証を要する API を呼んだことを表す（ADR 0053 決定 1）。
var ErrEmailUnverified = errors.New("authn: email is not verified")

// ForbiddenFunc は認証は済んだが先へ進ませないときのレスポンスを書く。形式を知らないのは UnauthorizedFunc と同じ理由。
type ForbiddenFunc func(w http.ResponseWriter, r *http.Request, err error)

// RequireVerifiedEmail は、email を検証していない利用者を止める（ADR 0053 決定 1）。Require の内側に置く。
//
// 判定をここ 1 か所に置くのは、chat のコードに検証の知識を持たせないため（CLAUDE.md ルール 1 と 9）。
// httpx が chat のルートと ws-ticket の発行に付ける。API ごとに選ばせると、足した API で付け忘れる。
//
// enforce が false のときは止めない（開発環境だけ。ADR 0053 決定 4）。外してよいかは設定の読み込みで確かめる。
func RequireVerifiedEmail(enforce bool, forbidden ForbiddenFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if !enforce {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, ok := FromContext(r.Context())
			if !ok {
				// Require の外に置いたプログラムの誤り。通さない側に倒す。
				panic("authn: RequireVerifiedEmail must be used inside Require")
			}
			if !id.EmailVerified {
				forbidden(w, r, ErrEmailUnverified)
				return
			}
			next.ServeHTTP(w, r)
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
