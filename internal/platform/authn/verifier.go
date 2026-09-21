package authn

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
)

// ErrInvalidToken は Access Token が無い・壊れている・期限切れ・署名が合わないなどで受け付けられないことを表す。
// 理由の詳細は %w で包むが、クライアントには区別して返さない（攻撃者に手がかりを与えないため）。
var ErrInvalidToken = errors.New("authn: invalid access token")

// PublicKey は検証に使う公開鍵。ID は JWS ヘッダの kid と一致させる。
type PublicKey struct {
	ID  string
	Key ed25519.PublicKey
}

// Verifier は Access JWT を検証する。
//
// 検証は公開鍵だけでローカルに完結させ、DB にも Redis にも問い合わせない（ADR 0007）。
// そのため失効は最大で有効期限（15 分）まで REST に反映されない。
type Verifier struct {
	keys     map[string]ed25519.PublicKey
	issuer   string
	audience string
	clock    clock.Clock
}

// NewVerifier は Verifier を返す。keys に複数の鍵を渡せるのは、鍵のローテーション中に
// 古い鍵で署名されたトークンも有効期限までは受け付けるため。
func NewVerifier(keys []PublicKey, issuer, audience string, clk clock.Clock) *Verifier {
	m := make(map[string]ed25519.PublicKey, len(keys))
	for _, k := range keys {
		m[k.ID] = k.Key
	}
	return &Verifier{keys: m, issuer: issuer, audience: audience, clock: clk}
}

// Verify は raw を検証し、主体を返す。
func (v *Verifier) Verify(raw string) (Identity, error) {
	tok, err := jwt.ParseString(raw,
		jwt.WithKeyProvider(jws.KeyProviderFunc(v.provideKey)),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		// exp / iat / nbf の判定にも注入した Clock を使う。テストで「16 分後」を time.Sleep なしで作るため。
		jwt.WithClock(jwt.ClockFunc(v.clock.Now)),
		jwt.WithRequiredClaim(jwt.SubjectKey),
		jwt.WithRequiredClaim(jwt.ExpirationKey),
		jwt.WithRequiredClaim(ClaimSessionID),
	)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	sub, _ := tok.Subject()
	userID, err := ulid.ParseStrict(sub)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: sub: %w", ErrInvalidToken, err)
	}
	var sidStr string
	if err := tok.Get(ClaimSessionID, &sidStr); err != nil {
		return Identity{}, fmt.Errorf("%w: sid: %w", ErrInvalidToken, err)
	}
	sid, err := ulid.ParseStrict(sidStr)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: sid: %w", ErrInvalidToken, err)
	}
	// email_verified は必須にしない。無ければ未検証として扱う（止める側に倒す）。
	// クレームを足す前に発行されたトークン（最大 15 分）も、これで読める。
	var verified bool
	if tok.Has(ClaimEmailVerified) {
		if err := tok.Get(ClaimEmailVerified, &verified); err != nil {
			return Identity{}, fmt.Errorf("%w: %s: %w", ErrInvalidToken, ClaimEmailVerified, err)
		}
	}
	return Identity{UserID: userID, SessionID: sid, EmailVerified: verified}, nil
}

// provideKey は、ヘッダの内容を検査してから検証に使う鍵を 1 つだけ渡す。
//
// alg はヘッダの値を信じて選ばず、EdDSA に固定する。ヘッダの alg に従うと、
// "none" や、公開鍵を HMAC の秘密鍵として使わせる攻撃（alg confusion）の余地が生まれるため。
func (v *Verifier) provideKey(_ context.Context, sink jws.KeySink, sig *jws.Signature, _ *jws.Message) error {
	h := sig.ProtectedHeaders()
	if typ, _ := h.Type(); typ != AccessTokenType {
		return fmt.Errorf("unexpected typ %q", typ)
	}
	if alg, _ := h.Algorithm(); alg.String() != jwa.EdDSA().String() {
		return fmt.Errorf("unexpected alg %q", alg)
	}
	kid, _ := h.KeyID()
	key, ok := v.keys[kid]
	if !ok {
		return fmt.Errorf("unknown kid %q", kid)
	}
	sink.Key(jwa.EdDSA(), key)
	return nil
}
