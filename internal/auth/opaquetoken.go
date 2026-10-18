package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
)

// opaqueTokenBytes は Refresh Token（と Phase 2 のワンタイムトークン）の乱数のバイト数。
// 256 ビットあれば総当たりは現実的でないので、照合は DB の UNIQUE インデックスを引くだけでよい。
const opaqueTokenBytes = 32

// newOpaqueToken は、クライアントに渡す生の値と、DB に保存する SHA-256 ハッシュを返す。
//
// 生の値は保存しない（CLAUDE.md）。DB が漏れても、そこからトークンを使うことはできない。
// パスワードと違って乱数なので、Argon2id のような遅いハッシュは要らない（辞書攻撃が成り立たない）。
func newOpaqueToken(random io.Reader) (raw string, hash []byte, err error) {
	b := make([]byte, opaqueTokenBytes)
	if _, err := io.ReadFull(random, b); err != nil {
		return "", nil, fmt.Errorf("read random: %w", err)
	}
	// URL・Cookie・JSON のどこに置いてもエスケープが要らない base64url にする。
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, hashOpaqueToken(raw), nil
}

// hashOpaqueToken はクライアントから受け取った生の値を、照合用のハッシュにする。
func hashOpaqueToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}
