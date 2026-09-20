package chat_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
)

func int64p(v int64) *int64 { return &v }
func intp(v int) *int       { return &v }

func textInput(name string, body []byte) chat.AttachmentInput {
	return chat.AttachmentInput{FileName: name, ContentType: "text/plain", SizeBytes: int64p(int64(len(body)))}
}

// putUpload は発行された URL にクライアントとして直接 PUT し、ステータスを返す。
func putUpload(t *testing.T, u chat.UploadRequest, body []byte) int {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), u.Method, u.URL, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range u.Header {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

// uploadAttachment は 発行 → PUT → complete を済ませた添付を返す。
func uploadAttachment(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID, in chat.AttachmentInput, body []byte) chat.Attachment {
	t.Helper()
	created, err := env.Service.CreateAttachment(t.Context(), actor, roomID, in)
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}
	if status := putUpload(t, created.Upload, body); status != http.StatusOK {
		t.Fatalf("PUT status = %d", status)
	}
	att, err := env.Service.CompleteAttachment(t.Context(), actor, created.Attachment.ID)
	if err != nil {
		t.Fatalf("CompleteAttachment() error = %v", err)
	}
	return att
}

// attachmentStatus は attachments の status を返す。行がなければ空文字列。
func attachmentStatus(t *testing.T, env *chattest.Env, id ulid.ULID) string {
	t.Helper()
	var status string
	if err := env.Pool.QueryRow(t.Context(), `SELECT coalesce((SELECT status FROM attachments WHERE id = $1), '')`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func objectKey(t *testing.T, env *chattest.Env, id ulid.ULID) string {
	t.Helper()
	var key string
	if err := env.Pool.QueryRow(t.Context(), `SELECT object_key FROM attachments WHERE id = $1`, id).Scan(&key); err != nil {
		t.Fatal(err)
	}
	return key
}

func objectExists(t *testing.T, env *chattest.Env, key string) bool {
	t.Helper()
	_, err := env.Storage.Head(t.Context(), key)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		t.Fatal(err)
	}
	return err == nil
}

func TestCreateAttachment(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)

	env.Clock.Advance(time.Minute)
	in := chat.AttachmentInput{FileName: "サイドバー 改訂.png", ContentType: "image/png", SizeBytes: int64p(1234), Width: intp(640), Height: intp(480)}
	created, err := env.Service.CreateAttachment(t.Context(), r.member, public.ID, in)
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}
	a := created.Attachment
	if a.Status != chat.AttachmentPending || a.RoomID != public.ID || a.FileName != in.FileName || a.ContentType != "image/png" ||
		a.SizeBytes != 1234 || *a.Width != 640 || *a.Height != 480 || !a.CreatedAt.Equal(env.Clock.Now()) {
		t.Errorf("attachment = %+v", a)
	}
	u := created.Upload
	// オブジェクトキーにはファイル名を入れない。
	if u.Method != http.MethodPut || !strings.Contains(u.URL, "attachments/"+public.ID.String()+"/"+a.ID.String()+"?") ||
		strings.Contains(u.URL, "png") || len(u.Header) != 1 || u.Header["Content-Type"] != "image/png" ||
		!u.ExpiresAt.Equal(env.Clock.Now().Add(15*time.Minute)) {
		t.Errorf("upload = %+v", u)
	}
	if got := attachmentStatus(t, env, a.ID); got != "pending" {
		t.Errorf("status = %q, want pending", got)
	}

	for _, tt := range []struct {
		name    string
		actor   ulid.ULID
		room    ulid.ULID
		wantErr error
	}{
		{"public as member", r.member, public.ID, nil},
		// アップロードは投稿の準備なので、読めるだけの人には許さない（ADR 0013）。
		{"public without joining", r.owner, public.ID, chat.ErrForbidden},
		{"private as member", r.member, private.ID, nil},
		{"private as non-member owner", r.owner, private.ID, chat.ErrNotFound},
		{"dm as participant", r.member2, dm.ID, nil},
		{"dm as owner", r.owner, dm.ID, chat.ErrNotFound},
		{"outsider", r.outsider, public.ID, chat.ErrNotFound},
		{"unknown room", r.member, env.IDs.New(), chat.ErrNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.CreateAttachment(t.Context(), tt.actor, tt.room, textInput("a.txt", []byte("x")))
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("CreateAttachment() error = %v, want %v", err, tt.wantErr)
			}
		})
	}

	max := chattest.AttachmentLimits.MaxBytes
	for _, tt := range []struct {
		name          string
		in            chat.AttachmentInput
		field, reason string
	}{
		{"missing file name", chat.AttachmentInput{FileName: " ", ContentType: "text/plain", SizeBytes: int64p(1)}, "file_name", chat.ReasonRequired},
		{"long file name", chat.AttachmentInput{FileName: strings.Repeat("あ", 256), ContentType: "text/plain", SizeBytes: int64p(1)}, "file_name", chat.ReasonTooLong},
		{"file name with slash", chat.AttachmentInput{FileName: "../a.txt", ContentType: "text/plain", SizeBytes: int64p(1)}, "file_name", chat.ReasonInvalidFormat},
		{"file name with backslash", chat.AttachmentInput{FileName: `a\b.txt`, ContentType: "text/plain", SizeBytes: int64p(1)}, "file_name", chat.ReasonInvalidFormat},
		{"file name with newline", chat.AttachmentInput{FileName: "a\nb.txt", ContentType: "text/plain", SizeBytes: int64p(1)}, "file_name", chat.ReasonInvalidFormat},
		{"missing content type", chat.AttachmentInput{FileName: "a", SizeBytes: int64p(1)}, "content_type", chat.ReasonRequired},
		{"content type with parameter", chat.AttachmentInput{FileName: "a", ContentType: "text/plain; charset=utf-8", SizeBytes: int64p(1)}, "content_type", chat.ReasonInvalidFormat},
		{"upper case content type", chat.AttachmentInput{FileName: "a", ContentType: "Text/Plain", SizeBytes: int64p(1)}, "content_type", chat.ReasonInvalidFormat},
		{"content type without subtype", chat.AttachmentInput{FileName: "a", ContentType: "text", SizeBytes: int64p(1)}, "content_type", chat.ReasonInvalidFormat},
		// SVG はスクリプトを含められるので許可リストに入れていない。クライアントは octet-stream として送る。
		{"not allowed content type", chat.AttachmentInput{FileName: "a.svg", ContentType: "image/svg+xml", SizeBytes: int64p(1)}, "content_type", chat.ReasonInvalidValue},
		{"missing size", chat.AttachmentInput{FileName: "a", ContentType: "text/plain"}, "size_bytes", chat.ReasonRequired},
		{"zero size", chat.AttachmentInput{FileName: "a", ContentType: "text/plain", SizeBytes: int64p(0)}, "size_bytes", chat.ReasonOutOfRange},
		{"too large", chat.AttachmentInput{FileName: "a", ContentType: "text/plain", SizeBytes: int64p(max + 1)}, "size_bytes", chat.ReasonOutOfRange},
		{"width without height", chat.AttachmentInput{FileName: "a", ContentType: "image/png", SizeBytes: int64p(1), Width: intp(1)}, "height", chat.ReasonRequired},
		{"height without width", chat.AttachmentInput{FileName: "a", ContentType: "image/png", SizeBytes: int64p(1), Height: intp(1)}, "width", chat.ReasonRequired},
		{"dimensions for non-image", chat.AttachmentInput{FileName: "a", ContentType: "application/pdf", SizeBytes: int64p(1), Width: intp(1), Height: intp(1)}, "width", chat.ReasonInvalidValue},
		{"zero width", chat.AttachmentInput{FileName: "a", ContentType: "image/png", SizeBytes: int64p(1), Width: intp(0), Height: intp(1)}, "width", chat.ReasonOutOfRange},
		{"huge height", chat.AttachmentInput{FileName: "a", ContentType: "image/png", SizeBytes: int64p(1), Width: intp(1), Height: intp(65536)}, "height", chat.ReasonOutOfRange},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.CreateAttachment(t.Context(), r.member, public.ID, tt.in)
			expectValidation(t, err, tt.field, tt.reason)
		})
	}
	// 境界の値と、種類の分からないファイル（.fig など）は受け付ける。
	for _, in := range []chat.AttachmentInput{
		{FileName: strings.Repeat("あ", 255), ContentType: "text/plain", SizeBytes: int64p(max)},
		{FileName: "サイドバー改訂.fig", ContentType: "application/octet-stream", SizeBytes: int64p(1)},
		{FileName: "a.png", ContentType: "image/png", SizeBytes: int64p(1), Width: intp(65535), Height: intp(1)},
	} {
		if _, err := env.Service.CreateAttachment(t.Context(), r.member, public.ID, in); err != nil {
			t.Errorf("CreateAttachment(%s) error = %v", in.FileName, err)
		}
	}
}

// ロードマップ Phase 3c の DoD: 発行 → 直接 PUT → complete → メッセージに添付 → GET URL の取得 が通る。
func TestAttachmentFlow(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	body := []byte("hibari の添付ファイル")
	in := textInput("メモ \"最終\".txt", body)

	created, err := env.Service.CreateAttachment(t.Context(), r.member, public.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	id := created.Attachment.ID
	// PUT する前の complete は、オブジェクトがないので失敗し、状態は変わらない。
	if _, err := env.Service.CompleteAttachment(t.Context(), r.member, id); !errors.Is(err, chat.ErrAttachmentNotUploaded) {
		t.Fatalf("complete before PUT error = %v, want ErrAttachmentNotUploaded", err)
	}
	// 申告より大きいファイルは、ストレージが拒否する（ロードマップ Phase 3c の DoD）。
	if status := putUpload(t, created.Upload, append(bytes.Clone(body), '!')); status != http.StatusForbidden {
		t.Fatalf("PUT larger than declared = %d, want 403", status)
	}
	if status := putUpload(t, created.Upload, body); status != http.StatusOK {
		t.Fatalf("PUT = %d, want 200", status)
	}
	// 本人以外は complete できず、存在も分からない。
	if _, err := env.Service.CompleteAttachment(t.Context(), r.member2, id); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("complete by another user error = %v, want ErrNotFound", err)
	}
	for range 2 { // 冪等
		att, err := env.Service.CompleteAttachment(t.Context(), r.member, id)
		if err != nil || att.Status != chat.AttachmentUploaded {
			t.Fatalf("CompleteAttachment() = %+v, error %v", att, err)
		}
	}
	// メッセージに付く前は、本人でも GET URL を取得できない。
	if _, err := env.Service.GetAttachmentURL(t.Context(), r.member, id); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("GetAttachmentURL() before attaching error = %v, want ErrNotFound", err)
	}

	msg, created2, err := env.Service.SendMessage(t.Context(), r.member, public.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), AttachmentIDs: []ulid.ULID{id}})
	if err != nil || !created2 {
		t.Fatalf("SendMessage() with attachment only = created %v, error %v", created2, err)
	}
	if msg.Body != "" || len(msg.Attachments) != 1 || msg.Attachments[0].ID != id || msg.Attachments[0].FileName != in.FileName ||
		msg.Attachments[0].SizeBytes != int64(len(body)) || msg.Attachments[0].ContentType != "text/plain" || msg.Attachments[0].Width != nil {
		t.Fatalf("message = %+v", msg)
	}
	if got := attachmentStatus(t, env, id); got != "attached" {
		t.Errorf("status = %q, want attached", got)
	}
	// 添付のないメッセージと混ぜても、一覧で正しいメッセージに載る。
	plain := send(t, env, r.member, public.ID, "添付なし")
	page, err := env.Service.ListMessages(t.Context(), r.owner, public.ID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	// 一覧にはルームの作成などのログ（ADR 0033）も混ざるので、人の発言だけを見る。
	msgs := userMessagesOf(page.Messages)
	if len(msgs) != 2 || len(msgs[0].Attachments) != 1 || msgs[1].ID != plain.ID || msgs[1].Attachments == nil || len(msgs[1].Attachments) != 0 {
		t.Errorf("messages = %+v", page.Messages)
	}

	// public ルームは参加していないメンバーも読めるので、GET URL を取得できる。
	dl, err := env.Service.GetAttachmentURL(t.Context(), r.owner, id)
	if err != nil {
		t.Fatal(err)
	}
	if !dl.ExpiresAt.Equal(env.Clock.Now().Add(5 * time.Minute)) {
		t.Errorf("expires_at = %v", dl.ExpiresAt)
	}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, dl.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	// 画像以外はダウンロードさせる。ファイル名は RFC 2231 の形式で符号化される。
	if resp.StatusCode != http.StatusOK || !bytes.Equal(got, body) ||
		resp.Header.Get("Content-Disposition") != `attachment; filename*=utf-8''%E3%83%A1%E3%83%A2%20%22%E6%9C%80%E7%B5%82%22.txt` {
		t.Errorf("GET = %d %q, Content-Disposition %q", resp.StatusCode, got, resp.Header.Get("Content-Disposition"))
	}

	for _, tt := range []struct {
		name  string
		actor ulid.ULID
	}{
		{"outsider", r.outsider},
		{"unknown attachment", r.member},
	} {
		t.Run(tt.name, func(t *testing.T) {
			target := id
			if tt.name == "unknown attachment" {
				target = env.IDs.New()
			}
			if _, err := env.Service.GetAttachmentURL(t.Context(), tt.actor, target); !errors.Is(err, chat.ErrNotFound) {
				t.Errorf("GetAttachmentURL() error = %v, want ErrNotFound", err)
			}
		})
	}
}

// ロードマップ Phase 3c の DoD: ルームのメンバーでないユーザーは GET URL を取得できない。
func TestGetAttachmentURLPrivateRoom(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	if err := env.Service.AddRoomMember(t.Context(), r.member, private.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	body := []byte{0x89, 'P', 'N', 'G'}
	att := uploadAttachment(t, env, r.member, private.ID, chat.AttachmentInput{FileName: "a.png", ContentType: "image/png", SizeBytes: int64p(4)}, body)
	if _, _, err := env.Service.SendMessage(t.Context(), r.member, private.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "画像", AttachmentIDs: []ulid.ULID{att.ID}}); err != nil {
		t.Fatal(err)
	}

	dl, err := env.Service.GetAttachmentURL(t.Context(), r.member2, att.ID)
	if err != nil {
		t.Fatalf("GetAttachmentURL() as room member error = %v", err)
	}
	// 安全な画像はブラウザで開かせる。
	if !strings.Contains(dl.URL, "response-content-disposition=inline") {
		t.Errorf("URL = %s, want inline disposition", dl.URL)
	}
	for _, actor := range []ulid.ULID{r.owner, r.admin, r.outsider} {
		if _, err := env.Service.GetAttachmentURL(t.Context(), actor, att.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("GetAttachmentURL() as non-member error = %v, want ErrNotFound", err)
		}
	}
	// ルームから外されたら取得できなくなる。
	if err := env.Service.RemoveRoomMember(t.Context(), r.member2, private.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.GetAttachmentURL(t.Context(), r.member2, att.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("GetAttachmentURL() after leaving error = %v, want ErrNotFound", err)
	}
}

// ロードマップ Phase 3c の DoD: 他人がアップロードした添付を自分のメッセージに付けられない。
// 付けられない添付を指定した送信は、seq を消費せず、ほかの添付も付けない（トランザクションごとロールバックする）。
func TestSendMessageRejectsAttachments(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	other := createRoom(t, env, r.member, r.ws.ID, "public", "other")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	body := []byte("x")
	mine := uploadAttachment(t, env, r.member, room.ID, textInput("mine.txt", body), body)
	others := uploadAttachment(t, env, r.member2, room.ID, textInput("others.txt", body), body)
	otherRoom := uploadAttachment(t, env, r.member, other.ID, textInput("other-room.txt", body), body)
	pending, err := env.Service.CreateAttachment(t.Context(), r.member, room.ID, textInput("pending.txt", body))
	if err != nil {
		t.Fatal(err)
	}
	used := uploadAttachment(t, env, r.member, room.ID, textInput("used.txt", body), body)
	if _, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "使用済み", AttachmentIDs: []ulid.ULID{used.ID}}); err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		name string
		ids  []ulid.ULID
	}{
		{"another user's attachment", []ulid.ULID{mine.ID, others.ID}},
		{"attachment in another room", []ulid.ULID{mine.ID, otherRoom.ID}},
		{"not completed", []ulid.ULID{mine.ID, pending.Attachment.ID}},
		{"already attached", []ulid.ULID{mine.ID, used.ID}},
		{"unknown", []ulid.ULID{mine.ID, env.IDs.New()}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before := roomLastMessageSeq(t, env, room.ID)
			_, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x", AttachmentIDs: tt.ids})
			expectValidation(t, err, "attachment_ids", chat.ReasonInvalidValue)
			if roomLastMessageSeq(t, env, room.ID) != before {
				t.Error("a rejected message consumed a seq")
			}
			if got := attachmentStatus(t, env, mine.ID); got != "uploaded" {
				t.Errorf("valid attachment status = %q, want uploaded (rolled back)", got)
			}
		})
	}

	eleven := make([]ulid.ULID, chat.MaxAttachmentsPerMessage+1)
	for i := range eleven {
		eleven[i] = env.IDs.New()
	}
	for _, tt := range []struct {
		name          string
		in            chat.SendMessageInput
		field, reason string
	}{
		{"too many", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x", AttachmentIDs: eleven}, "attachment_ids", chat.ReasonTooLong},
		{"duplicated", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "x", AttachmentIDs: []ulid.ULID{mine.ID, mine.ID}}, "attachment_ids", chat.ReasonInvalidValue},
		// 添付がなければ、これまでどおり本文は必須。
		{"empty body without attachments", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: " "}, "body", chat.ReasonRequired},
		// 添付があっても、長さと制御文字は検証する。
		{"control character with attachments", chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "\x00", AttachmentIDs: []ulid.ULID{mine.ID}}, "body", chat.ReasonInvalidFormat},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, tt.in)
			expectValidation(t, err, tt.field, tt.reason)
		})
	}

	// 同じ client_msg_id の再送は、attachment_ids を比べずに既存を返す（ADR 0012）。
	clientMsgID := env.IDs.New()
	first, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: clientMsgID, AttachmentIDs: []ulid.ULID{mine.ID}})
	if err != nil {
		t.Fatal(err)
	}
	again, created, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: clientMsgID, AttachmentIDs: []ulid.ULID{mine.ID}})
	if err != nil || created || again.ID != first.ID || len(again.Attachments) != 1 {
		t.Errorf("retry = %+v, created %v, error %v", again, created, err)
	}
}

// 同じ添付を並行した送信が使おうとしても、付くのは 1 つのメッセージだけで、seq に欠番もできない。
func TestAttachConcurrent(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	room := createRoom(t, env, owner, ws.ID, "public", "public")
	// ルームの作成のログ（ADR 0033）が seq を 1 つ使っている。
	base := roomLastMessageSeq(t, env, room.ID)
	body := []byte("x")
	att := uploadAttachment(t, env, owner, room.ID, textInput("a.txt", body), body)

	const n = 20
	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		succeeded int
		start     = make(chan struct{})
	)
	for range n {
		wg.Go(func() {
			<-start
			_, _, err := env.Service.SendMessage(t.Context(), owner, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), AttachmentIDs: []ulid.ULID{att.ID}})
			var verr *chat.ValidationError
			switch {
			case err == nil:
				mu.Lock()
				succeeded++
				mu.Unlock()
			case !errors.As(err, &verr):
				t.Errorf("SendMessage() error = %v", err)
			}
		})
	}
	close(start)
	wg.Wait()

	if succeeded != 1 || userMessageCount(t, env, room.ID) != 1 || roomLastMessageSeq(t, env, room.ID) != base+1 {
		t.Errorf("succeeded = %d, user messages = %d, last_message_seq = %d; want 1, 1, %d",
			succeeded, userMessageCount(t, env, room.ID), roomLastMessageSeq(t, env, room.ID), base+1)
	}
}

// ストレージが署名どおりに拒否しなかった場合の最後の防御。申告と違うオブジェクトは消して、uploaded にしない。
func TestCompleteAttachmentMismatch(t *testing.T) {
	env := chattest.New(t)
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	room := createRoom(t, env, owner, ws.ID, "public", "public")

	created, err := env.Service.CreateAttachment(t.Context(), owner, room.ID, textInput("a.txt", []byte("0123456789")))
	if err != nil {
		t.Fatal(err)
	}
	key := objectKey(t, env, created.Attachment.ID)
	// 同じキーに、申告と違うサイズのオブジェクトを置く（署名を無視するストレージを再現する）。
	req, err := env.Storage.PresignPut(t.Context(), key, "text/plain", 11, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if status := putUpload(t, chat.UploadRequest{Method: req.Method, URL: req.URL, Header: map[string]string{"Content-Type": "text/plain"}}, []byte("0123456789A")); status != http.StatusOK {
		t.Fatalf("PUT = %d", status)
	}

	if _, err := env.Service.CompleteAttachment(t.Context(), owner, created.Attachment.ID); !errors.Is(err, chat.ErrAttachmentMismatch) {
		t.Fatalf("CompleteAttachment() error = %v, want ErrAttachmentMismatch", err)
	}
	if got := attachmentStatus(t, env, created.Attachment.ID); got != "pending" {
		t.Errorf("status = %q, want pending", got)
	}
	if objectExists(t, env, key) {
		t.Error("mismatched object was not deleted")
	}
}

// メッセージを削除したら、添付は deleted になり、一覧にも GET URL にも出なくなる。オブジェクトは掃除ジョブが消す。
func TestDeleteMessageMarksAttachmentsDeleted(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	body := []byte("x")
	att := uploadAttachment(t, env, r.member, room.ID, textInput("a.txt", body), body)
	msg, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), AttachmentIDs: []ulid.ULID{att.ID}})
	if err != nil {
		t.Fatal(err)
	}
	// admin による削除（ADR 0012）でも同じ。
	if err := env.Service.DeleteMessage(t.Context(), r.admin, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}
	if got := attachmentStatus(t, env, att.ID); got != "deleted" {
		t.Errorf("status = %q, want deleted", got)
	}
	if !objectExists(t, env, objectKey(t, env, att.ID)) {
		t.Error("object was deleted inside the transaction; it should be left to the cleanup job")
	}
	page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	// 一覧にはルームの作成のログ（ADR 0033）も混ざるので、人の発言だけを見る。
	msgs := userMessagesOf(page.Messages)
	if len(msgs) != 1 || msgs[0].DeletedAt == nil || len(msgs[0].Attachments) != 0 {
		t.Errorf("messages = %+v", page.Messages)
	}
	if _, err := env.Service.GetAttachmentURL(t.Context(), r.member, att.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("GetAttachmentURL() error = %v, want ErrNotFound", err)
	}
	if _, err := env.Service.CompleteAttachment(t.Context(), r.member, att.ID); !errors.Is(err, chat.ErrNotFound) {
		t.Errorf("CompleteAttachment() error = %v, want ErrNotFound", err)
	}
}

// cleanupEpoch は掃除ジョブのテストの時計の初期値。ほかのテストの添付を消さないよう、十分に過去にする（chattest.WithClockStart）。
var cleanupEpoch = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)

// ロードマップ Phase 3c の DoD: 期限切れの pending が掃除される（Clock を進めるテスト）。
func TestCleanupAttachments(t *testing.T) {
	env := chattest.New(t, chattest.WithClockStart(cleanupEpoch))
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	room := createRoom(t, env, owner, ws.ID, "public", "public")
	body := []byte("x")

	stalePending, err := env.Service.CreateAttachment(t.Context(), owner, room.ID, textInput("pending.txt", body))
	if err != nil {
		t.Fatal(err)
	}
	// PUT だけ済ませて complete しなかった添付も、オブジェクトごと消える。
	if status := putUpload(t, stalePending.Upload, body); status != http.StatusOK {
		t.Fatal(status)
	}
	staleUploaded := uploadAttachment(t, env, owner, room.ID, textInput("uploaded.txt", body), body)
	oldAttached := uploadAttachment(t, env, owner, room.ID, textInput("attached.txt", body), body)
	if _, _, err := env.Service.SendMessage(t.Context(), owner, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), AttachmentIDs: []ulid.ULID{oldAttached.ID}}); err != nil {
		t.Fatal(err)
	}

	// 24 時間ちょうどでは消さない。
	env.Clock.Advance(24 * time.Hour)
	if _, err := env.Service.CleanupAttachments(t.Context()); err != nil {
		t.Fatal(err)
	}
	if attachmentStatus(t, env, stalePending.Attachment.ID) != "pending" || attachmentStatus(t, env, staleUploaded.ID) != "uploaded" {
		t.Fatal("attachments were deleted before the retention period passed")
	}

	env.Clock.Advance(time.Second)
	freshUploaded := uploadAttachment(t, env, owner, room.ID, textInput("fresh.txt", body), body)
	deletedAtt := uploadAttachment(t, env, owner, room.ID, textInput("deleted.txt", body), body)
	msg, _, err := env.Service.SendMessage(t.Context(), owner, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), AttachmentIDs: []ulid.ULID{deletedAtt.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if err := env.Service.DeleteMessage(t.Context(), owner, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}
	keys := map[ulid.ULID]string{}
	for _, id := range []ulid.ULID{stalePending.Attachment.ID, staleUploaded.ID, oldAttached.ID, freshUploaded.ID, deletedAtt.ID} {
		keys[id] = objectKey(t, env, id)
	}

	// 件数は「少なくとも自分の 3 件」までしか確かめない。テスト用 DB はパッケージをまたいで共有していて、
	// 削除されたメッセージの添付（status = deleted）は古さに関係なく対象になるので、ほかのパッケージのテスト
	// （internal/httpx のメッセージの削除など）が同時に作った行もこの実行で消えうる。
	n, err := env.Service.CleanupAttachments(t.Context())
	if err != nil {
		t.Fatalf("CleanupAttachments() error = %v", err)
	}
	if n < 3 {
		t.Errorf("deleted = %d, want at least 3", n)
	}
	for _, tt := range []struct {
		name string
		id   ulid.ULID
		kept bool
	}{
		{"stale pending", stalePending.Attachment.ID, false},
		{"stale uploaded", staleUploaded.ID, false},
		{"old but attached", oldAttached.ID, true},
		{"fresh uploaded", freshUploaded.ID, true},
		{"message deleted", deletedAtt.ID, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if rowKept := attachmentStatus(t, env, tt.id) != ""; rowKept != tt.kept {
				t.Errorf("row kept = %v, want %v", rowKept, tt.kept)
			}
			if exists := objectExists(t, env, keys[tt.id]); exists != tt.kept {
				t.Errorf("object exists = %v, want %v", exists, tt.kept)
			}
		})
	}

	// もう一度実行しても、残すべき添付は残る（自分の対象はもうない）。
	// 件数が 0 であることは確かめない。上と同じ理由で、ほかのテストが同時に作った行を消すことがある。
	if _, err := env.Service.CleanupAttachments(t.Context()); err != nil {
		t.Fatalf("second CleanupAttachments() error = %v", err)
	}
	for _, id := range []ulid.ULID{oldAttached.ID, freshUploaded.ID} {
		if attachmentStatus(t, env, id) == "" || !objectExists(t, env, keys[id]) {
			t.Errorf("attachment %s was deleted by the second run", id)
		}
	}
}

// 掃除ジョブの goroutine は、context のキャンセルで終わる（CLAUDE.md「goroutine を起動したら、必ず終了条件を用意する」）。
func TestRunAttachmentCleanupStops(t *testing.T) {
	env := chattest.New(t, chattest.WithClockStart(cleanupEpoch))
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		// 間隔を長くしても、キャンセルすればすぐに返る。
		env.Service.RunAttachmentCleanup(ctx, time.Hour)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("RunAttachmentCleanup did not return after the context was canceled")
	}
}

// barrierStorage は Delete の回数をキーごとに数える。各インスタンスの最初の Delete は、両方のインスタンスが Delete に
// 到達するまで待つ（トランザクションで行をロックしたまま待つので、2 台の掃除が確実に重なる）。
// SKIP LOCKED でなければ、2 台目はロックされた行を待って Delete に到達できず、待ち合わせが時間切れになる。
type barrierStorage struct {
	chat.Storage
	t      *testing.T
	counts *sync.Map // key → *atomic.Int32
	first  *sync.Once
	ready  *sync.WaitGroup
	both   <-chan struct{}
}

func (s barrierStorage) Delete(_ context.Context, key string) error {
	s.first.Do(func() {
		s.ready.Done()
		select {
		case <-s.both:
		case <-time.After(10 * time.Second):
			s.t.Error("the other instance did not reach Delete while this one held row locks")
		}
	})
	n, _ := s.counts.LoadOrStore(key, new(atomic.Int32))
	n.(*atomic.Int32).Add(1)
	return nil
}

// ロードマップ Phase 5: 掃除ジョブを複数台で同時に実行しても、同じ添付を重複して消さない（FOR UPDATE SKIP LOCKED）。
func TestCleanupAttachmentsConcurrentInstances(t *testing.T) {
	env := chattest.New(t, chattest.WithClockStart(cleanupEpoch))
	owner := env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	room := createRoom(t, env, owner, ws.ID, "public", "public")
	// 1 回のトランザクションで消す件数（100）より多くして、2 台が別々の行の塊を取れるようにする。
	const n = 250
	created := make([]ulid.ULID, n)
	for i := range created {
		a, err := env.Service.CreateAttachment(t.Context(), owner, room.ID, textInput("stale.txt", []byte("x")))
		if err != nil {
			t.Fatal(err)
		}
		created[i] = a.Attachment.ID
	}
	keys := map[string]bool{}
	for _, id := range created {
		keys[objectKey(t, env, id)] = true
	}
	env.Clock.Advance(25 * time.Hour)

	var counts sync.Map
	var ready sync.WaitGroup
	ready.Add(2)
	both := make(chan struct{})
	go func() {
		ready.Wait()
		close(both)
	}()
	var wg sync.WaitGroup
	for range 2 {
		svc := chat.NewService(chat.Deps{
			DB: env.Pool, Clock: env.Clock, IDs: env.IDs, Logger: slog.New(slog.DiscardHandler),
			Storage:  barrierStorage{Storage: env.Storage, t: t, counts: &counts, first: &sync.Once{}, ready: &ready, both: both},
			Delivery: chat.NopDelivery{}, Presence: env.Presence,
		})
		wg.Go(func() {
			if _, err := svc.CleanupAttachments(context.Background()); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()

	counts.Range(func(key, v any) bool {
		if c := v.(*atomic.Int32).Load(); c != 1 {
			t.Errorf("object %s deleted %d times", key, c)
		}
		delete(keys, key.(string))
		return true
	})
	if len(keys) != 0 {
		t.Errorf("%d objects were not deleted", len(keys))
	}
	for _, id := range created {
		if status := attachmentStatus(t, env, id); status != "" {
			t.Fatalf("attachment %s still exists with status %q", id, status)
		}
	}
}

// 添付ファイルだけの削除（ADR 0045）。

// attachedMessage は、本文 body と n 件の添付を付けたメッセージを作る。
func attachedMessage(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID, body string, n int) (chat.Message, []chat.Attachment) {
	t.Helper()
	atts := make([]chat.Attachment, n)
	ids := make([]ulid.ULID, n)
	for i := range atts {
		content := []byte(strings.Repeat("x", i+1))
		atts[i] = uploadAttachment(t, env, actor, roomID, textInput("a.txt", content), content)
		ids[i] = atts[i].ID
	}
	msg, created, err := env.Service.SendMessage(t.Context(), actor, roomID, chat.SendMessageInput{
		ClientMsgID: env.IDs.New(), Body: body, AttachmentIDs: ids,
	})
	if err != nil || !created {
		t.Fatalf("SendMessage() = created %v, error %v", created, err)
	}
	return msg, atts
}

func TestDeleteMessageAttachment(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "files")
	msg, atts := attachedMessage(t, env, r.member, room.ID, "資料です", 2)
	env.Deliveries.Take()

	got, err := env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, msg.ID, atts[0].ID)
	if err != nil {
		t.Fatalf("DeleteMessageAttachment() error = %v", err)
	}

	t.Run("消した添付だけがメッセージから消える", func(t *testing.T) {
		if len(got.Attachments) != 1 || got.Attachments[0].ID != atts[1].ID {
			t.Errorf("attachments = %+v, want [%s]", got.Attachments, atts[1].ID)
		}
		if got.DeletedAt != nil || got.Body != "資料です" {
			t.Errorf("message = %+v, want 本文の残ったメッセージ", got)
		}
	})

	t.Run("change_seq だけが進む", func(t *testing.T) {
		if got.ChangeSeq <= msg.ChangeSeq {
			t.Errorf("change_seq = %d, want > %d", got.ChangeSeq, msg.ChangeSeq)
		}
		// 添付が減るのは発言ではないので、順序も未読もサイドバーの並びも動かさない（ADR 0045 決定 7）
		if got.Seq != msg.Seq || got.UserSeq != msg.UserSeq {
			t.Errorf("seq, user_seq = %d, %d; want %d, %d", got.Seq, got.UserSeq, msg.Seq, msg.UserSeq)
		}
		// 編集ではないので「（編集済み）」を付けない
		if got.EditedAt != nil {
			t.Errorf("edited_at = %v, want nil", got.EditedAt)
		}
	})

	t.Run("message.updated を配る", func(t *testing.T) {
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventMessageUpdated {
			t.Fatalf("events = %+v, want 1 件の message.updated", evs)
		}
		if !slices.Contains(evs[0].To.Rooms, room.ID) {
			t.Errorf("宛先 = %+v, want ルーム %s", evs[0].To, room.ID)
		}
	})

	t.Run("実体は掃除ジョブに任せる（ADR 0013）", func(t *testing.T) {
		if status := attachmentStatus(t, env, atts[0].ID); status != "deleted" {
			t.Errorf("status = %q, want deleted", status)
		}
		if !objectExists(t, env, objectKey(t, env, atts[0].ID)) {
			t.Error("オブジェクトがトランザクションの中で消された。掃除ジョブに任せる")
		}
	})

	t.Run("消した添付の GET URL はもう取れない", func(t *testing.T) {
		if _, err := env.Service.GetAttachmentURL(t.Context(), r.member, atts[0].ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("GetAttachmentURL() error = %v, want ErrNotFound", err)
		}
		if _, err := env.Service.GetAttachmentURL(t.Context(), r.member, atts[1].ID); err != nil {
			t.Errorf("残っている添付の GET URL が取れない: %v", err)
		}
	})

	t.Run("もう一度消しても成功し、番号を進めない（冪等）", func(t *testing.T) {
		again, err := env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, msg.ID, atts[0].ID)
		if err != nil {
			t.Fatalf("DeleteMessageAttachment() error = %v", err)
		}
		if again.ChangeSeq != got.ChangeSeq {
			t.Errorf("change_seq = %d, want %d のまま", again.ChangeSeq, got.ChangeSeq)
		}
		if evs := env.Deliveries.Take(); len(evs) != 0 {
			t.Errorf("events = %+v, want 0 件", evs)
		}
	})
}

func TestDeleteMessageAttachmentPermission(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "files")
	for _, u := range []ulid.ULID{r.member2, r.admin} {
		if _, err := env.Service.JoinRoom(t.Context(), u, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	msg, atts := attachedMessage(t, env, r.member, room.ID, "資料です", 2)

	t.Run("他人のメッセージの添付は消せない", func(t *testing.T) {
		_, err := env.Service.DeleteMessageAttachment(t.Context(), r.member2, room.ID, msg.ID, atts[0].ID)
		if !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("error = %v, want ErrForbidden", err)
		}
		if status := attachmentStatus(t, env, atts[0].ID); status != "attached" {
			t.Errorf("status = %q, want attached のまま", status)
		}
	})

	t.Run("admin は member の添付を消せる（ADR 0012 と同じ判定）", func(t *testing.T) {
		if _, err := env.Service.DeleteMessageAttachment(t.Context(), r.admin, room.ID, msg.ID, atts[0].ID); err != nil {
			t.Errorf("DeleteMessageAttachment() error = %v", err)
		}
	})

	t.Run("admin でも、自分より上の人の添付は消せない", func(t *testing.T) {
		if _, err := env.Service.JoinRoom(t.Context(), r.owner, room.ID); err != nil {
			t.Fatal(err)
		}
		ownerMsg, ownerAtts := attachedMessage(t, env, r.owner, room.ID, "オーナーの資料", 1)
		_, err := env.Service.DeleteMessageAttachment(t.Context(), r.admin, room.ID, ownerMsg.ID, ownerAtts[0].ID)
		if !errors.Is(err, chat.ErrForbidden) {
			t.Errorf("error = %v, want ErrForbidden", err)
		}
	})

	t.Run("ルームを読めない人には存在も明かさない", func(t *testing.T) {
		_, err := env.Service.DeleteMessageAttachment(t.Context(), r.outsider, room.ID, msg.ID, atts[1].ID)
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})
}

func TestDeleteMessageAttachmentNotFound(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "files")
	msg, atts := attachedMessage(t, env, r.member, room.ID, "資料です", 1)
	other, otherAtts := attachedMessage(t, env, r.member, room.ID, "こちらも", 1)
	content := []byte("y")
	uploaded := uploadAttachment(t, env, r.member, room.ID, textInput("b.txt", content), content)

	for _, tt := range []struct {
		name         string
		messageID    ulid.ULID
		attachmentID ulid.ULID
	}{
		{"存在しない添付", msg.ID, env.IDs.New()},
		{"別のメッセージの添付", msg.ID, otherAtts[0].ID},
		{"まだメッセージに付いていない添付", msg.ID, uploaded.ID},
		{"存在しないメッセージ", env.IDs.New(), atts[0].ID},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, tt.messageID, tt.attachmentID)
			if !errors.Is(err, chat.ErrNotFound) {
				t.Errorf("error = %v, want ErrNotFound", err)
			}
		})
	}

	t.Run("削除済みのメッセージの添付は 404（跡を残さない。ADR 0038）", func(t *testing.T) {
		if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, other.ID); err != nil {
			t.Fatal(err)
		}
		_, err := env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, other.ID, otherAtts[0].ID)
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("error = %v, want ErrNotFound", err)
		}
	})
}

// 最後の 1 件を消して本文も空なら、メッセージごと消える（ADR 0045 決定 8）。
func TestDeleteLastAttachmentDeletesMessage(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "files")

	t.Run("本文が残っていればメッセージは残る", func(t *testing.T) {
		msg, atts := attachedMessage(t, env, r.member, room.ID, "こちらです", 1)
		env.Deliveries.Take()

		got, err := env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, msg.ID, atts[0].ID)
		if err != nil {
			t.Fatalf("DeleteMessageAttachment() error = %v", err)
		}
		if got.DeletedAt != nil || got.Body != "こちらです" || len(got.Attachments) != 0 {
			t.Errorf("message = %+v, want 本文だけが残ったメッセージ", got)
		}
		if evs := env.Deliveries.Take(); len(evs) != 1 || evs[0].Type != chat.EventMessageUpdated {
			t.Errorf("events = %+v, want 1 件の message.updated", evs)
		}
	})

	t.Run("本文も空ならメッセージごと消える", func(t *testing.T) {
		msg, atts := attachedMessage(t, env, r.member, room.ID, "", 1)
		env.Deliveries.Take()

		got, err := env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, msg.ID, atts[0].ID)
		if err != nil {
			t.Fatalf("DeleteMessageAttachment() error = %v", err)
		}
		if got.DeletedAt == nil || len(got.Attachments) != 0 {
			t.Errorf("message = %+v, want tombstone", got)
		}
		if evs := env.Deliveries.Take(); len(evs) != 1 || evs[0].Type != chat.EventMessageDeleted {
			t.Errorf("events = %+v, want 1 件の message.deleted", evs)
		}
		// 一覧には tombstone として返る（跡を出さないのはクライアントの仕事。ADR 0038）
		page, err := env.Service.ListMessages(t.Context(), r.member, room.ID, chat.MessageQuery{})
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(page.Messages, func(m chat.Message) bool { return m.ID == msg.ID })
		if i < 0 || page.Messages[i].DeletedAt == nil || len(page.Messages[i].Attachments) != 0 {
			t.Errorf("一覧のメッセージ = %+v, want tombstone", page.Messages)
		}
	})

	t.Run("スレッドの返信なら、親の返信数の変化も配る（ADR 0036）", func(t *testing.T) {
		root := send(t, env, r.member, room.ID, "スレッドの親")
		content := []byte("z")
		att := uploadAttachment(t, env, r.member, room.ID, textInput("c.txt", content), content)
		reply, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{
			ClientMsgID: env.IDs.New(), ThreadRootID: &root.ID, AttachmentIDs: []ulid.ULID{att.ID},
		})
		if err != nil {
			t.Fatal(err)
		}
		env.Deliveries.Take()

		if _, err := env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, reply.ID, att.ID); err != nil {
			t.Fatalf("DeleteMessageAttachment() error = %v", err)
		}
		evs := env.Deliveries.Take()
		if len(evs) != 2 || evs[0].Type != chat.EventMessageDeleted || evs[1].Type != chat.EventMessageUpdated {
			t.Fatalf("events = %+v, want message.deleted と親の message.updated", evs)
		}
		got := getMessage(t, env, r.member, room.ID, root.ID)
		if got.Thread == nil || got.Thread.ReplyCount != 0 {
			t.Errorf("親の thread = %+v, want 返信 0 件", got.Thread)
		}
	})
}

// 同じ添付を同時に消しても、番号を使うのも配信も 1 回だけ（ADR 0045 決定 7）。
func TestDeleteMessageAttachmentConcurrent(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "files")
	msg, atts := attachedMessage(t, env, r.member, room.ID, "資料です", 1)
	env.Deliveries.Take()

	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = env.Service.DeleteMessageAttachment(t.Context(), r.member, room.ID, msg.ID, atts[0].ID)
		}()
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("DeleteMessageAttachment(%d) error = %v", i, err)
		}
	}
	if evs := env.Deliveries.Take(); len(evs) != 1 {
		t.Errorf("events = %d 件, want 1 件", len(evs))
	}
	if status := attachmentStatus(t, env, atts[0].ID); status != "deleted" {
		t.Errorf("status = %q, want deleted", status)
	}
}
