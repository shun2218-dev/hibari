package auth

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestRegisterInputNormalize(t *testing.T) {
	valid := RegisterInput{Handle: "naoki_01", DisplayName: "佐藤 直樹", Email: "naoki@example.com", Password: "password"}
	with := func(f func(*RegisterInput)) RegisterInput {
		in := valid
		f(&in)
		return in
	}

	tests := []struct {
		name       string
		in         RegisterInput
		want       RegisterInput
		wantFields []FieldError
	}{
		{name: "valid", in: valid, want: valid},
		{
			name: "trims surrounding spaces except password",
			in: RegisterInput{
				Handle: " naoki_01 ", DisplayName: "  佐藤 直樹\t", Email: " naoki@example.com\n", Password: " password ",
			},
			want: RegisterInput{Handle: "naoki_01", DisplayName: "佐藤 直樹", Email: "naoki@example.com", Password: " password "},
		},
		{
			name: "all missing are reported together",
			in:   RegisterInput{},
			wantFields: []FieldError{
				{"handle", ReasonRequired}, {"display_name", ReasonRequired}, {"email", ReasonRequired}, {"password", ReasonRequired},
			},
		},
		{name: "handle too short", in: with(func(in *RegisterInput) { in.Handle = "ab" }), wantFields: []FieldError{{"handle", ReasonInvalidFormat}}},
		{name: "handle too long", in: with(func(in *RegisterInput) { in.Handle = strings.Repeat("a", 33) }), wantFields: []FieldError{{"handle", ReasonInvalidFormat}}},
		{name: "handle with symbol", in: with(func(in *RegisterInput) { in.Handle = "naoki.sato" }), wantFields: []FieldError{{"handle", ReasonInvalidFormat}}},
		{name: "handle with non-ascii", in: with(func(in *RegisterInput) { in.Handle = "なおき" }), wantFields: []FieldError{{"handle", ReasonInvalidFormat}}},
		{name: "display name 50 runes", in: with(func(in *RegisterInput) { in.DisplayName = strings.Repeat("あ", 50) }), want: with(func(in *RegisterInput) { in.DisplayName = strings.Repeat("あ", 50) })},
		{name: "display name 51 runes", in: with(func(in *RegisterInput) { in.DisplayName = strings.Repeat("あ", 51) }), wantFields: []FieldError{{"display_name", ReasonTooLong}}},
		{name: "display name with control char", in: with(func(in *RegisterInput) { in.DisplayName = "a\x00b" }), wantFields: []FieldError{{"display_name", ReasonInvalidFormat}}},
		{name: "email with display name", in: with(func(in *RegisterInput) { in.Email = "Naoki <naoki@example.com>" }), wantFields: []FieldError{{"email", ReasonInvalidFormat}}},
		{name: "email without domain", in: with(func(in *RegisterInput) { in.Email = "naoki" }), wantFields: []FieldError{{"email", ReasonInvalidFormat}}},
		{name: "email too long", in: with(func(in *RegisterInput) { in.Email = strings.Repeat("a", 250) + "@example.com" }), wantFields: []FieldError{{"email", ReasonTooLong}}},
		{name: "password 7 runes", in: with(func(in *RegisterInput) { in.Password = "passwor" }), wantFields: []FieldError{{"password", ReasonTooShort}}},
		// 長さは文字数（rune）で数える。マルチバイトの 8 文字は 8 文字。
		{name: "password 8 multibyte runes", in: with(func(in *RegisterInput) { in.Password = "ひばりのぱすわ〜" }), want: with(func(in *RegisterInput) { in.Password = "ひばりのぱすわ〜" })},
		{name: "password 129 runes", in: with(func(in *RegisterInput) { in.Password = strings.Repeat("a", 129) }), wantFields: []FieldError{{"password", ReasonTooLong}}},
		{name: "password invalid utf-8", in: with(func(in *RegisterInput) { in.Password = "password\xff" }), wantFields: []FieldError{{"password", ReasonInvalidFormat}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.in.normalize()
			if tt.wantFields != nil {
				var verr *ValidationError
				if !errors.As(err, &verr) {
					t.Fatalf("normalize() error = %v, want *ValidationError", err)
				}
				if !reflect.DeepEqual(verr.Fields, tt.wantFields) {
					t.Fatalf("fields = %+v, want %+v", verr.Fields, tt.wantFields)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalize() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("normalize() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

// TestNextPathProblem は、確認メールに載せる戻り先をアプリの中のパスに限ることを確かめる（ADR 0053 決定 3）。
func TestNextPathProblem(t *testing.T) {
	tests := []struct {
		next string
		want string
	}{
		{next: "", want: ""},
		{next: "/", want: ""},
		{next: "/invite/abc_DEF-123", want: ""},
		{next: "/w/01J/r/01K?m=01L#top", want: ""},
		{next: "/検索", want: ""},
		{next: "invite/abc", want: ReasonInvalidFormat},
		{next: "https://evil.example/", want: ReasonInvalidFormat},
		{next: "javascript:alert(1)", want: ReasonInvalidFormat},
		// スキーム相対の URL と、ブラウザが // と読む /\ は、外のホストを指す。
		{next: "//evil.example/", want: ReasonInvalidFormat},
		{next: `/\evil.example/`, want: ReasonInvalidFormat},
		{next: "/a\r\nLocation: https://evil.example/", want: ReasonInvalidFormat},
		{next: "/a\tb", want: ReasonInvalidFormat},
		{next: "/" + strings.Repeat("a", nextPathMaxBytes-1), want: ""},
		{next: "/" + strings.Repeat("a", nextPathMaxBytes), want: ReasonTooLong},
	}
	for _, tt := range tests {
		if got := nextPathProblem(tt.next); got != tt.want {
			t.Errorf("nextPathProblem(%q) = %q, want %q", tt.next, got, tt.want)
		}
	}
}
