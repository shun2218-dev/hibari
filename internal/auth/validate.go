package auth

import (
	"net/mail"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// RegisterInput は登録の入力。
type RegisterInput struct {
	Handle      string
	DisplayName string
	Email       string
	Password    string
}

// 入力の制約。
const (
	// パスワードの長さの下限は NIST SP 800-63B に合わせる。文字種の組み合わせは強制しない。
	passwordMinRunes = 8
	// 上限は、極端に長い入力でハッシュの計算に時間を使わせないため。パスフレーズには十分な長さにする。
	passwordMaxRunes = 128
	displayNameMax   = 50
	// RFC 5321 のパスの上限。
	emailMaxBytes = 254
)

// handlePattern は @メンションに使うので、区切りと紛らわしい記号を含めない。
// 大文字小文字は区別せずに一意にする（users.handle は citext）。
var handlePattern = regexp.MustCompile(`^[A-Za-z0-9_]{3,32}$`)

// normalize は入力を検証し、前後の空白を除いた値を返す。
// エラーは最初の 1 つで止めず、すべての項目についてまとめて返す（フォームで一度に表示できるように）。
func (in RegisterInput) normalize() (RegisterInput, error) {
	var fields []FieldError
	add := func(field, reason string) { fields = append(fields, FieldError{Field: field, Reason: reason}) }

	in.Handle = strings.TrimSpace(in.Handle)
	switch {
	case in.Handle == "":
		add("handle", ReasonRequired)
	case !handlePattern.MatchString(in.Handle):
		add("handle", ReasonInvalidFormat)
	}

	in.DisplayName = strings.TrimSpace(in.DisplayName)
	switch {
	case in.DisplayName == "":
		add("display_name", ReasonRequired)
	case utf8.RuneCountInString(in.DisplayName) > displayNameMax:
		add("display_name", ReasonTooLong)
	case strings.ContainsFunc(in.DisplayName, unicode.IsControl):
		add("display_name", ReasonInvalidFormat)
	}

	in.Email = strings.TrimSpace(in.Email)
	switch {
	case in.Email == "":
		add("email", ReasonRequired)
	case len(in.Email) > emailMaxBytes:
		add("email", ReasonTooLong)
	case !isPlainEmail(in.Email):
		add("email", ReasonInvalidFormat)
	}

	// パスワードは空白も含めて利用者が選んだ値なので、トリムしない。
	n := utf8.RuneCountInString(in.Password)
	switch {
	case in.Password == "":
		add("password", ReasonRequired)
	case !utf8.ValidString(in.Password):
		add("password", ReasonInvalidFormat)
	case n < passwordMinRunes:
		add("password", ReasonTooShort)
	case n > passwordMaxRunes:
		add("password", ReasonTooLong)
	}

	if len(fields) > 0 {
		return RegisterInput{}, &ValidationError{Fields: fields}
	}
	return in, nil
}

// isPlainEmail は s が「表示名や角括弧を含まない、アドレスだけ」の形式かを返す。
// 到達可能かどうかはメールの確認（Phase 2 の verify-email）で確かめるので、ここでは形式だけを見る。
func isPlainEmail(s string) bool {
	addr, err := mail.ParseAddress(s)
	return err == nil && addr.Name == "" && addr.Address == s
}
