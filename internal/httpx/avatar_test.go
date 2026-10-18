package httpx_test

import (
	"bytes"
	"net/http"
	"testing"
)

type avatarUploadBody struct {
	UploadID string `json:"upload_id"`
	Upload   struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
	} `json:"upload"`
}

type avatarsBody struct {
	Avatars map[string]struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expires_at"`
	} `json:"avatars"`
}

// putObject は署名付き URL にそのまま PUT する（サーバーは中身を経由しない。CLAUDE.md ルール 10）。
func putObject(t *testing.T, up avatarUploadBody, body []byte) int {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), up.Upload.Method, up.Upload.URL, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range up.Upload.Headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

// 発行 → PUT → complete → 一覧 → 削除（ADR 0020）。
func TestAvatarEndpoints(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	me := decode[tokenBody](t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg}))
	body := []byte("\x89PNG\r\n\x1a\n avatar")

	r := c.do(request{
		method:  http.MethodPost,
		path:    "/api/v1/users/me/avatar",
		body:    map[string]any{"content_type": "image/png", "size_bytes": len(body)},
		headers: bearer(me.AccessToken),
	})
	if r.status != http.StatusCreated {
		t.Fatalf("create avatar upload = %d: %s", r.status, r.body)
	}
	up := decode[avatarUploadBody](t, r)
	if up.UploadID == "" || up.Upload.URL == "" || up.Upload.Headers["Content-Type"] != "image/png" {
		t.Fatalf("upload = %+v", up)
	}

	if status := putObject(t, up, body); status != http.StatusOK {
		t.Fatalf("PUT to storage = %d", status)
	}

	completed := decode[userBody](t, c.do(request{
		method:  http.MethodPost,
		path:    "/api/v1/users/me/avatar/complete",
		body:    map[string]any{"upload_id": up.UploadID, "content_type": "image/png", "size_bytes": len(body)},
		headers: bearer(me.AccessToken),
	}))
	if completed.AvatarURL == "" {
		t.Fatalf("completed profile = %+v, want an avatar URL", completed)
	}

	// 自分のプロフィールには URL が入る。
	after := decode[userBody](t, c.do(request{method: http.MethodGet, path: "/api/v1/users/me", headers: bearer(me.AccessToken)}))
	if after.AvatarURL == "" {
		t.Fatalf("me = %+v, want an avatar URL", after)
	}

	// 画面に出すユーザーの分は、まとめて取る。画像がない人は結果に入らない。
	otherReg := registerBody(c)
	other := decode[tokenBody](t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: otherReg}))
	avatars := decode[avatarsBody](t, c.do(request{
		method:  http.MethodPost,
		path:    "/api/v1/users/avatars",
		body:    map[string]any{"user_ids": []string{completed.ID, other.User.ID, "not-a-ulid"}},
		headers: bearer(me.AccessToken),
	}))
	if len(avatars.Avatars) != 1 || avatars.Avatars[completed.ID].URL == "" {
		t.Fatalf("avatars = %+v, want only the user with an avatar", avatars.Avatars)
	}

	// 削除すると、頭文字のアバターに戻る。
	cleared := decode[userBody](t, c.do(request{method: http.MethodDelete, path: "/api/v1/users/me/avatar", headers: bearer(me.AccessToken)}))
	if cleared.AvatarURL != "" {
		t.Fatalf("after delete = %+v, want no avatar URL", cleared)
	}
}

func TestAvatarEndpointErrors(t *testing.T) {
	c := newAPI(t)
	reg := registerBody(c)
	me := decode[tokenBody](t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/register", body: reg}))

	// 受け付けない種類・大きすぎるサイズは、項目付きの 422。
	r := c.do(request{
		method:  http.MethodPost,
		path:    "/api/v1/users/me/avatar",
		body:    map[string]any{"content_type": "image/svg+xml", "size_bytes": 1024},
		headers: bearer(me.AccessToken),
	})
	p := expectProblem(t, r, http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "content_type" {
		t.Fatalf("errors = %+v, want one about content_type", p.Errors)
	}

	// PUT していない upload_id は 409。
	r = c.do(request{
		method:  http.MethodPost,
		path:    "/api/v1/users/me/avatar/complete",
		body:    map[string]any{"upload_id": "01J8ZH5K000000000000000001", "content_type": "image/png", "size_bytes": 10},
		headers: bearer(me.AccessToken),
	})
	expectProblem(t, r, http.StatusConflict, "avatar-not-uploaded")

	// ULID として読めない upload_id も同じ扱い。
	r = c.do(request{
		method:  http.MethodPost,
		path:    "/api/v1/users/me/avatar/complete",
		body:    map[string]any{"upload_id": "nope", "content_type": "image/png", "size_bytes": 10},
		headers: bearer(me.AccessToken),
	})
	expectProblem(t, r, http.StatusConflict, "avatar-not-uploaded")

	// 認証なしはすべて 401。
	for _, req := range []request{
		{method: http.MethodPost, path: "/api/v1/users/me/avatar", body: map[string]any{"content_type": "image/png", "size_bytes": 10}},
		{method: http.MethodPost, path: "/api/v1/users/me/avatar/complete", body: map[string]any{"upload_id": "01J8ZH5K000000000000000001"}},
		{method: http.MethodDelete, path: "/api/v1/users/me/avatar"},
		{method: http.MethodPost, path: "/api/v1/users/avatars", body: map[string]any{"user_ids": []string{}}},
	} {
		if r := c.do(req); r.status != http.StatusUnauthorized {
			t.Errorf("%s %s without a token = %d, want 401", req.method, req.path, r.status)
		}
	}
}
