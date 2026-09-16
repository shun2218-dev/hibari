package auth_test

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth"
	"github.com/shun2218-dev/hibari/internal/auth/authtest"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
)

// pngBody は中身の検証をしないので（ADR 0020）、PNG の署名だけを持つ短いバイト列で足りる。
var pngBody = []byte("\x89PNG\r\n\x1a\n avatar")

func put(t *testing.T, up auth.AvatarUpload, body []byte) int {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), up.Method, up.URL, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range up.Header {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

func upload(t *testing.T, env *authtest.Env, userID ulid.ULID, body []byte) auth.User {
	t.Helper()
	size := int64(len(body))
	in := auth.AvatarUploadInput{ContentType: "image/png", SizeBytes: &size}
	up, err := env.Service.CreateAvatarUpload(t.Context(), userID, in)
	if err != nil {
		t.Fatalf("CreateAvatarUpload() error = %v", err)
	}
	if status := put(t, up, body); status != http.StatusOK {
		t.Fatalf("PUT status = %d", status)
	}
	u, err := env.Service.CompleteAvatarUpload(t.Context(), userID, up.UploadID, in)
	if err != nil {
		t.Fatalf("CompleteAvatarUpload() error = %v", err)
	}
	return u
}

// 発行 → PUT → complete → 署名付き URL で取得 → 差し替え → 削除（ADR 0020）。
func TestAvatarUploadFlow(t *testing.T) {
	env := authtest.New(t)
	u, _, _ := env.Register(t)
	if u.AvatarURL != "" {
		t.Fatalf("new user has an avatar URL = %q, want none", u.AvatarURL)
	}

	updated := upload(t, env, u.ID, pngBody)
	if updated.AvatarURL == "" {
		t.Fatal("CompleteAvatarUpload() returned no avatar URL")
	}
	// 発行された URL で、置いた画像がそのまま取れる。ブラウザに表示させるので inline。
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, updated.AvatarURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	got, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || !bytes.Equal(got, pngBody) {
		t.Fatalf("GET avatar = %d %q", resp.StatusCode, got)
	}
	if cd := resp.Header.Get("Content-Disposition"); cd != "inline" {
		t.Errorf("Content-Disposition = %q, want inline", cd)
	}

	// me でも同じように URL が付く。
	me, err := env.Service.Me(t.Context(), u.ID)
	if err != nil || me.AvatarURL == "" {
		t.Fatalf("Me() = %+v, %v, want an avatar URL", me, err)
	}

	// 差し替えると、古いオブジェクトは消える。
	firstKey := objectKeyOf(t, env, u.ID)
	replaced := upload(t, env, u.ID, append(pngBody, '2'))
	if replaced.AvatarURL == "" {
		t.Fatal("replacement has no avatar URL")
	}
	if _, err := env.Storage.Head(t.Context(), firstKey); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("Head(previous avatar) error = %v, want ErrNotFound", err)
	}

	// 削除すると、頭文字のアバターに戻り、オブジェクトも消える。
	secondKey := objectKeyOf(t, env, u.ID)
	cleared, err := env.Service.DeleteAvatar(t.Context(), u.ID)
	if err != nil {
		t.Fatalf("DeleteAvatar() error = %v", err)
	}
	if cleared.AvatarURL != "" {
		t.Errorf("after delete, avatar URL = %q, want empty", cleared.AvatarURL)
	}
	if _, err := env.Storage.Head(t.Context(), secondKey); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("Head(deleted avatar) error = %v, want ErrNotFound", err)
	}
	// 画像がなくても削除は成功する。
	if _, err := env.Service.DeleteAvatar(t.Context(), u.ID); err != nil {
		t.Errorf("DeleteAvatar() without an avatar = %v", err)
	}
}

// objectKeyOf は users に入っているアバターのキーを読む（テストの確認用）。
func objectKeyOf(t *testing.T, env *authtest.Env, userID ulid.ULID) string {
	t.Helper()
	var key *string
	if err := env.Pool.QueryRow(t.Context(), `SELECT avatar_object_key FROM users WHERE id = $1`, userID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	if key == nil {
		t.Fatal("user has no avatar object key")
	}
	return *key
}

func TestCompleteAvatarUploadRejectsUnuploadedAndMismatched(t *testing.T) {
	env := authtest.New(t)
	u, _, _ := env.Register(t)
	size := int64(len(pngBody))
	in := auth.AvatarUploadInput{ContentType: "image/png", SizeBytes: &size}

	// PUT していない upload_id は「置かれていない」。
	if _, err := env.Service.CompleteAvatarUpload(t.Context(), u.ID, env.IDs.New(), in); !errors.Is(err, auth.ErrAvatarNotUploaded) {
		t.Fatalf("CompleteAvatarUpload(not uploaded) error = %v, want ErrAvatarNotUploaded", err)
	}

	// 置いたものと申告が違えば拒否し、そのオブジェクトも消す。
	up, err := env.Service.CreateAvatarUpload(t.Context(), u.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if status := put(t, up, pngBody); status != http.StatusOK {
		t.Fatalf("PUT status = %d", status)
	}
	other := int64(len(pngBody))
	_, err = env.Service.CompleteAvatarUpload(t.Context(), u.ID, up.UploadID, auth.AvatarUploadInput{ContentType: "image/webp", SizeBytes: &other})
	if !errors.Is(err, auth.ErrAvatarMismatch) {
		t.Fatalf("CompleteAvatarUpload(mismatched type) error = %v, want ErrAvatarMismatch", err)
	}
	if me, err := env.Service.Me(t.Context(), u.ID); err != nil || me.AvatarURL != "" {
		t.Fatalf("Me() after a mismatch = %+v, %v, want no avatar", me, err)
	}
}

// 他人がアップロードしたオブジェクトを、自分のアバターにはできない（キーにユーザー ID が入る）。
func TestCompleteAvatarUploadCannotStealAnotherUsersUpload(t *testing.T) {
	env := authtest.New(t)
	victim, _, _ := env.Register(t)
	attacker, _, _ := env.Register(t)
	size := int64(len(pngBody))
	in := auth.AvatarUploadInput{ContentType: "image/png", SizeBytes: &size}

	up, err := env.Service.CreateAvatarUpload(t.Context(), victim.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if status := put(t, up, pngBody); status != http.StatusOK {
		t.Fatalf("PUT status = %d", status)
	}

	if _, err := env.Service.CompleteAvatarUpload(t.Context(), attacker.ID, up.UploadID, in); !errors.Is(err, auth.ErrAvatarNotUploaded) {
		t.Fatalf("CompleteAvatarUpload(another user's upload) error = %v, want ErrAvatarNotUploaded", err)
	}
}

func TestCreateAvatarUploadValidation(t *testing.T) {
	env := authtest.New(t)
	u, _, _ := env.Register(t)
	big := int64(3 << 20)
	zero := int64(0)
	ok := int64(1024)

	for _, tt := range []struct {
		name  string
		in    auth.AvatarUploadInput
		field string
	}{
		{"no content type", auth.AvatarUploadInput{SizeBytes: &ok}, "content_type"},
		{"content type with parameters", auth.AvatarUploadInput{ContentType: "image/png; charset=utf-8", SizeBytes: &ok}, "content_type"},
		{"disallowed type", auth.AvatarUploadInput{ContentType: "image/svg+xml", SizeBytes: &ok}, "content_type"},
		{"no size", auth.AvatarUploadInput{ContentType: "image/png"}, "size_bytes"},
		{"empty file", auth.AvatarUploadInput{ContentType: "image/png", SizeBytes: &zero}, "size_bytes"},
		{"too large", auth.AvatarUploadInput{ContentType: "image/png", SizeBytes: &big}, "size_bytes"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.CreateAvatarUpload(t.Context(), u.ID, tt.in)
			var verr *auth.ValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("CreateAvatarUpload() error = %v, want ValidationError", err)
			}
			if len(verr.Fields) != 1 || verr.Fields[0].Field != tt.field {
				t.Fatalf("fields = %+v, want only %s", verr.Fields, tt.field)
			}
		})
	}
}

func TestAvatarURLs(t *testing.T) {
	env := authtest.New(t)
	withAvatar, _, _ := env.Register(t)
	without, _, _ := env.Register(t)
	upload(t, env, withAvatar.ID, pngBody)

	got, err := env.Service.AvatarURLs(t.Context(), []ulid.ULID{withAvatar.ID, without.ID, env.IDs.New(), withAvatar.ID})
	if err != nil {
		t.Fatalf("AvatarURLs() error = %v", err)
	}
	// 画像を持つ人だけが入る（持たない人と存在しない ID は結果に出ない）。
	if len(got) != 1 {
		t.Fatalf("AvatarURLs() = %+v, want only the user with an avatar", got)
	}
	a, ok := got[withAvatar.ID]
	if !ok || a.URL == "" {
		t.Fatalf("avatar of %v = %+v", withAvatar.ID, a)
	}
	if !a.ExpiresAt.After(authtest.Start) {
		t.Errorf("expires at = %v, want after %v", a.ExpiresAt, authtest.Start)
	}

	// 空なら何も返さない。
	if got, err := env.Service.AvatarURLs(t.Context(), nil); err != nil || len(got) != 0 {
		t.Fatalf("AvatarURLs(nil) = %+v, %v", got, err)
	}

	// 一度に多すぎる要求は拒否する。
	many := make([]ulid.ULID, 201)
	for i := range many {
		many[i] = env.IDs.New()
	}
	var verr *auth.ValidationError
	if _, err := env.Service.AvatarURLs(t.Context(), many); !errors.As(err, &verr) {
		t.Fatalf("AvatarURLs(201 ids) error = %v, want ValidationError", err)
	}
}
