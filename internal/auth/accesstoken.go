package auth

import (
	"crypto"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json/v2"
	"encoding/pem"
	"errors"
	"fmt"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// AccessTokenTTL は Access Token の有効期限。
// 失効が REST に反映されるまでの最大の遅れでもある（ADR 0007）。
const AccessTokenTTL = 15 * time.Minute

// ParseEd25519PrivateKeyPEM は PKCS#8 の PEM（`make keys` の openssl genpkey が出力する形式）から署名鍵を読む。
//
// EdDSA（Ed25519）にするのは、鍵が 32 バイトと小さく、署名・検証が速く、
// RSA のようにパディングや鍵長の選択を誤る余地がないため。
func ParseEd25519PrivateKeyPEM(b []byte) (ed25519.PrivateKey, error) {
	block, _ := pem.Decode(b)
	if block == nil || block.Type != "PRIVATE KEY" {
		return nil, errors.New("jwt signing key: expected a PEM block of type PRIVATE KEY (PKCS#8)")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("jwt signing key: %w", err)
	}
	ed, ok := k.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("jwt signing key: expected Ed25519, got %T", k)
	}
	return ed, nil
}

// AccessTokenIssuer は Access JWT を発行する。検証は authn.Verifier が公開鍵だけで行う。
type AccessTokenIssuer struct {
	privateKey ed25519.PrivateKey
	publicKey  authn.PublicKey
	issuer     string
	audience   string
	clock      clock.Clock
	ids        id.Generator
}

// NewAccessTokenIssuer は AccessTokenIssuer を返す。
func NewAccessTokenIssuer(privateKey ed25519.PrivateKey, issuer, audience string, clk clock.Clock, ids id.Generator) (*AccessTokenIssuer, error) {
	pub, ok := privateKey.Public().(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("jwt signing key: cannot derive public key")
	}
	kid, err := keyID(pub)
	if err != nil {
		return nil, err
	}
	return &AccessTokenIssuer{
		privateKey: privateKey,
		publicKey:  authn.PublicKey{ID: kid, Key: pub},
		issuer:     issuer,
		audience:   audience,
		clock:      clk,
		ids:        ids,
	}, nil
}

// keyID は公開鍵の JWK Thumbprint（RFC 7638）を kid にする。
// 鍵から決まる値なので、複数台のサーバーが設定なしで同じ kid を使い、鍵を替えれば kid も必ず変わる。
func keyID(pub ed25519.PublicKey) (string, error) {
	k, err := jwk.Import(pub)
	if err != nil {
		return "", fmt.Errorf("import public key: %w", err)
	}
	tp, err := k.Thumbprint(crypto.SHA256)
	if err != nil {
		return "", fmt.Errorf("thumbprint: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(tp), nil
}

// PublicKey は検証用の公開鍵を返す。同じプロセスの authn.Verifier に渡す。
func (i *AccessTokenIssuer) PublicKey() authn.PublicKey {
	return i.publicKey
}

// Issue は userID のセッション sid に対する Access Token を発行する。
//
// クレームは sub / sid / jti / iat / exp / iss / aud だけ。ロールや権限は入れない
// （JWT は失効できないので、入れると権限の変更が有効期限まで反映されなくなる。CLAUDE.md）。
func (i *AccessTokenIssuer) Issue(userID, sid ulid.ULID) (string, time.Time, error) {
	now := i.clock.Now()
	exp := now.Add(AccessTokenTTL)
	tok, err := jwt.NewBuilder().
		Subject(userID.String()).
		Issuer(i.issuer).
		Audience([]string{i.audience}).
		IssuedAt(now).
		Expiration(exp).
		// jti は現時点では検証に使わない。将来の拒否リスト（ADR 0007 の代替案）とログの突き合わせのために入れる。
		JwtID(i.ids.New().String()).
		Claim(authn.ClaimSessionID, sid.String()).
		Build()
	if err != nil {
		return "", time.Time{}, fmt.Errorf("build access token: %w", err)
	}

	hdrs := jws.NewHeaders()
	if err := hdrs.Set(jws.KeyIDKey, i.publicKey.ID); err != nil {
		return "", time.Time{}, fmt.Errorf("set kid: %w", err)
	}
	if err := hdrs.Set(jws.TypeKey, authn.AccessTokenType); err != nil {
		return "", time.Time{}, fmt.Errorf("set typ: %w", err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.EdDSA(), i.privateKey, jws.WithProtectedHeaders(hdrs)))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return string(signed), exp, nil
}

// JWKS は公開鍵を JWK Set（RFC 7517）の JSON にして返す。/.well-known/jwks.json で公開する。
// 今は同じプロセスで検証するので使わないが、auth を別プロセスに切り出したときに
// chat 側が鍵を取得する経路になる（ADR 0001）。
func (i *AccessTokenIssuer) JWKS() ([]byte, error) {
	k, err := jwk.Import(i.publicKey.Key)
	if err != nil {
		return nil, fmt.Errorf("import public key: %w", err)
	}
	for name, v := range map[string]any{
		jwk.KeyIDKey:     i.publicKey.ID,
		jwk.AlgorithmKey: jwa.EdDSA(),
		jwk.KeyUsageKey:  jwk.ForSignature,
	} {
		if err := k.Set(name, v); err != nil {
			return nil, fmt.Errorf("set %s: %w", name, err)
		}
	}
	set := jwk.NewSet()
	if err := set.AddKey(k); err != nil {
		return nil, fmt.Errorf("add key: %w", err)
	}
	b, err := json.Marshal(set)
	if err != nil {
		return nil, fmt.Errorf("marshal jwks: %w", err)
	}
	return b, nil
}
