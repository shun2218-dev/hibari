package auth

import (
	"crypto/rand"
	"errors"
	"strings"
	"testing"
)

var testParams = PasswordParams{MemoryKiB: 64, Iterations: 1, Parallelism: 1, SaltLen: 16, KeyLen: 32}

func newTestHasher(t *testing.T, p PasswordParams) *PasswordHasher {
	t.Helper()
	h, err := NewPasswordHasher(p, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestPasswordHashAndCompare(t *testing.T) {
	h := newTestHasher(t, testParams)
	encoded, err := h.Hash("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(encoded, "$argon2id$v=19$m=64,t=1,p=1$") {
		t.Fatalf("hash = %q, want PHC string with the configured params", encoded)
	}

	tests := []struct {
		name     string
		password string
		encoded  *string
		want     bool
	}{
		{name: "correct password", password: "correct horse battery staple", encoded: &encoded, want: true},
		{name: "wrong password", password: "Correct horse battery staple", encoded: &encoded, want: false},
		{name: "empty password", password: "", encoded: &encoded, want: false},
		// ユーザーが存在しない場合。ダミーのハッシュで検証した上で false を返す。
		{name: "no stored hash", password: "correct horse battery staple", encoded: nil, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := h.Compare(tt.password, tt.encoded)
			if err != nil {
				t.Fatalf("Compare() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("Compare() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestPasswordHashUsesRandomSalt(t *testing.T) {
	h := newTestHasher(t, testParams)
	a, _ := h.Hash("same password")
	b, _ := h.Hash("same password")
	if a == b {
		t.Fatal("two hashes of the same password are identical; salt is not random")
	}
}

// パラメータはハッシュ文字列から読むので、後からコストを上げても既存のハッシュを検証できる。
func TestPasswordCompareUsesParamsFromHash(t *testing.T) {
	old := newTestHasher(t, testParams)
	encoded, _ := old.Hash("password123")

	stronger := testParams
	stronger.MemoryKiB = 128
	stronger.Iterations = 2
	ok, err := newTestHasher(t, stronger).Compare("password123", &encoded)
	if err != nil || !ok {
		t.Fatalf("Compare() = %v, %v; want true with params taken from the stored hash", ok, err)
	}
}

func TestPasswordCompareRejectsMalformedHash(t *testing.T) {
	h := newTestHasher(t, testParams)
	valid, _ := h.Hash("password123")
	parts := strings.Split(valid, "$")

	tests := map[string]string{
		"empty":            "",
		"bcrypt":           "$2a$10$abcdefghijklmnopqrstuv",
		"argon2i":          strings.Replace(valid, "argon2id", "argon2i", 1),
		"wrong version":    strings.Replace(valid, "v=19", "v=16", 1),
		"missing params":   strings.Join([]string{"", "argon2id", "v=19", "m=64", parts[4], parts[5]}, "$"),
		"zero memory":      strings.Replace(valid, "m=64", "m=0", 1),
		"huge memory":      strings.Replace(valid, "m=64", "m=4294967295", 1),
		"bad salt base64":  strings.Join([]string{"", "argon2id", "v=19", "m=64,t=1,p=1", "!!!", parts[5]}, "$"),
		"empty hash":       strings.Join([]string{"", "argon2id", "v=19", "m=64,t=1,p=1", parts[4], ""}, "$"),
		"too many $ parts": valid + "$extra",
	}
	for name, encoded := range tests {
		t.Run(name, func(t *testing.T) {
			ok, err := h.Compare("password123", &encoded)
			if ok || !errors.Is(err, errMalformedHash) {
				t.Fatalf("Compare() = %v, %v; want false, errMalformedHash", ok, err)
			}
		})
	}
}
