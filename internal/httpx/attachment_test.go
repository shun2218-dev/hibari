package httpx_test

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/oklog/ulid/v2"
)

type attachmentBody struct {
	ID          string `json:"id"`
	RoomID      string `json:"room_id"`
	Status      string `json:"status"`
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	Width       *int   `json:"width"`
	Height      *int   `json:"height"`
}

type createdAttachmentBody struct {
	Attachment attachmentBody `json:"attachment"`
	Upload     struct {
		Method    string            `json:"method"`
		URL       string            `json:"url"`
		Headers   map[string]string `json:"headers"`
		ExpiresAt string            `json:"expires_at"`
	} `json:"upload"`
}

type messageWithAttachmentsBody struct {
	ID          string           `json:"id"`
	Kind        string           `json:"kind"`
	Body        string           `json:"body"`
	Attachments []attachmentBody `json:"attachments"`
}

// userMessages は履歴から人の発言だけを取り出す。参加や作成のログ（ADR 0033）も履歴に並ぶので、
// 添付の検査はその分を除いてから行う。
func userMessages(msgs []messageWithAttachmentsBody) []messageWithAttachmentsBody {
	out := make([]messageWithAttachmentsBody, 0, len(msgs))
	for _, m := range msgs {
		if m.Kind == "user" {
			out = append(out, m)
		}
	}
	return out
}

// storageRequest はクライアントとして、署名付き URL のストレージに直接リクエストを送る（API サーバーを経由しない）。
func storageRequest(t *testing.T, method, url string, headers map[string]string, body []byte) (int, http.Header, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, resp.Header, b
}

// ロードマップ Phase 3c の DoD: curl で 発行 → 直接 PUT → complete → メッセージに添付 → GET URL の取得 が通る。
func TestAttachmentAPIFlow(t *testing.T) {
	c := newAPI(t)
	owner, alice, bob, outsider := c.registerUser(), c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "private", "name": "デザインレビュー"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	c.joinViaInvite(owner, ws.ID, bob)
	expectStatus(t, c.as(owner, http.MethodPost, "/api/v1/rooms/"+room.ID+"/members", map[string]string{"user_id": alice.id}), http.StatusNoContent)
	attachments := "/api/v1/rooms/" + room.ID + "/attachments"

	// 発行
	content := []byte("%PDF-1.7 hibari type scale")
	r = c.as(alice, http.MethodPost, attachments, map[string]any{"file_name": "hibari-type-scale.pdf", "content_type": "application/pdf", "size_bytes": len(content)})
	expectStatus(t, r, http.StatusCreated)
	created := decode[createdAttachmentBody](t, r)
	if a := created.Attachment; a.Status != "pending" || a.RoomID != room.ID || a.FileName != "hibari-type-scale.pdf" || a.SizeBytes != int64(len(content)) ||
		!strings.Contains(string(r.body), `"width":null`) {
		t.Fatalf("attachment = %s", r.body)
	}
	if u := created.Upload; u.Method != http.MethodPut || u.Headers["Content-Type"] != "application/pdf" || len(u.Headers) != 1 || u.ExpiresAt == "" {
		t.Fatalf("upload = %s", r.body)
	}
	complete := "/api/v1/attachments/" + created.Attachment.ID + "/complete"
	expectProblem(t, c.as(alice, http.MethodPost, complete, nil), http.StatusConflict, "attachment-not-uploaded")

	// ストレージに直接 PUT する。申告と違うサイズはストレージが拒否する。
	if status, _, _ := storageRequest(t, created.Upload.Method, created.Upload.URL, created.Upload.Headers, append(bytes.Clone(content), '!')); status != http.StatusForbidden {
		t.Fatalf("PUT larger than declared = %d, want 403", status)
	}
	if status, _, b := storageRequest(t, created.Upload.Method, created.Upload.URL, created.Upload.Headers, content); status != http.StatusOK {
		t.Fatalf("PUT = %d %s", status, b)
	}

	// complete は本人だけ。冪等。
	expectProblem(t, c.as(bob, http.MethodPost, complete, nil), http.StatusNotFound, "not-found")
	for range 2 {
		r = c.as(alice, http.MethodPost, complete, nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[attachmentBody](t, r); got.Status != "uploaded" {
			t.Fatalf("completed = %s", r.body)
		}
	}
	urlPath := "/api/v1/attachments/" + created.Attachment.ID + "/url"
	expectProblem(t, c.as(alice, http.MethodGet, urlPath, nil), http.StatusNotFound, "not-found")

	// メッセージに添付する。
	messages := "/api/v1/rooms/" + room.ID + "/messages"
	p := expectProblem(t, c.as(alice, http.MethodPost, messages, map[string]any{"client_msg_id": ulid.Make().String(), "attachment_ids": []string{"not-a-ulid"}}),
		http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "attachment_ids" || p.Errors[0].Reason != "invalid_format" {
		t.Errorf("errors = %+v", p.Errors)
	}
	r = c.as(alice, http.MethodPost, messages, map[string]any{"client_msg_id": ulid.Make().String(), "body": "行送りの表です", "attachment_ids": []string{created.Attachment.ID}})
	expectStatus(t, r, http.StatusCreated)
	msg := decode[messageWithAttachmentsBody](t, r)
	if len(msg.Attachments) != 1 || msg.Attachments[0].ID != created.Attachment.ID || msg.Attachments[0].FileName != "hibari-type-scale.pdf" ||
		msg.Attachments[0].ContentType != "application/pdf" || strings.Contains(string(r.body), "X-Amz-") {
		t.Fatalf("message = %s", r.body)
	}
	// 他人の添付は付けられない（ロードマップ Phase 3c の DoD）。使用済みの添付も同じ扱い。
	p = expectProblem(t, c.as(owner, http.MethodPost, messages, map[string]any{"client_msg_id": ulid.Make().String(), "body": "x", "attachment_ids": []string{created.Attachment.ID}}),
		http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 1 || p.Errors[0].Field != "attachment_ids" || p.Errors[0].Reason != "invalid_value" {
		t.Errorf("errors = %+v", p.Errors)
	}

	// 履歴にも添付が載る。添付のないメッセージは空配列。
	expectStatus(t, c.as(owner, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": "添付なし"}), http.StatusCreated)
	r = c.as(owner, http.MethodGet, messages, nil)
	expectStatus(t, r, http.StatusOK)
	history := decode[struct {
		Messages []messageWithAttachmentsBody `json:"messages"`
	}](t, r)
	if msgs := userMessages(history.Messages); len(msgs) != 2 || len(msgs[0].Attachments) != 1 || msgs[1].Attachments == nil || len(msgs[1].Attachments) != 0 {
		t.Fatalf("history = %s", r.body)
	}

	// GET URL。ルームのメンバーでなければ取得できない（ロードマップ Phase 3c の DoD）。
	r = c.as(owner, http.MethodGet, urlPath, nil)
	expectStatus(t, r, http.StatusOK)
	dl := decode[struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expires_at"`
	}](t, r)
	if r.header.Get("Cache-Control") != "no-store" || dl.ExpiresAt == "" {
		t.Errorf("GET url response = %s (Cache-Control %q)", r.body, r.header.Get("Cache-Control"))
	}
	status, header, got := storageRequest(t, http.MethodGet, dl.URL, nil, nil)
	if status != http.StatusOK || !bytes.Equal(got, content) || header.Get("Content-Type") != "application/pdf" ||
		header.Get("Content-Disposition") != `attachment; filename=hibari-type-scale.pdf` {
		t.Errorf("GET object = %d %q (Content-Type %q, Content-Disposition %q)", status, got, header.Get("Content-Type"), header.Get("Content-Disposition"))
	}
	expectProblem(t, c.as(bob, http.MethodGet, urlPath, nil), http.StatusNotFound, "not-found")
	expectProblem(t, c.as(outsider, http.MethodGet, urlPath, nil), http.StatusNotFound, "not-found")
	expectProblem(t, c.as(owner, http.MethodGet, "/api/v1/attachments/not-a-ulid/url", nil), http.StatusNotFound, "not-found")

	// 発行の権限と検証。
	expectProblem(t, c.as(bob, http.MethodPost, attachments, map[string]any{"file_name": "a.txt", "content_type": "text/plain", "size_bytes": 1}), http.StatusNotFound, "not-found")
	p = expectProblem(t, c.as(alice, http.MethodPost, attachments, map[string]any{"file_name": "a.svg", "content_type": "image/svg+xml"}), http.StatusUnprocessableEntity, "validation-error")
	if len(p.Errors) != 2 {
		t.Errorf("errors = %+v, want content_type and size_bytes", p.Errors)
	}

	// メッセージを削除したら、添付は一覧から消え、GET URL も取得できない。
	expectStatus(t, c.as(alice, http.MethodDelete, messages+"/"+msg.ID, nil), http.StatusNoContent)
	expectProblem(t, c.as(owner, http.MethodGet, urlPath, nil), http.StatusNotFound, "not-found")
	r = c.as(owner, http.MethodGet, messages, nil)
	expectStatus(t, r, http.StatusOK)
	if !strings.Contains(string(r.body), `"attachments":[]`) || strings.Contains(string(r.body), "hibari-type-scale.pdf") {
		t.Errorf("history after delete = %s", r.body)
	}
}

// uploadFile は 発行 → 直接 PUT → complete を済ませた添付の ID を返す。
func (c *apiClient) uploadFile(t *testing.T, u apiUser, roomID, name string, content []byte) string {
	t.Helper()
	r := c.as(u, http.MethodPost, "/api/v1/rooms/"+roomID+"/attachments",
		map[string]any{"file_name": name, "content_type": "text/plain", "size_bytes": len(content)})
	expectStatus(t, r, http.StatusCreated)
	created := decode[createdAttachmentBody](t, r)
	if status, _, _ := storageRequest(t, created.Upload.Method, created.Upload.URL, created.Upload.Headers, content); status != http.StatusOK {
		t.Fatalf("PUT object = %d", status)
	}
	expectStatus(t, c.as(u, http.MethodPost, "/api/v1/attachments/"+created.Attachment.ID+"/complete", nil), http.StatusOK)
	return created.Attachment.ID
}

// 添付ファイルだけの削除（ロードマップ Phase 6.7.5 / ADR 0045）。
func TestDeleteMessageAttachmentAPI(t *testing.T) {
	c := newAPI(t)
	owner, alice, bob := c.registerUser(), c.registerUser(), c.registerUser()
	r := c.as(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(t, r, http.StatusCreated)
	ws := decode[workspaceBody](t, r)
	c.joinViaInvite(owner, ws.ID, alice)
	c.joinViaInvite(owner, ws.ID, bob)
	r = c.as(owner, http.MethodPost, "/api/v1/workspaces/"+ws.ID+"/rooms", map[string]string{"kind": "public", "name": "資料"})
	expectStatus(t, r, http.StatusCreated)
	room := decode[roomBody](t, r)
	for _, u := range []apiUser{alice, bob} {
		expectStatus(t, c.as(u, http.MethodPost, "/api/v1/rooms/"+room.ID+"/join", nil), http.StatusOK)
	}
	messages := "/api/v1/rooms/" + room.ID + "/messages"
	content := []byte("hibari")

	first := c.uploadFile(t, alice, room.ID, "a.txt", content)
	second := c.uploadFile(t, alice, room.ID, "b.txt", content)
	r = c.as(alice, http.MethodPost, messages,
		map[string]any{"client_msg_id": ulid.Make().String(), "body": "資料です", "attachment_ids": []string{first, second}})
	expectStatus(t, r, http.StatusCreated)
	msg := decode[messageWithAttachmentsBody](t, r)
	path := messages + "/" + msg.ID + "/attachments/"

	t.Run("消せない人には 403（メッセージの削除と同じ判定）", func(t *testing.T) {
		expectProblem(t, c.as(bob, http.MethodDelete, path+first, nil), http.StatusForbidden, "forbidden")
	})

	t.Run("そのメッセージの添付でなければ 404", func(t *testing.T) {
		expectProblem(t, c.as(alice, http.MethodDelete, path+ulid.Make().String(), nil), http.StatusNotFound, "not-found")
		expectProblem(t, c.as(alice, http.MethodDelete, path+"not-a-ulid", nil), http.StatusNotFound, "not-found")
		// まだメッセージに付いていない添付も、そのメッセージのものではない
		pending := c.uploadFile(t, alice, room.ID, "c.txt", content)
		expectProblem(t, c.as(alice, http.MethodDelete, path+pending, nil), http.StatusNotFound, "not-found")
	})

	t.Run("消すと更新後のメッセージが返り、GET URL も取れなくなる", func(t *testing.T) {
		r := c.as(alice, http.MethodDelete, path+first, nil)
		expectStatus(t, r, http.StatusOK)
		got := decode[messageWithAttachmentsBody](t, r)
		if len(got.Attachments) != 1 || got.Attachments[0].ID != second || got.Body != "資料です" {
			t.Fatalf("message = %s", r.body)
		}
		expectProblem(t, c.as(alice, http.MethodGet, "/api/v1/attachments/"+first+"/url", nil), http.StatusNotFound, "not-found")
	})

	t.Run("もう一度消しても 200（冪等）", func(t *testing.T) {
		r := c.as(alice, http.MethodDelete, path+first, nil)
		expectStatus(t, r, http.StatusOK)
		if got := decode[messageWithAttachmentsBody](t, r); len(got.Attachments) != 1 {
			t.Errorf("message = %s", r.body)
		}
	})

	t.Run("admin は他人の添付も消せる", func(t *testing.T) {
		expectStatus(t, c.as(owner, http.MethodDelete, path+second, nil), http.StatusOK)
	})

	t.Run("最後の添付で本文も空なら、メッセージごと消える", func(t *testing.T) {
		only := c.uploadFile(t, alice, room.ID, "d.txt", content)
		r := c.as(alice, http.MethodPost, messages, map[string]any{"client_msg_id": ulid.Make().String(), "attachment_ids": []string{only}})
		expectStatus(t, r, http.StatusCreated)
		empty := decode[messageWithAttachmentsBody](t, r)

		r = c.as(alice, http.MethodDelete, messages+"/"+empty.ID+"/attachments/"+only, nil)
		expectStatus(t, r, http.StatusOK)
		tombstone := decode[struct {
			messageWithAttachmentsBody
			DeletedAt *string `json:"deleted_at"`
		}](t, r)
		if tombstone.DeletedAt == nil || len(tombstone.Attachments) != 0 {
			t.Fatalf("message = %s, want tombstone", r.body)
		}
	})
}
