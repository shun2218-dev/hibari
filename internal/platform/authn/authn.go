// Package authn は、リクエストが「誰の・どのセッションのものか」を確定させる。
//
// auth（トークンを発行する側）と chat（トークンを受け取る側）の接点はここに集める（ADR 0001 / 0007）。
//   - Access JWT の検証と、検証済みの userID / sid / email の検証の状態の context への格納
//   - email を検証していない利用者を止めるミドルウェア（ADR 0053）
//   - 失効イベント（Redis の auth:revoked）の形式、publish と購読
//
// chat は auth を import しないので、トークンの形式（クレーム名や typ）の知識もここに置き、
// auth はそれに合わせて発行する。
package authn

import (
	"context"

	"github.com/oklog/ulid/v2"
)

// Access JWT の形式。発行側（auth）と検証側（authn）で同じ定数を使う。
const (
	// AccessTokenType は JWS ヘッダの typ。RFC 9068 の値にして、
	// 同じ鍵で将来別の用途の JWT を署名しても Access Token として受け付けないようにする（RFC 8725 §3.11）。
	AccessTokenType = "at+jwt"
	// ClaimSessionID はセッション ID（refresh_tokens.family_id）のクレーム名（ADR 0007）。
	ClaimSessionID = "sid"
	// ClaimEmailVerified は email を検証済みかのクレーム名（ADR 0053 決定 2）。
	// OpenID Connect の ID Token と同じ名前にして、意味を取り違えないようにする。
	ClaimEmailVerified = "email_verified"
)

// Identity は検証済みのリクエストの主体。ロールや権限は含めない（DB を正とするため。CLAUDE.md）。
type Identity struct {
	UserID    ulid.ULID
	SessionID ulid.ULID
	// EmailVerified はトークンの発行の時点で email を検証済みだったか（ADR 0053 決定 2）。
	// 権限と違って JWT に入れてよいのは、検証が「未 → 済」の一方向で取り上げられず、
	// 古いトークンは「まだ止める」側にしか間違えないため。email を変える機能を足すときはこの前提を見直す。
	EmailVerified bool
}

// identityKey は context のキー。非公開の型にして、他のパッケージから偽の Identity を詰められないようにする。
type identityKey struct{}

// WithIdentity は id を詰めた context を返す。
// 検証を経ずに Identity を作れてしまうので、呼ぶのはこのパッケージのミドルウェアとテストだけにする。
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

// FromContext は検証済みの Identity を返す。認証を通っていないリクエストでは ok が false。
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok
}
