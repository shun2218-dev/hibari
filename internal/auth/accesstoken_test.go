package auth_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jws"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

func newIssuer(t *testing.T) (*auth.AccessTokenIssuer, *clock.Fake, ed25519.PublicKey) {
	t.Helper()
	clk := clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	iss, err := auth.NewAccessTokenIssuer(priv, "hibari", "hibari-api", clk, id.NewGenerator(clk, rand.Reader))
	if err != nil {
		t.Fatal(err)
	}
	return iss, clk, pub
}

// 発行したトークンを authn.Verifier が受け付け、15 分で期限切れになる。
func TestAccessTokenIssueAndVerify(t *testing.T) {
	iss, clk, _ := newIssuer(t)
	ids := id.NewGenerator(clk, rand.Reader)
	userID, sid := ids.New(), ids.New()

	raw, exp, err := iss.Issue(userID, sid)
	if err != nil {
		t.Fatal(err)
	}
	if want := clk.Now().Add(15 * time.Minute); !exp.Equal(want) {
		t.Errorf("expiresAt = %v, want %v", exp, want)
	}

	msg, err := jws.Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	h := msg.Signatures()[0].ProtectedHeaders()
	if typ, _ := h.Type(); typ != authn.AccessTokenType {
		t.Errorf("typ = %q, want %q", typ, authn.AccessTokenType)
	}
	if kid, _ := h.KeyID(); kid != iss.PublicKey().ID {
		t.Errorf("kid = %q, want %q", kid, iss.PublicKey().ID)
	}

	// ロールや権限のクレームを入れていないこと（CLAUDE.md）。
	var claims map[string]any
	if err := json.Unmarshal(msg.Payload(), &claims); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"sub", "sid", "jti", "iat", "exp", "iss", "aud"} {
		if _, ok := claims[k]; !ok {
			t.Errorf("claim %q is missing", k)
		}
	}
	if len(claims) != 7 {
		t.Errorf("claims = %v, want exactly sub/sid/jti/iat/exp/iss/aud", claims)
	}

	v := authn.NewVerifier([]authn.PublicKey{iss.PublicKey()}, "hibari", "hibari-api", clk)
	got, err := v.Verify(raw)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if got.UserID != userID || got.SessionID != sid {
		t.Fatalf("Verify() = %+v, want user %s sid %s", got, userID, sid)
	}

	clk.Advance(15*time.Minute - time.Second)
	if _, err := v.Verify(raw); err != nil {
		t.Fatalf("Verify() just before expiry: %v", err)
	}
	clk.Advance(time.Second)
	if _, err := v.Verify(raw); !errors.Is(err, authn.ErrInvalidToken) {
		t.Fatalf("Verify() at expiry = %v, want ErrInvalidToken", err)
	}
}

func TestJWKSPublishesOnlyThePublicKey(t *testing.T) {
	iss, _, pub := newIssuer(t)
	b, err := iss.JWKS()
	if err != nil {
		t.Fatal(err)
	}
	var set struct {
		Keys []map[string]string `json:"keys"`
	}
	if err := json.Unmarshal(b, &set); err != nil {
		t.Fatalf("jwks is not JSON: %v", err)
	}
	if len(set.Keys) != 1 {
		t.Fatalf("keys = %v, want 1 key", set.Keys)
	}
	k := set.Keys[0]
	want := map[string]string{
		"kty": "OKP", "crv": "Ed25519", "alg": "EdDSA", "use": "sig",
		"kid": iss.PublicKey().ID,
		"x":   base64.RawURLEncoding.EncodeToString(pub),
	}
	for name, v := range want {
		if k[name] != v {
			t.Errorf("jwk[%q] = %q, want %q", name, k[name], v)
		}
	}
	if _, ok := k["d"]; ok {
		t.Fatal("jwks leaks the private key (d)")
	}
}

// kid は公開鍵の Thumbprint なので、同じ鍵なら同じ値、別の鍵なら別の値になる。
func TestAccessTokenKeyIDIsDerivedFromKey(t *testing.T) {
	clk := clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC))
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	a, _ := auth.NewAccessTokenIssuer(priv, "i", "a", clk, id.NewGenerator(clk, rand.Reader))
	b, _ := auth.NewAccessTokenIssuer(priv, "i", "a", clk, id.NewGenerator(clk, rand.Reader))
	other, _, _ := newIssuer(t)
	if a.PublicKey().ID != b.PublicKey().ID {
		t.Error("same key produced different kids")
	}
	if a.PublicKey().ID == other.PublicKey().ID {
		t.Error("different keys produced the same kid")
	}
}

func TestParseEd25519PrivateKeyPEM(t *testing.T) {
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	edDER, _ := x509.MarshalPKCS8PrivateKey(edKey)
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 1024)
	rsaDER, _ := x509.MarshalPKCS8PrivateKey(rsaKey)

	tests := []struct {
		name    string
		pem     []byte
		wantErr string
	}{
		{name: "ed25519 pkcs8", pem: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: edDER})},
		{name: "not pem", pem: []byte("hello"), wantErr: "PEM"},
		{name: "public key block", pem: pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: edDER}), wantErr: "PRIVATE KEY"},
		{name: "rsa key", pem: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: rsaDER}), wantErr: "expected Ed25519"},
		{name: "broken der", pem: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte{1, 2, 3}}), wantErr: "jwt signing key"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := auth.ParseEd25519PrivateKeyPEM(tt.pem)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !got.Equal(edKey) {
				t.Fatal("parsed key differs from the original")
			}
		})
	}
}
