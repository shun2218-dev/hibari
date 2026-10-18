// Package auth は認証ドメイン（登録・ログイン・トークンの発行とローテーション）。
//
// HTTP の知識は持たない。エラーは sentinel error / 型付きエラーで返し、
// HTTP ステータスへの変換は internal/httpx が行う（CLAUDE.md「エラーハンドリング」）。
// Refresh Token を Cookie とボディのどちらで受け渡すかも httpx の関心事で、ここでは生の文字列として扱う（ADR 0010）。
package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth/store"
)

var (
	// ErrInvalidCredentials は email かパスワードが違うことを表す。
	// どちらが違ったのか（アカウントが存在するのか）は区別しない。
	ErrInvalidCredentials = errors.New("auth: invalid credentials")
	// ErrInvalidRefreshToken は Refresh Token が存在しない・期限切れ・失効済みであることを表す。
	ErrInvalidRefreshToken = errors.New("auth: invalid refresh token")
	// ErrHandleTaken は handle がすでに使われていることを表す。
	ErrHandleTaken = errors.New("auth: handle already taken")
	// ErrEmailTaken は email がすでに使われていることを表す。
	// 登録では email の存在を明かす（ADR 0010）。ログインとパスワードリセットでは明かさない。
	ErrEmailTaken = errors.New("auth: email already taken")
	// ErrUserNotFound はユーザーが存在しない（または退会済み）ことを表す。
	ErrUserNotFound = errors.New("auth: user not found")
)

// ValidationError は入力値の検証エラー。どの項目がなぜ不正かをまとめて返す。
type ValidationError struct {
	Fields []FieldError
}

// FieldError は 1 項目の検証エラー。Reason はクライアントが文言を選ぶための機械可読な値。
type FieldError struct {
	Field  string
	Reason string
}

// FieldError.Reason の値。
const (
	ReasonRequired      = "required"
	ReasonTooShort      = "too_short"
	ReasonTooLong       = "too_long"
	ReasonInvalidFormat = "invalid_format"
	// ReasonInvalidValue は形式は正しいが、受け付けない値（許可していない Content-Type など）。
	ReasonInvalidValue = "invalid_value"
	// ReasonOutOfRange は範囲の外（サイズの上限、件数の上限）。
	ReasonOutOfRange = "out_of_range"
)

func (e *ValidationError) Error() string {
	parts := make([]string, len(e.Fields))
	for i, f := range e.Fields {
		parts[i] = f.Field + ": " + f.Reason
	}
	return fmt.Sprintf("auth: invalid input (%s)", strings.Join(parts, ", "))
}

// User は認証ドメインから見たユーザー。
type User struct {
	ID            ulid.ULID
	Handle        string
	DisplayName   string
	Email         string
	EmailVerified bool
	// AvatarURL は署名付きの GET URL。画像がなければ空（頭文字のアバターを出す。ADR 0020）。
	AvatarURL string
	CreatedAt time.Time
}

func toUser(u store.User) User {
	return User{
		ID:            u.ID,
		Handle:        u.Handle,
		DisplayName:   u.DisplayName,
		Email:         u.Email,
		EmailVerified: u.EmailVerifiedAt != nil,
		CreatedAt:     u.CreatedAt,
	}
}
