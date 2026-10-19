package webpush

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json/v2"
	"encoding/pem"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

func newP256Key(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func pemOf(t *testing.T, typ string, der []byte) []byte {
	t.Helper()
	return pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der})
}

func TestParseVAPIDKeyPEM(t *testing.T) {
	key := newP256Key(t)
	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	sec1, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	p384, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	p384DER, err := x509.MarshalPKCS8PrivateKey(p384)
	if err != nil {
		t.Fatal(err)
	}
	_, edKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	edDER, err := x509.MarshalPKCS8PrivateKey(edKey)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		pem  []byte
		ok   bool
	}{
		{"PKCS#8（make keys の形式）", pemOf(t, "PRIVATE KEY", pkcs8), true},
		{"SEC 1", pemOf(t, "EC PRIVATE KEY", sec1), true},
		{"P-384 は拒む", pemOf(t, "PRIVATE KEY", p384DER), false},
		{"Ed25519（JWT の鍵の取り違え）は拒む", pemOf(t, "PRIVATE KEY", edDER), false},
		{"公開鍵は拒む", pemOf(t, "PUBLIC KEY", []byte{0}), false},
		{"PEM でない", []byte("not a key"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseVAPIDKeyPEM(tt.pem)
			if tt.ok {
				if err != nil {
					t.Fatal(err)
				}
				if !got.Equal(key) {
					t.Error("parsed a different key")
				}
				return
			}
			if err == nil {
				t.Error("err = nil, want an error")
			}
		})
	}
}

func TestVAPIDToken(t *testing.T) {
	key := newP256Key(t)
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	endpoint, err := url.Parse("https://fcm.googleapis.com/fcm/send/abc:def")
	if err != nil {
		t.Fatal(err)
	}

	raw, err := vapidToken(key, endpoint, "mailto:ops@example.com", now)
	if err != nil {
		t.Fatal(err)
	}

	// 公開鍵だけで検証できる（プッシュのサービスは Authorization の k= の鍵で確かめる）。
	// 期限の検査は固定した時刻で別に見るので、ここでは署名だけを見る。
	tok, err := jwt.ParseString(raw, jwt.WithKey(jwa.ES256(), &key.PublicKey), jwt.WithValidate(false))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if aud, _ := tok.Audience(); len(aud) != 1 || aud[0] != "https://fcm.googleapis.com" {
		t.Errorf("aud = %v, want the endpoint's origin", aud)
	}
	if exp, _ := tok.Expiration(); !exp.Equal(now.Add(VAPIDTokenTTL)) {
		t.Errorf("exp = %v, want %v", exp, now.Add(VAPIDTokenTTL))
	}
	if sub, _ := tok.Subject(); sub != "mailto:ops@example.com" {
		t.Errorf("sub = %q", sub)
	}
	// 期限は RFC 8292 の上限（24 時間）の内側
	if VAPIDTokenTTL > 24*time.Hour {
		t.Errorf("VAPIDTokenTTL = %v exceeds 24h", VAPIDTokenTTL)
	}

	// 固定した時刻で、期限の内と外を確かめる
	for _, tc := range []struct {
		at   time.Time
		want bool
	}{
		{now.Add(VAPIDTokenTTL - time.Minute), true},
		{now.Add(VAPIDTokenTTL + time.Minute), false},
	} {
		_, err := jwt.ParseString(raw, jwt.WithKey(jwa.ES256(), &key.PublicKey), jwt.WithClock(jwt.ClockFunc(func() time.Time { return tc.at })))
		if (err == nil) != tc.want {
			t.Errorf("at %v: err = %v, want valid=%v", tc.at, err, tc.want)
		}
	}

	// ほかの鍵では検証できない
	if _, err := jwt.ParseString(raw, jwt.WithKey(jwa.ES256(), &newP256Key(t).PublicKey), jwt.WithValidate(false)); err == nil {
		t.Error("verified with a different key")
	}

	// aud は配列ではなく文字列、typ は JWT（RFC 8292 の例の形）
	parts := strings.Split(raw, ".")
	payload, err := b64.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	if _, ok := claims["aud"].(string); !ok {
		t.Errorf("aud = %#v, want a string", claims["aud"])
	}
	msg, err := jws.Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	hdr := msg.Signatures()[0].ProtectedHeaders()
	if typ, _ := hdr.Type(); typ != "JWT" {
		t.Errorf("typ = %q", typ)
	}
	if alg, _ := hdr.Algorithm(); alg != jwa.ES256() {
		t.Errorf("alg = %v", alg)
	}
}
