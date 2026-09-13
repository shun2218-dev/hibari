package auth

import (
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
)

// PasswordParams は Argon2id のコストパラメータ。
type PasswordParams struct {
	MemoryKiB   uint32
	Iterations  uint32
	Parallelism uint8
	SaltLen     int
	KeyLen      uint32
}

// DefaultPasswordParams は OWASP Password Storage Cheat Sheet の Argon2id の推奨値
// （m=19 MiB, t=2, p=1）。
//
// メモリを大きくするほど GPU での総当たりに強くなるが、ログインが同時に来ると
// その回数分のメモリを使う。1 台の小さなサーバーで動かす前提で、推奨の下限にしている。
// パラメータはハッシュ文字列に埋め込まれるので、後から上げても既存のハッシュは検証できる。
var DefaultPasswordParams = PasswordParams{
	MemoryKiB:   19 * 1024,
	Iterations:  2,
	Parallelism: 1,
	SaltLen:     16,
	KeyLen:      32,
}

// PasswordHasher はパスワードを Argon2id でハッシュし、PHC 文字列形式
// （$argon2id$v=19$m=...,t=...,p=...$salt$hash）で保存する。
type PasswordHasher struct {
	params PasswordParams
	random io.Reader
	// dummyHash は、存在しないユーザーのログインでも同じ時間をかけて検証するためのハッシュ。
	dummyHash string
}

// NewPasswordHasher は PasswordHasher を返す。random には本番で crypto/rand.Reader を渡す。
func NewPasswordHasher(params PasswordParams, random io.Reader) (*PasswordHasher, error) {
	h := &PasswordHasher{params: params, random: random}
	dummy, err := h.Hash("dummy password for timing equalization")
	if err != nil {
		return nil, err
	}
	h.dummyHash = dummy
	return h, nil
}

// Hash は password のハッシュを返す。
func (h *PasswordHasher) Hash(password string) (string, error) {
	salt := make([]byte, h.params.SaltLen)
	if _, err := io.ReadFull(h.random, salt); err != nil {
		return "", fmt.Errorf("read salt: %w", err)
	}
	p := h.params
	key := argon2.IDKey([]byte(password), salt, p.Iterations, p.MemoryKiB, p.Parallelism, p.KeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.MemoryKiB, p.Iterations, p.Parallelism,
		b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// Compare は password が encoded に一致するかを返す。
//
// encoded が nil（ユーザーが存在しない、または OAuth だけのユーザー）でもダミーのハッシュで検証してから false を返す。
// すぐに false を返すと、応答時間の差でアカウントの有無が判別できてしまう（CLAUDE.md「エラーハンドリング」）。
func (h *PasswordHasher) Compare(password string, encoded *string) (bool, error) {
	if encoded == nil {
		_, _ = h.compare(password, h.dummyHash)
		return false, nil
	}
	return h.compare(password, *encoded)
}

// b64 は PHC 文字列形式の Base64（パディングなしの標準アルファベット）。
var b64 = base64.RawStdEncoding

var errMalformedHash = errors.New("auth: malformed password hash")

// maxMemoryKiB は、保存されたハッシュのパラメータとして受け付けるメモリの上限。
// 壊れた（または改ざんされた）値で巨大なメモリを確保してプロセスを落とさないため。
const maxMemoryKiB = 1024 * 1024

func (h *PasswordHasher) compare(password, encoded string) (bool, error) {
	// "", "argon2id", "v=19", "m=..,t=..,p=..", salt, hash
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return false, errMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errMalformedHash
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || m == 0 || m > maxMemoryKiB || t == 0 || p == 0 {
		return false, errMalformedHash
	}
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false, errMalformedHash
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, errMalformedHash
	}
	got := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(want)))
	// 比較にかかる時間から一致したバイト数を推測されないよう、定数時間で比較する。
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
