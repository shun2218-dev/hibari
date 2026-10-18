package auth

import (
	"net/mail"
	"net/url"
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
	// Next は email を検証したあとに Web が進む先（招待の画面など。ADR 0053 決定 3）。空なら載せない。
	Next string
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
	if reason := passwordProblem(in.Password); reason != "" {
		add("password", reason)
	}

	if reason := nextPathProblem(in.Next); reason != "" {
		add("next", reason)
	}

	if len(fields) > 0 {
		return RegisterInput{}, &ValidationError{Fields: fields}
	}
	return in, nil
}

// nextPathMaxBytes は戻り先の長さの上限。招待の URL（/invite/{code}）には十分で、メールのリンクを膨らませない。
const nextPathMaxBytes = 512

// nextPathProblem は戻り先（next）が使えない理由を返す。空か、使えるなら空文字列。
//
// 受け付けるのはアプリの中のパスだけ（`/` で始まり、別のホストを指さない）。確認メールのリンクに載るので、
// 外のサイトを指せると、hibari のメールを踏み台にしたオープンリダイレクトになる（ADR 0053 決定 3）。
// Web の safeNextPath も同じ規則で読み直すが、メールに載せる前に auth でも止める。
func nextPathProblem(next string) string {
	if next == "" {
		return ""
	}
	if len(next) > nextPathMaxBytes {
		return ReasonTooLong
	}
	// `//host` はスキーム相対の URL、`/\host` はブラウザが `//host` と読むので、どちらも外のホストになる。
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, "/\\") {
		return ReasonInvalidFormat
	}
	for _, r := range next {
		// 制御文字は URL の解釈をずらす余地があり、正しい戻り先には現れない。
		if r < 0x20 || r == 0x7f {
			return ReasonInvalidFormat
		}
	}
	u, err := url.Parse(next)
	if err != nil || u.Scheme != "" || u.Host != "" {
		return ReasonInvalidFormat
	}
	return ""
}

// passwordProblem はパスワードが制約を満たさない理由を返す。満たしていれば空文字列。
// 登録とパスワードの再設定で同じ制約を使う。
func passwordProblem(password string) string {
	n := utf8.RuneCountInString(password)
	switch {
	case password == "":
		return ReasonRequired
	case !utf8.ValidString(password):
		return ReasonInvalidFormat
	case n < passwordMinRunes:
		return ReasonTooShort
	case n > passwordMaxRunes:
		return ReasonTooLong
	}
	return ""
}

// isPlainEmail は s が「表示名や角括弧を含まない、アドレスだけ」の形式かを返す。
// 到達可能かどうかはメールの確認（verify-email）で確かめるので、ここでは形式だけを見る。
func isPlainEmail(s string) bool {
	addr, err := mail.ParseAddress(s)
	return err == nil && addr.Name == "" && addr.Address == s
}

// normalize はプロフィールの更新の入力を検証する。nil の項目は「変えない」なので検証しない。
func (in ProfileInput) normalize() (ProfileInput, error) {
	var fields []FieldError
	add := func(field, reason string) { fields = append(fields, FieldError{Field: field, Reason: reason}) }

	if in.Handle != nil {
		handle := strings.TrimSpace(*in.Handle)
		switch {
		case handle == "":
			add("handle", ReasonRequired)
		case !handlePattern.MatchString(handle):
			add("handle", ReasonInvalidFormat)
		}
		in.Handle = &handle
	}

	if in.DisplayName != nil {
		name := strings.TrimSpace(*in.DisplayName)
		switch {
		case name == "":
			add("display_name", ReasonRequired)
		case utf8.RuneCountInString(name) > displayNameMax:
			add("display_name", ReasonTooLong)
		case strings.ContainsFunc(name, unicode.IsControl):
			add("display_name", ReasonInvalidFormat)
		}
		in.DisplayName = &name
	}

	if len(fields) > 0 {
		return ProfileInput{}, &ValidationError{Fields: fields}
	}
	return in, nil
}
