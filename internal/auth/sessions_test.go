package auth_test

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/auth/authtest"
)

// ログイン中のセッションが、最後に使った順に、いまのセッションの印付きで並ぶ（ADR 0019）。
func TestSessionsListsActiveSessions(t *testing.T) {
	env := authtest.New(t)
	u, first, in := env.Register(t)

	env.Clock.Advance(time.Minute)
	_, second, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{UserAgent: "hibari for iOS"})
	if err != nil {
		t.Fatal(err)
	}
	// ローテーションしても 1 つのセッションのままで、最後に使った時刻だけが進む。
	env.Clock.Advance(time.Minute)
	if _, err := env.Service.Refresh(t.Context(), first.RefreshToken, auth.Client{UserAgent: "Chrome"}); err != nil {
		t.Fatal(err)
	}

	got, err := env.Service.Sessions(t.Context(), u.ID, first.ID)
	if err != nil {
		t.Fatalf("Sessions() error = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("Sessions() = %d sessions, want 2 (%+v)", len(got), got)
	}
	// 最後に使った順: refresh した first が先、その前にログインした second が後。
	if got[0].ID != first.ID || got[1].ID != second.ID {
		t.Fatalf("order = %v, want [%v %v]", []ulid.ULID{got[0].ID, got[1].ID}, first.ID, second.ID)
	}
	if !got[0].Current || got[1].Current {
		t.Errorf("current flags = %v, %v, want true, false", got[0].Current, got[1].Current)
	}
	if got[0].UserAgent != "Chrome" {
		t.Errorf("user agent = %q, want the one from the latest refresh", got[0].UserAgent)
	}
	if got[1].UserAgent != "hibari for iOS" {
		t.Errorf("second session user agent = %q", got[1].UserAgent)
	}
	// ログインの時刻は最初の行、最後に使った時刻は最新の行。
	if !got[0].StartedAt.Equal(authtest.Start) {
		t.Errorf("started at = %v, want %v", got[0].StartedAt, authtest.Start)
	}
	if !got[0].LastUsedAt.Equal(authtest.Start.Add(2 * time.Minute)) {
		t.Errorf("last used at = %v", got[0].LastUsedAt)
	}
}

func TestSessionsExcludesRevokedAndExpired(t *testing.T) {
	env := authtest.New(t)
	u, mine, in := env.Register(t)
	_, other, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{})
	if err != nil {
		t.Fatal(err)
	}
	if err := env.Service.Logout(t.Context(), other.RefreshToken); err != nil {
		t.Fatal(err)
	}

	got, err := env.Service.Sessions(t.Context(), u.ID, mine.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != mine.ID {
		t.Fatalf("Sessions() after logout = %+v, want only the current session", got)
	}

	// 期限が切れたセッションも出さない。
	env.Clock.Advance(auth.RefreshTokenTTL + time.Second)
	got, err = env.Service.Sessions(t.Context(), u.ID, mine.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("Sessions() after expiry = %+v, want none", got)
	}
}

func TestRevokeSession(t *testing.T) {
	env := authtest.New(t)
	u, mine, in := env.Register(t)
	_, other, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{})
	if err != nil {
		t.Fatal(err)
	}

	if err := env.Service.RevokeSession(t.Context(), u.ID, other.ID); err != nil {
		t.Fatalf("RevokeSession() error = %v", err)
	}
	// 失効したセッションでは refresh できず、自分のセッションは残る。
	if _, err := env.Service.Refresh(t.Context(), other.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
		t.Fatalf("Refresh(revoked) error = %v, want ErrInvalidRefreshToken", err)
	}
	if _, err := env.Service.Refresh(t.Context(), mine.RefreshToken, auth.Client{}); err != nil {
		t.Fatalf("Refresh(mine) error = %v, want still valid", err)
	}
	// WebSocket を切るために、失効したセッションだけを知らせる。
	if got := env.Revocations.Sessions(); !slices.Equal(got, []ulid.ULID{other.ID}) {
		t.Errorf("revocation events = %v, want [%v]", got, other.ID)
	}
	if got := env.Revocations.Users(); len(got) != 0 {
		t.Errorf("user-wide revocation events = %v, want none", got)
	}
	// 2 度目は「もうない」。
	if err := env.Service.RevokeSession(t.Context(), u.ID, other.ID); !errors.Is(err, auth.ErrSessionNotFound) {
		t.Fatalf("RevokeSession(twice) error = %v, want ErrSessionNotFound", err)
	}
}

// 他人のセッションは失効させられない。存在しない ID と同じ扱いにして、存在を明かさない。
func TestRevokeSessionOfAnotherUser(t *testing.T) {
	env := authtest.New(t)
	_, victimSession, _ := env.Register(t)
	attacker, _, _ := env.Register(t)

	err := env.Service.RevokeSession(t.Context(), attacker.ID, victimSession.ID)

	if !errors.Is(err, auth.ErrSessionNotFound) {
		t.Fatalf("RevokeSession(other user's) error = %v, want ErrSessionNotFound", err)
	}
	if _, err := env.Service.Refresh(t.Context(), victimSession.RefreshToken, auth.Client{}); err != nil {
		t.Fatalf("victim's session = %v, want still valid", err)
	}
	if got := env.Revocations.Sessions(); len(got) != 0 {
		t.Errorf("revocation events = %v, want none", got)
	}
}

func TestRevokeOtherSessions(t *testing.T) {
	env := authtest.New(t)
	u, mine, in := env.Register(t)
	var others []auth.Session
	for range 2 {
		_, s, err := env.Service.Login(t.Context(), in.Email, in.Password, auth.Client{})
		if err != nil {
			t.Fatal(err)
		}
		// ローテーションして 1 つの family に複数の行がある状態にする（イベントが 1 回にまとまることの確認）。
		s, err = env.Service.Refresh(t.Context(), s.RefreshToken, auth.Client{})
		if err != nil {
			t.Fatal(err)
		}
		others = append(others, s)
	}

	n, err := env.Service.RevokeOtherSessions(t.Context(), u.ID, mine.ID)
	if err != nil {
		t.Fatalf("RevokeOtherSessions() error = %v", err)
	}
	if n != 2 {
		t.Errorf("revoked count = %d, want 2", n)
	}
	for _, s := range others {
		if _, err := env.Service.Refresh(t.Context(), s.RefreshToken, auth.Client{}); !errors.Is(err, auth.ErrInvalidRefreshToken) {
			t.Errorf("Refresh(revoked) error = %v, want ErrInvalidRefreshToken", err)
		}
	}
	// 自分のセッションは残る。ユーザー単位の失効は使わない（自分の WebSocket まで切れてしまう）。
	if _, err := env.Service.Refresh(t.Context(), mine.RefreshToken, auth.Client{}); err != nil {
		t.Fatalf("Refresh(mine) error = %v, want still valid", err)
	}
	if got := env.Revocations.Users(); len(got) != 0 {
		t.Errorf("user-wide revocation events = %v, want none", got)
	}
	// family ごとに 1 回だけ知らせる。
	got := env.Revocations.Sessions()
	want := []ulid.ULID{others[0].ID, others[1].ID}
	slices.SortFunc(got, func(a, b ulid.ULID) int { return a.Compare(b) })
	slices.SortFunc(want, func(a, b ulid.ULID) int { return a.Compare(b) })
	if !slices.Equal(got, want) {
		t.Errorf("revocation events = %v, want %v", got, want)
	}
	// 他にセッションがなければ、何も起きない。
	n, err = env.Service.RevokeOtherSessions(t.Context(), u.ID, mine.ID)
	if err != nil || n != 0 {
		t.Fatalf("RevokeOtherSessions(none left) = %d, %v", n, err)
	}
}

func TestUpdateProfile(t *testing.T) {
	env := authtest.New(t)
	u, _, _ := env.Register(t)
	// テスト用の DB は使い回すので、ハンドルは実行ごとに一意な値にする。
	name, handle := "佐藤 直樹", env.NewRegisterInput().Handle

	got, err := env.Service.UpdateProfile(t.Context(), u.ID, auth.ProfileInput{DisplayName: &name, Handle: &handle})
	if err != nil {
		t.Fatalf("UpdateProfile() error = %v", err)
	}
	if got.DisplayName != name || got.Handle != handle {
		t.Fatalf("UpdateProfile() = %+v, want display name %q and handle %q", got, name, handle)
	}
	// 変えていない項目はそのまま。
	if got.Email != u.Email || got.ID != u.ID {
		t.Errorf("UpdateProfile() changed more than asked: %+v", got)
	}

	// 片方だけの更新は、もう片方を変えない。
	only := "みゆき"
	got, err = env.Service.UpdateProfile(t.Context(), u.ID, auth.ProfileInput{DisplayName: &only})
	if err != nil {
		t.Fatal(err)
	}
	if got.DisplayName != only || got.Handle != handle {
		t.Fatalf("partial update = %+v, want handle to stay %q", got, handle)
	}

	// 何も指定しなければ、いまの値をそのまま返す。
	same, err := env.Service.UpdateProfile(t.Context(), u.ID, auth.ProfileInput{})
	if err != nil || same.DisplayName != only || same.Handle != handle {
		t.Fatalf("empty update = %+v, %v", same, err)
	}
}

func TestUpdateProfileRejectsTakenHandleAndInvalidInput(t *testing.T) {
	env := authtest.New(t)
	other, _, _ := env.Register(t)
	u, _, _ := env.Register(t)

	if _, err := env.Service.UpdateProfile(t.Context(), u.ID, auth.ProfileInput{Handle: &other.Handle}); !errors.Is(err, auth.ErrHandleTaken) {
		t.Fatalf("UpdateProfile(taken handle) error = %v, want ErrHandleTaken", err)
	}

	for _, tt := range []struct {
		name  string
		in    auth.ProfileInput
		field string
	}{
		{"handle too short", auth.ProfileInput{Handle: ptr("ab")}, "handle"},
		{"handle with symbols", auth.ProfileInput{Handle: ptr("naoki!")}, "handle"},
		{"empty display name", auth.ProfileInput{DisplayName: ptr("   ")}, "display_name"},
		{"display name too long", auth.ProfileInput{DisplayName: ptr(strings.Repeat("あ", 51))}, "display_name"},
		{"display name with control character", auth.ProfileInput{DisplayName: ptr("佐藤\a")}, "display_name"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.UpdateProfile(t.Context(), u.ID, tt.in)
			var verr *auth.ValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("UpdateProfile() error = %v, want ValidationError", err)
			}
			if len(verr.Fields) != 1 || verr.Fields[0].Field != tt.field {
				t.Fatalf("fields = %+v, want only %s", verr.Fields, tt.field)
			}
		})
	}

	// 退会済み・存在しないユーザー。
	if _, err := env.Service.UpdateProfile(t.Context(), env.IDs.New(), auth.ProfileInput{DisplayName: ptr("誰か")}); !errors.Is(err, auth.ErrUserNotFound) {
		t.Fatalf("UpdateProfile(unknown user) error = %v, want ErrUserNotFound", err)
	}
}

func ptr[T any](v T) *T { return &v }
