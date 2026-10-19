package webpush

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
)

// RFC 8291（Web Push のペイロードの暗号化）を、RFC 8188 の aes128gcm で書く。
//
// 1 つの通知は 1 つのレコードに収める。プッシュのサービスが受ける本文は 4096 バイトまで（RFC 8030 の 7.2 が「少なくとも」と
// 定める値で、FCM・Mozilla・Apple はちょうどそこで切る）なので、複数のレコードに分ける場面がない。

const (
	saltLen = 16
	// recordSize は RFC 8188 のヘッダの rs。1 レコードしか送らないので、受け手が受け付ける値でありさえすればよい。
	// RFC 8291 の例と同じ 4096 にする（付録 A のテストベクタとヘッダがバイト単位で一致する）。
	recordSize = 4096
	// headerLen は salt(16) + rs(4) + idlen(1) + keyid（送り手の公開鍵、非圧縮の 65）。
	headerLen = saltLen + 4 + 1 + 65
	tagLen    = 16
	// maxBody はプッシュのサービスが受ける本文の上限。
	maxBody = 4096
	// MaxPayload は暗号化する前のペイロードの上限。ヘッダ・GCM のタグ・区切りの 1 バイトを引いた残り。
	MaxPayload = maxBody - headerLen - tagLen - 1
)

// ErrPayloadTooLarge は、ペイロードが MaxPayload を超えていることを表す。呼ぶ側は本文を短くして作り直す。
var ErrPayloadTooLarge = errors.New("webpush: payload too large")

// ErrInvalidSubscription は、購読の鍵（p256dh / auth）が Web Push の形をしていないことを表す。
var ErrInvalidSubscription = errors.New("webpush: invalid subscription keys")

// encrypt は plaintext を、購読の鍵（uaPublic = p256dh、authSecret = auth）に向けて暗号化した本文を返す。
// 送り手の一時鍵と salt は毎回作る。同じ鍵と salt を使い回すと、AES-GCM の鍵とノンスの組が繰り返されてしまう。
func encrypt(uaPublic, authSecret, plaintext []byte) ([]byte, error) {
	asPrivate, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("webpush: generate ephemeral key: %w", err)
	}
	salt := make([]byte, saltLen)
	_, _ = rand.Read(salt) // crypto/rand.Read は失敗しない（Go 1.24 から）
	return encryptWith(uaPublic, authSecret, plaintext, asPrivate, salt)
}

// encryptWith は encrypt の本体。送り手の鍵と salt を外から渡せるのは、RFC 8291 の付録 A のテストベクタで確かめるため。
func encryptWith(uaPublic, authSecret, plaintext []byte, asPrivate *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(plaintext) > MaxPayload {
		return nil, ErrPayloadTooLarge
	}
	if len(authSecret) != 16 {
		return nil, fmt.Errorf("%w: auth must be 16 bytes", ErrInvalidSubscription)
	}
	// NewPublicKey は点が P-256 の曲線の上にあるかを確かめる（RFC 8291 の 7 章が求める検査）。
	// 曲線の外の点を受け入れると、鍵の共有の結果から送り手の秘密鍵を推し量られうる。
	ua, err := ecdh.P256().NewPublicKey(uaPublic)
	if err != nil {
		return nil, fmt.Errorf("%w: p256dh: %w", ErrInvalidSubscription, err)
	}
	ecdhSecret, err := asPrivate.ECDH(ua)
	if err != nil {
		return nil, fmt.Errorf("webpush: ecdh: %w", err)
	}
	asPublic := asPrivate.PublicKey().Bytes()

	// RFC 8291 の 3.4: 鍵の共有の結果と auth を混ぜて IKM を作る。info に両者の公開鍵を入れ、鍵をすり替えられないようにする。
	keyInfo := make([]byte, 0, 14+65+65)
	keyInfo = append(keyInfo, "WebPush: info\x00"...)
	keyInfo = append(keyInfo, uaPublic...)
	keyInfo = append(keyInfo, asPublic...)
	ikm, err := hkdf.Key(sha256.New, ecdhSecret, authSecret, string(keyInfo), 32)
	if err != nil {
		return nil, fmt.Errorf("webpush: derive ikm: %w", err)
	}
	// RFC 8188 の 2.2 と 2.3: salt で CEK とノンスを作る。
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, fmt.Errorf("webpush: extract prk: %w", err)
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, fmt.Errorf("webpush: derive cek: %w", err)
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, fmt.Errorf("webpush: derive nonce: %w", err)
	}

	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, fmt.Errorf("webpush: aes: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("webpush: gcm: %w", err)
	}

	out := make([]byte, 0, headerLen+len(plaintext)+1+tagLen)
	out = append(out, salt...)
	out = binary.BigEndian.AppendUint32(out, recordSize)
	out = append(out, byte(len(asPublic)))
	out = append(out, asPublic...)
	// 最後のレコードの区切りは 0x02（RFC 8188 の 2）。長さを隠す詰め物は足さない。
	// 通知の長さはプッシュのサービスに見えるが、本文の中身ほどの情報ではない（ADR 0069 の範囲外）。
	record := make([]byte, 0, len(plaintext)+1)
	record = append(record, plaintext...)
	record = append(record, 0x02)
	return gcm.Seal(out, nonce, record, nil), nil
}
