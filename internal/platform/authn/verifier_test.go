package authn_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

var now = time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)

const (
	issuer   = "hibari"
	audience = "hibari-api"
	kid      = "test-key"
)

// tokenSpec は検証を通る正しいトークンの内容。テストケースごとに 1 か所だけ壊す。
type tokenSpec struct {
	alg    jwa.SignatureAlgorithm
	key    any
	kid    string
	typ    string
	claims map[string]any
}

func validSpec(t *testing.T, priv ed25519.PrivateKey) tokenSpec {
	t.Helper()
	ids := id.NewGenerator(clock.NewFake(now), rand.Reader)
	return tokenSpec{
		alg: jwa.EdDSA(),
		key: priv,
		kid: kid,
		typ: authn.AccessTokenType,
		claims: map[string]any{
			jwt.SubjectKey:       ids.New().String(),
			authn.ClaimSessionID: ids.New().String(),
			jwt.JwtIDKey:         ids.New().String(),
			jwt.IssuerKey:        issuer,
			jwt.AudienceKey:      []string{audience},
			jwt.IssuedAtKey:      now,
			jwt.ExpirationKey:    now.Add(15 * time.Minute),
		},
	}
}

func sign(t *testing.T, s tokenSpec) string {
	t.Helper()
	tok := jwt.New()
	for k, v := range s.claims {
		if err := tok.Set(k, v); err != nil {
			t.Fatalf("set %s: %v", k, err)
		}
	}
	hdrs := jws.NewHeaders()
	if s.kid != "" {
		_ = hdrs.Set(jws.KeyIDKey, s.kid)
	}
	if s.typ != "" {
		_ = hdrs.Set(jws.TypeKey, s.typ)
	}
	b, err := jwt.Sign(tok, jwt.WithKey(s.alg, s.key, jws.WithProtectedHeaders(hdrs)))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return string(b)
}

func TestVerifier(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	_, otherPriv, _ := ed25519.GenerateKey(rand.Reader)
	clk := clock.NewFake(now)
	v := authn.NewVerifier([]authn.PublicKey{{ID: kid, Key: pub}}, issuer, audience, clk)

	tests := []struct {
		name   string
		mutate func(s *tokenSpec)
		ok     bool
	}{
		{name: "valid", mutate: func(*tokenSpec) {}, ok: true},
		{name: "expired", mutate: func(s *tokenSpec) { s.claims[jwt.ExpirationKey] = now.Add(-time.Second) }},
		{name: "not yet valid", mutate: func(s *tokenSpec) { s.claims[jwt.NotBeforeKey] = now.Add(time.Minute) }},
		{name: "wrong issuer", mutate: func(s *tokenSpec) { s.claims[jwt.IssuerKey] = "evil" }},
		{name: "wrong audience", mutate: func(s *tokenSpec) { s.claims[jwt.AudienceKey] = []string{"other-api"} }},
		{name: "missing exp", mutate: func(s *tokenSpec) { delete(s.claims, jwt.ExpirationKey) }},
		{name: "missing sid", mutate: func(s *tokenSpec) { delete(s.claims, authn.ClaimSessionID) }},
		{name: "sid is not a ULID", mutate: func(s *tokenSpec) { s.claims[authn.ClaimSessionID] = "session-1" }},
		{name: "sub is not a ULID", mutate: func(s *tokenSpec) { s.claims[jwt.SubjectKey] = "user@example.com" }},
		{name: "signed by another key with the same kid", mutate: func(s *tokenSpec) { s.key = otherPriv }},
		{name: "unknown kid", mutate: func(s *tokenSpec) { s.kid = "rotated-out" }},
		{name: "no kid", mutate: func(s *tokenSpec) { s.kid = "" }},
		// 同じ鍵で署名された、Access Token 以外の JWT を受け付けない。
		{name: "typ JWT", mutate: func(s *tokenSpec) { s.typ = "JWT" }},
		{name: "no typ", mutate: func(s *tokenSpec) { s.typ = "" }},
		// alg confusion: 公開鍵のバイト列を HMAC の鍵にした署名を受け付けない。
		{name: "HS256 with public key bytes", mutate: func(s *tokenSpec) { s.alg = jwa.HS256(); s.key = []byte(pub) }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := validSpec(t, priv)
			tt.mutate(&spec)
			raw := sign(t, spec)

			got, err := v.Verify(raw)
			if !tt.ok {
				if !errors.Is(err, authn.ErrInvalidToken) {
					t.Fatalf("Verify() error = %v, want ErrInvalidToken", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Verify() error = %v", err)
			}
			if got.UserID.String() != spec.claims[jwt.SubjectKey] || got.SessionID.String() != spec.claims[authn.ClaimSessionID] {
				t.Fatalf("Verify() = %+v, want sub/sid from the token", got)
			}
		})
	}

	t.Run("garbage", func(t *testing.T) {
		for _, raw := range []string{"", "abc", "a.b.c", "eyJhbGciOiJub25lIn0.e30."} {
			if _, err := v.Verify(raw); !errors.Is(err, authn.ErrInvalidToken) {
				t.Errorf("Verify(%q) error = %v, want ErrInvalidToken", raw, err)
			}
		}
	})
}

// 鍵のローテーション中は、新旧どちらの鍵で署名されたトークンも受け付ける。
func TestVerifierAcceptsAnyConfiguredKey(t *testing.T) {
	oldPub, oldPriv, _ := ed25519.GenerateKey(rand.Reader)
	newPub, newPriv, _ := ed25519.GenerateKey(rand.Reader)
	v := authn.NewVerifier([]authn.PublicKey{{ID: "old", Key: oldPub}, {ID: "new", Key: newPub}}, issuer, audience, clock.NewFake(now))

	for kid, priv := range map[string]ed25519.PrivateKey{"old": oldPriv, "new": newPriv} {
		spec := validSpec(t, priv)
		spec.kid = kid
		if _, err := v.Verify(sign(t, spec)); err != nil {
			t.Errorf("Verify(kid=%s) error = %v", kid, err)
		}
	}
}
