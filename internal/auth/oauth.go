package auth

import "context"

// OAuthProvider は外部の IdP（Google / GitHub）との Authorization Code Flow + PKCE（RFC 7636）の境界。
//
// Phase 2 ではインターフェースだけを置き、実装とエンドポイントは Phase 7 以降に作る。
// 先に形を決めておくのは、oauth_accounts テーブルと合わせて「どの情報を IdP から受け取り、
// 何を根拠にアカウントを紐付けるか」を固定しておくため。
type OAuthProvider interface {
	// Name は oauth_accounts.provider に入れる値（"google" / "github"）。
	Name() string
	// AuthCodeURL は認可リクエストの URL を返す。
	// state は CSRF 対策、codeChallenge は code_verifier の S256 ハッシュ。どちらもサーバー側で生成して保持する。
	AuthCodeURL(state, codeChallenge string) string
	// Exchange は認可コードをトークンに交換し、IdP 上の利用者の情報を返す。
	Exchange(ctx context.Context, code, codeVerifier string) (ExternalIdentity, error)
}

// ExternalIdentity は IdP から受け取った利用者の情報。
type ExternalIdentity struct {
	// AccountID は IdP 上で不変の ID（oauth_accounts.provider_account_id）。email は変わりうるので紐付けの根拠にしない。
	AccountID string
	Email     string
	// EmailVerified が false の email を根拠に、既存のアカウントへ自動で紐付けてはいけない（CLAUDE.md）。
	// 他人の email を未検証のまま IdP に登録するだけで、そのアカウントを乗っ取れてしまうため。
	EmailVerified bool
}
