package webpush

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
)

// RFC 8291 の 5 章と付録 A の例。base64url の値は RFC のまま（折り返しの空白だけ除いた）。
const (
	rfcPlaintext = "When I grow up, I want to be a watermelon"
	rfcASPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
	rfcASPublic  = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
	rfcUAPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
	rfcUAPublic  = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
	rfcSalt      = "DGv6ra1nlYgDCS1FRnbzlw"
	rfcAuth      = "BTBZMqHH6r4Tts7J_aSIgg"
	rfcBody      = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
		"mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
		"pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
)

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := b64.DecodeString(s)
	if err != nil {
		t.Fatalf("decode %q: %v", s, err)
	}
	return b
}

func TestEncryptMatchesRFC8291Example(t *testing.T) {
	asPrivate, err := ecdh.P256().NewPrivateKey(mustB64(t, rfcASPrivate))
	if err != nil {
		t.Fatal(err)
	}
	// 入力の取り違えを先に見つける（送り手の公開鍵は秘密鍵から決まる）
	if got := b64.EncodeToString(asPrivate.PublicKey().Bytes()); got != rfcASPublic {
		t.Fatalf("as_public = %s, want %s", got, rfcASPublic)
	}

	got, err := encryptWith(mustB64(t, rfcUAPublic), mustB64(t, rfcAuth), []byte(rfcPlaintext), asPrivate, mustB64(t, rfcSalt))
	if err != nil {
		t.Fatal(err)
	}
	if want := mustB64(t, rfcBody); !bytes.Equal(got, want) {
		t.Errorf("body =\n%s\nwant\n%s", b64.EncodeToString(got), rfcBody)
	}
}

// decrypt は受け手（ブラウザ）の側の復号。RFC 8291 の付録 A とは別に、毎回作る一時鍵と salt の道を確かめるのに使う。
func decrypt(t *testing.T, uaPrivate *ecdh.PrivateKey, authSecret, body []byte) []byte {
	t.Helper()
	if len(body) < headerLen {
		t.Fatalf("body is %d bytes, shorter than the header", len(body))
	}
	salt := body[:saltLen]
	if rs := binary.BigEndian.Uint32(body[saltLen : saltLen+4]); rs != recordSize {
		t.Fatalf("rs = %d", rs)
	}
	if idlen := body[saltLen+4]; idlen != 65 {
		t.Fatalf("idlen = %d", idlen)
	}
	asPublicRaw := body[saltLen+5 : headerLen]
	asPublic, err := ecdh.P256().NewPublicKey(asPublicRaw)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := uaPrivate.ECDH(asPublic)
	if err != nil {
		t.Fatal(err)
	}
	info := "WebPush: info\x00" + string(uaPrivate.PublicKey().Bytes()) + string(asPublicRaw)
	ikm, _ := hkdf.Key(sha256.New, secret, authSecret, info, 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	record, err := gcm.Open(nil, nonce, body[headerLen:], nil)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if len(record) == 0 || record[len(record)-1] != 0x02 {
		t.Fatalf("record does not end with the last-record delimiter: %x", record)
	}
	return record[:len(record)-1]
}

func TestEncryptRoundTripsWithFreshKeyAndSalt(t *testing.T) {
	uaPrivate, err := ecdh.P256().NewPrivateKey(mustB64(t, rfcUAPrivate))
	if err != nil {
		t.Fatal(err)
	}
	auth := mustB64(t, rfcAuth)
	plaintext := []byte(`{"title":"hibari"}`)

	first, err := encrypt(uaPrivate.PublicKey().Bytes(), auth, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	second, err := encrypt(uaPrivate.PublicKey().Bytes(), auth, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	// 同じ入力でも、一時鍵と salt が毎回変わる（鍵とノンスの組を繰り返さない）
	if bytes.Equal(first[:headerLen], second[:headerLen]) {
		t.Error("salt and ephemeral key were reused")
	}
	for _, body := range [][]byte{first, second} {
		if got := decrypt(t, uaPrivate, auth, body); !bytes.Equal(got, plaintext) {
			t.Errorf("decrypted = %q, want %q", got, plaintext)
		}
	}
}

func TestEncryptLimitsAndValidatesKeys(t *testing.T) {
	uaPublic := mustB64(t, rfcUAPublic)
	auth := mustB64(t, rfcAuth)

	t.Run("上限ちょうどは本文が 4096 バイトに収まる", func(t *testing.T) {
		body, err := encrypt(uaPublic, auth, bytes.Repeat([]byte("a"), MaxPayload))
		if err != nil {
			t.Fatal(err)
		}
		if len(body) != maxBody {
			t.Errorf("len = %d, want %d", len(body), maxBody)
		}
	})
	t.Run("上限を超えると ErrPayloadTooLarge", func(t *testing.T) {
		if _, err := encrypt(uaPublic, auth, bytes.Repeat([]byte("a"), MaxPayload+1)); !errors.Is(err, ErrPayloadTooLarge) {
			t.Errorf("err = %v", err)
		}
	})

	offCurve := bytes.Clone(uaPublic)
	offCurve[len(offCurve)-1] ^= 0x01 // y を 1 ビット変えると曲線から外れる
	for name, tc := range map[string]struct{ p256dh, auth []byte }{
		"auth が 16 バイトでない":     {uaPublic, auth[:15]},
		"p256dh が短い":           {uaPublic[:64], auth},
		"p256dh が圧縮の形":         {append([]byte{0x02}, uaPublic[1:33]...), auth},
		"p256dh が曲線の上にない":      {offCurve, auth},
		"p256dh が無限遠点":         {[]byte{0x00}, auth},
		"p256dh の先頭が 0x04 でない": {append([]byte{0x05}, uaPublic[1:]...), auth},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := encrypt(tc.p256dh, tc.auth, []byte("x"))
			if !errors.Is(err, ErrInvalidSubscription) {
				t.Errorf("err = %v, want ErrInvalidSubscription", err)
			}
			if err != nil && strings.Contains(err.Error(), b64.EncodeToString(tc.p256dh)) {
				t.Error("error contains the key")
			}
		})
	}
}
