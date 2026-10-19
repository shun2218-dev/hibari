package webpush

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

// VAPIDTokenTTL は VAPID の JWT の有効期限。RFC 8292 の 2 は 24 時間を超えてはならないとする。
// 上限ちょうどにすると、こちらとプッシュのサービスの時計のずれで「24 時間より先」と読まれうるので、半分の 12 時間にする。
const VAPIDTokenTTL = 12 * time.Hour

// ParseVAPIDKeyPEM は P-256 の秘密鍵を PEM から読む。
//
// `make keys` の `openssl genpkey -algorithm EC` が出力する PKCS#8（PRIVATE KEY）に加えて、
// `openssl ecparam -genkey` などが出す SEC 1（EC PRIVATE KEY）も受ける。本番の秘密をどちらで作っても置けるようにするため。
func ParseVAPIDKeyPEM(b []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, errors.New("vapid key: no PEM block")
	}
	var key *ecdsa.PrivateKey
	switch block.Type {
	case "PRIVATE KEY":
		k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("vapid key: %w", err)
		}
		ek, ok := k.(*ecdsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("vapid key: expected ECDSA P-256, got %T", k)
		}
		key = ek
	case "EC PRIVATE KEY":
		k, err := x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("vapid key: %w", err)
		}
		key = k
	default:
		return nil, fmt.Errorf("vapid key: unexpected PEM block type %q", block.Type)
	}
	// RFC 8292 の 3.2 は P-256 だけを定める。ほかの曲線の鍵で署名すると、プッシュのサービスがすべて拒む。
	if key.Curve != elliptic.P256() {
		return nil, fmt.Errorf("vapid key: expected curve P-256, got %s", key.Curve.Params().Name)
	}
	return key, nil
}

// publicKeyBytes は公開鍵の非圧縮の形（65 バイト）。Authorization の k= と、ブラウザの applicationServerKey に使う。
func publicKeyBytes(key *ecdsa.PrivateKey) ([]byte, error) {
	ek, err := key.PublicKey.ECDH()
	if err != nil {
		return nil, fmt.Errorf("vapid key: %w", err)
	}
	return ek.Bytes(), nil
}

// vapidToken は endpoint に送るための VAPID の JWT（RFC 8292 の 2）を作る。
//
// aud は endpoint のオリジン（スキームとホスト）。パスを含めないのは、プッシュのサービスがオリジンだけを見るため。
// オリジンごとに 1 つの JWT でよいが、送るたびに作る（署名は 1 回の P-256 の計算で、通知の頻度では負担にならない。
// 使い回すと、オリジンごとの JWT と期限を持つ可変の状態が要る）。
func vapidToken(key *ecdsa.PrivateKey, endpoint *url.URL, subject string, now time.Time) (string, error) {
	tok, err := jwt.NewBuilder().
		Audience([]string{endpoint.Scheme + "://" + endpoint.Host}).
		Expiration(now.Add(VAPIDTokenTTL)).
		Subject(subject).
		Build()
	if err != nil {
		return "", fmt.Errorf("vapid: build token: %w", err)
	}
	// aud を配列ではなく文字列で出す。RFC 8292 の例どおりの形にする（配列を受け付けるかは RFC が保証していない）。
	tok.Options().Enable(jwt.FlattenAudience)

	hdrs := jws.NewHeaders()
	if err := hdrs.Set(jws.TypeKey, "JWT"); err != nil {
		return "", fmt.Errorf("vapid: set typ: %w", err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.ES256(), key, jws.WithProtectedHeaders(hdrs)))
	if err != nil {
		return "", fmt.Errorf("vapid: sign: %w", err)
	}
	return string(signed), nil
}

// b64 は Web Push の鍵の表し方（RFC 8292 の 3.2、Push API の applicationServerKey）。詰め物のない base64url。
var b64 = base64.RawURLEncoding
