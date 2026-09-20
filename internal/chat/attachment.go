package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
)

// 添付ファイル（ロードマップ Phase 3c / ADR 0008 / ADR 0013）。
//
// ファイルの中身はサーバーを経由しない（CLAUDE.md ルール 10）。サーバーが行うのは、authz、署名付き URL の発行、
// アップロード後の HEAD による検証、メッセージへの紐付け、不要になったオブジェクトの掃除だけ。

var (
	// ErrAttachmentNotUploaded は、complete の時点でストレージにオブジェクトがないことを表す。
	ErrAttachmentNotUploaded = errors.New("chat: attachment has not been uploaded")
	// ErrAttachmentMismatch は、アップロードされたオブジェクトのサイズか Content-Type が申告と違うことを表す。
	ErrAttachmentMismatch = errors.New("chat: uploaded object does not match the attachment")
)

// Storage は chat が使うオブジェクトストレージの操作。internal/platform/storage の S3 が実装する。
type Storage interface {
	PresignPut(ctx context.Context, key, contentType string, size int64, ttl time.Duration) (storage.PresignedRequest, error)
	PresignGet(ctx context.Context, key string, ttl time.Duration, opts storage.GetOptions) (string, error)
	Head(ctx context.Context, key string) (storage.ObjectInfo, error)
	Delete(ctx context.Context, key string) error
}

// AttachmentLimits は添付ファイルの設定値（ロードマップ Phase 3c「MIME の許可リストとサイズの上限は設定値にする」）。
type AttachmentLimits struct {
	// MaxBytes は 1 ファイルのサイズの上限。
	MaxBytes int64
	// AllowedTypes は受け付ける Content-Type。パラメータのない小文字の type/subtype。
	AllowedTypes []string
}

const (
	// MaxAttachmentsPerMessage は 1 メッセージに付けられる添付の数。
	MaxAttachmentsPerMessage = 10
	// AttachmentCleanupInterval は掃除ジョブの実行間隔。
	AttachmentCleanupInterval = 10 * time.Minute

	attachmentFileNameMax  = 255
	attachmentDimensionMax = 65535
	// uploadURLTTL は PUT URL の有効期間。Content-Length を署名に含めるので、長めにしても申告と違うファイルは置けない。
	uploadURLTTL = 15 * time.Minute
	// downloadURLTTL は GET URL の有効期間。削除やキックの後も、この時間だけは発行済みの URL が使えてしまうので短くする。
	downloadURLTTL = 5 * time.Minute
	// attachmentRetention は、メッセージに付かなかった添付（pending / uploaded）を残す時間。
	attachmentRetention = 24 * time.Hour
	// cleanupBatchSize は掃除ジョブが 1 つのトランザクションで消す件数。ロックを持ったままストレージを呼ぶので小さくする。
	cleanupBatchSize = 100
)

// inlineTypes はブラウザで開かせてよい種類。スクリプトを含められない、ラスタ画像だけにする（SVG は含めない。ADR 0013）。
var inlineTypes = []string{"image/png", "image/jpeg", "image/gif", "image/webp"}

// AttachmentStatus は添付の状態。
type AttachmentStatus string

const (
	// AttachmentPending は URL を発行したが、まだ検証していない状態。
	AttachmentPending AttachmentStatus = "pending"
	// AttachmentUploaded は HEAD で検証済みで、メッセージに付けられる状態。
	AttachmentUploaded AttachmentStatus = "uploaded"
	// AttachmentAttached はメッセージに付いている状態。
	AttachmentAttached AttachmentStatus = "attached"
	// AttachmentDeleted はメッセージが削除され、掃除を待っている状態。
	AttachmentDeleted AttachmentStatus = "deleted"
)

// Attachment はアップロードした本人から見た添付。
type Attachment struct {
	ID          ulid.ULID
	RoomID      ulid.ULID
	Status      AttachmentStatus
	FileName    string
	ContentType string
	SizeBytes   int64
	// Width と Height は画像のときだけ入る。クライアントの申告値で、中身と一致するかは確かめていない（ADR 0013）。
	Width     *int
	Height    *int
	CreatedAt time.Time
}

func toAttachment(r store.Attachment) Attachment {
	return Attachment{
		ID:          r.ID,
		RoomID:      r.RoomID,
		Status:      AttachmentStatus(r.Status),
		FileName:    r.FileName,
		ContentType: r.MimeType,
		SizeBytes:   r.SizeBytes,
		Width:       intPtr(r.Width),
		Height:      intPtr(r.Height),
		CreatedAt:   r.CreatedAt,
	}
}

// MessageAttachment はメッセージに付いた添付。GET URL は含めない（ADR 0013）。
type MessageAttachment struct {
	ID          ulid.ULID
	FileName    string
	ContentType string
	SizeBytes   int64
	Width       *int
	Height      *int
}

func intPtr(v *int32) *int {
	if v == nil {
		return nil
	}
	i := int(*v)
	return &i
}

func int32Ptr(v *int) *int32 {
	if v == nil {
		return nil
	}
	i := int32(*v) // 検証で attachmentDimensionMax 以下にしてあるので、桁あふれしない。
	return &i
}

// AttachmentInput は添付のアップロード URL の発行の入力。
type AttachmentInput struct {
	FileName    string
	ContentType string
	// SizeBytes はファイルの正確なサイズ。署名に含めるので、違うサイズの PUT はストレージが拒否する。
	SizeBytes *int64
	// Width と Height は画像のときだけ任意で指定する。
	Width  *int
	Height *int
}

// UploadRequest はクライアントがストレージに直接送るリクエスト。
type UploadRequest struct {
	Method string
	URL    string
	// Header はクライアントが付けなければならないヘッダー。
	Header    map[string]string
	ExpiresAt time.Time
}

// CreatedAttachment は発行した添付と、そのアップロード URL。
type CreatedAttachment struct {
	Attachment Attachment
	Upload     UploadRequest
}

// validateMediaType は、パラメータのない小文字の type/subtype かどうかを返す。
// 署名に含めた Content-Type とクライアントが送る値が 1 文字でも違うと PUT が拒否されるので、表記の揺れを許さない。
func validateMediaType(s string) bool {
	mt, params, err := mime.ParseMediaType(s)
	return err == nil && len(params) == 0 && mt == s && strings.Contains(mt, "/")
}

func (l AttachmentLimits) validate(in AttachmentInput) error {
	var fields fieldErrors
	switch name := in.FileName; {
	case strings.TrimSpace(name) == "":
		fields.add("file_name", ReasonRequired)
	case utf8.RuneCountInString(name) > attachmentFileNameMax:
		fields.add("file_name", ReasonTooLong)
	case strings.ContainsAny(name, `/\`) || strings.ContainsFunc(name, unicode.IsControl):
		// パスの区切りを含む名前は、ダウンロード時にクライアントが保存先を取り違える原因になる。
		fields.add("file_name", ReasonInvalidFormat)
	}
	switch ct := in.ContentType; {
	case ct == "":
		fields.add("content_type", ReasonRequired)
	case !validateMediaType(ct):
		fields.add("content_type", ReasonInvalidFormat)
	case !slices.Contains(l.AllowedTypes, ct):
		fields.add("content_type", ReasonInvalidValue)
	}
	switch {
	case in.SizeBytes == nil:
		fields.add("size_bytes", ReasonRequired)
	case *in.SizeBytes < 1 || *in.SizeBytes > l.MaxBytes:
		fields.add("size_bytes", ReasonOutOfRange)
	}
	switch {
	case in.Width == nil && in.Height == nil:
	case in.Width == nil:
		fields.add("width", ReasonRequired)
	case in.Height == nil:
		fields.add("height", ReasonRequired)
	case !strings.HasPrefix(in.ContentType, "image/"):
		fields.add("width", ReasonInvalidValue)
		fields.add("height", ReasonInvalidValue)
	default:
		if *in.Width < 1 || *in.Width > attachmentDimensionMax {
			fields.add("width", ReasonOutOfRange)
		}
		if *in.Height < 1 || *in.Height > attachmentDimensionMax {
			fields.add("height", ReasonOutOfRange)
		}
	}
	return fields.err()
}

// attachmentObjectKey はオブジェクトのキー。ファイル名は入れない（任意の文字によるキーのエスケープやパスの解釈の違いを持ち込まないため）。
func attachmentObjectKey(roomID, attachmentID ulid.ULID) string {
	return "attachments/" + roomID.String() + "/" + attachmentID.String()
}

// CreateAttachment は、ルームに添付をアップロードするための URL を発行する。ルームに投稿できる人だけができる。
//
// pending の行を作ってから URL を返す。クライアントは URL に直接 PUT し、CompleteAttachment を呼ぶ。
func (s *Service) CreateAttachment(ctx context.Context, actor, roomID ulid.ULID, in AttachmentInput) (CreatedAttachment, error) {
	if err := s.attachmentLimits.validate(in); err != nil {
		return CreatedAttachment{}, err
	}
	q := store.New(s.db)
	// 1 文の INSERT だけなのでロックは取らない。判定の直後にキックされても、付けるときの送信で改めて判定される。
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return CreatedAttachment{}, err
	}
	if !authz.CanUploadAttachment(a.kind(), a.actor(actor)) {
		return CreatedAttachment{}, ErrForbidden
	}

	id := s.ids.New()
	key := attachmentObjectKey(roomID, id)
	now := s.clock.Now()
	err = q.CreateAttachment(ctx, store.CreateAttachmentParams{
		ID: id, RoomID: roomID, UploaderID: actor, ObjectKey: key, FileName: in.FileName, MimeType: in.ContentType,
		SizeBytes: *in.SizeBytes, Width: int32Ptr(in.Width), Height: int32Ptr(in.Height), Now: now,
	})
	if err != nil {
		return CreatedAttachment{}, fmt.Errorf("create attachment: %w", err)
	}
	// 署名は手元の計算だけなので、行を作った後に行う。万一失敗しても、pending の行は掃除ジョブが消す。
	req, err := s.storage.PresignPut(ctx, key, in.ContentType, *in.SizeBytes, uploadURLTTL)
	if err != nil {
		return CreatedAttachment{}, err
	}
	header := make(map[string]string, len(req.Header))
	for k := range req.Header {
		header[k] = req.Header.Get(k)
	}
	return CreatedAttachment{
		Attachment: Attachment{
			ID: id, RoomID: roomID, Status: AttachmentPending, FileName: in.FileName, ContentType: in.ContentType,
			SizeBytes: *in.SizeBytes, Width: in.Width, Height: in.Height, CreatedAt: now,
		},
		// 署名の有効期間はストレージが実時間で判定するが、クライアントへの目安は Clock から計算する（ADR 0013）。
		Upload: UploadRequest{Method: req.Method, URL: req.URL, Header: header, ExpiresAt: now.Add(uploadURLTTL)},
	}, nil
}

// CompleteAttachment は、アップロードが済んだことを HEAD で確かめて、添付をメッセージに付けられる状態（uploaded）にする。
// アップロードした本人だけができる。すでに uploaded / attached なら何もせずに現在の状態を返す（冪等）。
//
// HEAD はネットワーク呼び出しなので、トランザクションの外で行う。検証の後に「pending なら uploaded にする」1 文の UPDATE で状態を進める。
func (s *Service) CompleteAttachment(ctx context.Context, actor, attachmentID ulid.ULID) (Attachment, error) {
	q := store.New(s.db)
	row, err := q.GetAttachment(ctx, attachmentID)
	if err != nil {
		return Attachment{}, notFoundIfNoRows(err, "get attachment")
	}
	// 本人でなければ、存在も明かさない。
	if !authz.CanCompleteAttachment(row.UploaderID == actor) {
		return Attachment{}, ErrNotFound
	}
	if AttachmentStatus(row.Status) != AttachmentPending {
		if AttachmentStatus(row.Status) == AttachmentDeleted {
			return Attachment{}, ErrNotFound
		}
		return toAttachment(row), nil
	}

	info, err := s.storage.Head(ctx, row.ObjectKey)
	if errors.Is(err, storage.ErrNotFound) {
		return Attachment{}, ErrAttachmentNotUploaded
	}
	if err != nil {
		return Attachment{}, fmt.Errorf("head attachment: %w", err)
	}
	// 署名がサイズと Content-Type を縛るので通常は一致する。ストレージの実装に依存しないための最後の防御（ADR 0013）。
	if mt, _, err := mime.ParseMediaType(info.ContentType); err != nil || mt != row.MimeType || info.Size != row.SizeBytes {
		// 申告と違うオブジェクトは、誰にも配らないうちに消す。消せなくても pending の行が残るので、掃除ジョブが消す。
		if err := s.storage.Delete(ctx, row.ObjectKey); err != nil {
			s.logger.WarnContext(ctx, "delete mismatched attachment", slog.String("attachment_id", attachmentID.String()), slog.Any("error", err))
		}
		return Attachment{}, ErrAttachmentMismatch
	}

	updated, err := q.MarkAttachmentUploaded(ctx, attachmentID)
	if errors.Is(err, pgx.ErrNoRows) {
		// 並行した complete に先を越されたか、掃除ジョブに消された。読み直して、いまの状態を返す。
		row, err = q.GetAttachment(ctx, attachmentID)
		if err != nil {
			return Attachment{}, notFoundIfNoRows(err, "get attachment")
		}
		if AttachmentStatus(row.Status) == AttachmentDeleted {
			return Attachment{}, ErrNotFound
		}
		return toAttachment(row), nil
	}
	if err != nil {
		return Attachment{}, fmt.Errorf("mark attachment uploaded: %w", err)
	}
	return toAttachment(updated), nil
}

// DownloadURL は添付の署名付き GET URL。
type DownloadURL struct {
	URL       string
	ExpiresAt time.Time
}

// GetAttachmentURL は、メッセージに付いた添付の GET URL を返す。メッセージを読める人だけが取得できる。
// 読めない場合も、メッセージに付いていない（pending / uploaded / deleted）場合も、ErrNotFound を返す。
func (s *Service) GetAttachmentURL(ctx context.Context, actor, attachmentID ulid.ULID) (DownloadURL, error) {
	q := store.New(s.db)
	row, err := q.GetAttachment(ctx, attachmentID)
	if err != nil {
		return DownloadURL{}, notFoundIfNoRows(err, "get attachment")
	}
	if AttachmentStatus(row.Status) != AttachmentAttached {
		return DownloadURL{}, ErrNotFound
	}
	a, err := loadRoomAccess(ctx, q, noLock, row.RoomID, actor)
	if err != nil {
		return DownloadURL{}, err
	}
	if !authz.CanViewAttachment(a.kind(), a.actor(actor)) {
		return DownloadURL{}, ErrNotFound
	}

	// 安全な画像以外はダウンロードさせる。ファイル名は mime.FormatMediaType が RFC 2231 の形式で符号化する。
	disposition := "attachment"
	if slices.Contains(inlineTypes, row.MimeType) {
		disposition = "inline"
	}
	if v := mime.FormatMediaType(disposition, map[string]string{"filename": row.FileName}); v != "" {
		disposition = v
	}
	url, err := s.storage.PresignGet(ctx, row.ObjectKey, downloadURLTTL, storage.GetOptions{ContentType: row.MimeType, ContentDisposition: disposition})
	if err != nil {
		return DownloadURL{}, err
	}
	return DownloadURL{URL: url, ExpiresAt: s.clock.Now().Add(downloadURLTTL)}, nil
}

// validateAttachmentIDs はメッセージに付ける添付の ID を検証する。
func validateAttachmentIDs(fields *fieldErrors, ids []ulid.ULID) {
	switch {
	case len(ids) > MaxAttachmentsPerMessage:
		fields.add("attachment_ids", ReasonTooLong)
	case len(slices.Compact(slices.SortedFunc(slices.Values(ids), ulid.ULID.Compare))) != len(ids):
		fields.add("attachment_ids", ReasonInvalidValue)
	}
}

// attachToMessage は、送信のトランザクションで uploaded の添付をメッセージに付ける（ADR 0013）。
// 1 つでも付けられなければ（他人の添付、別のルームの添付、未検証、使用済み）、検証エラーを返してトランザクションごとロールバックさせる。
func attachToMessage(ctx context.Context, q *store.Queries, actor, roomID, messageID ulid.ULID, ids []ulid.ULID) error {
	if len(ids) == 0 {
		return nil
	}
	attached, err := q.AttachToMessage(ctx, store.AttachToMessageParams{MessageID: &messageID, Ids: ids, RoomID: roomID, UploaderID: actor})
	if err != nil {
		return fmt.Errorf("attach to message: %w", err)
	}
	if len(attached) != len(ids) {
		return &ValidationError{Fields: []FieldError{{Field: "attachment_ids", Reason: ReasonInvalidValue}}}
	}
	return nil
}

// loadMessageAttachments は msgs に添付を載せる。1 文でまとめて読む（N+1 にしない）。削除済みのメッセージの添付は deleted なので載らない。
func loadMessageAttachments(ctx context.Context, q *store.Queries, roomID ulid.ULID, msgs []Message) error {
	if len(msgs) == 0 {
		return nil
	}
	ids := make([]ulid.ULID, len(msgs))
	index := make(map[ulid.ULID]int, len(msgs))
	for i := range msgs {
		ids[i] = msgs[i].ID
		index[msgs[i].ID] = i
		msgs[i].Attachments = []MessageAttachment{}
	}
	rows, err := q.ListAttachmentsForMessages(ctx, store.ListAttachmentsForMessagesParams{RoomID: roomID, MessageIds: ids})
	if err != nil {
		return fmt.Errorf("list attachments: %w", err)
	}
	for _, r := range rows {
		i := index[*r.MessageID]
		msgs[i].Attachments = append(msgs[i].Attachments, MessageAttachment{
			ID: r.ID, FileName: r.FileName, ContentType: r.MimeType, SizeBytes: r.SizeBytes, Width: intPtr(r.Width), Height: intPtr(r.Height),
		})
	}
	return nil
}

// CleanupAttachments は、メッセージに付かないまま attachmentRetention を過ぎた添付と、削除されたメッセージの添付を、
// ストレージのオブジェクトと行ごと消す。消した件数を返す。
//
// 対象がなくなるまで、cleanupBatchSize 件ずつのトランザクションを繰り返す。行は FOR UPDATE SKIP LOCKED で取るので、
// 複数台で同時に実行しても同じ行を取り合わない（ロードマップ Phase 3c / Phase 5）。
func (s *Service) CleanupAttachments(ctx context.Context) (int, error) {
	total := 0
	for {
		n, err := s.cleanupAttachmentBatch(ctx)
		total += n
		if err != nil {
			return total, err
		}
		if n < cleanupBatchSize {
			return total, nil
		}
	}
}

func (s *Service) cleanupAttachmentBatch(ctx context.Context) (int, error) {
	var n int
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		rows, err := q.LockAttachmentsForCleanup(ctx, store.LockAttachmentsForCleanupParams{
			StaleBefore: s.clock.Now().Add(-attachmentRetention),
			MaxRows:     cleanupBatchSize,
		})
		if err != nil {
			return fmt.Errorf("lock attachments for cleanup: %w", err)
		}
		ids := make([]ulid.ULID, len(rows))
		for i, r := range rows {
			// オブジェクトを先に消す。消せなければロールバックして、次の実行でやり直す。
			// 消した後にコミットが失敗しても、行が残るので次の実行でもう一度消す（S3 の DELETE は冪等）。
			if err := s.storage.Delete(ctx, r.ObjectKey); err != nil {
				return fmt.Errorf("delete attachment object: %w", err)
			}
			ids[i] = r.ID
		}
		if len(ids) > 0 {
			if err := q.DeleteAttachments(ctx, ids); err != nil {
				return fmt.Errorf("delete attachments: %w", err)
			}
		}
		n = len(rows)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return n, nil
}

// RunAttachmentCleanup は、ctx がキャンセルされるまで interval ごとに CleanupAttachments を実行する。
// 失敗はログに残して次の実行を待つ（掃除が遅れてもユーザーの操作は失敗しない）。
//
// 起動直後には実行しない。開発中は air がソースの変更のたびにサーバーを再起動するので、そのたびに走らせても意味がない。
// また、サーバーを起動する統合テストが、共有のテスト用 DB にあるほかのテストの添付を消さないようにするため。
func (s *Service) RunAttachmentCleanup(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		n, err := s.CleanupAttachments(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			s.logger.ErrorContext(ctx, "attachment cleanup failed", slog.Int("deleted", n), slog.Any("error", err))
		case n > 0:
			s.logger.InfoContext(ctx, "attachment cleanup", slog.Int("deleted", n))
		}
	}
}

// DeleteMessageAttachment は、メッセージを残したまま添付ファイル 1 件だけを削除する（ADR 0045）。
// 更新後のメッセージを返す（メッセージごと消えたときは tombstone）。
//
// 消せるのはメッセージを削除できる人と同じ（送信者本人か、送信者を管理できる admin 以上。ADR 0012 / 0045 決定 5）。
// 専用の判定は足さない。規則を 2 つに分けても admin はメッセージごと消せるので、「消せない」ことの保証にならない。
//
// 実体は消さない。status を deleted にするだけで、ストレージのオブジェクトは既存の掃除ジョブが消す（ADR 0013）。
// 同期は change_seq を 1 つ進めて message.updated に乗せる（ADR 0044 と同じ。seq / user_seq は進めない）。
// これが最後の添付で本文も空なら、同じトランザクションでメッセージごと論理削除して message.deleted を配る（決定 8）。
func (s *Service) DeleteMessageAttachment(ctx context.Context, actor, roomID, messageID, attachmentID ulid.ULID) (Message, error) {
	var (
		msg Message
		// 何も変わらなかった（冪等な DELETE）ときは空のまま。配信もしない。
		event EventType
		// 返信を消したときの、返信数が減った親（ADR 0036）。
		root *Message
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		// 判定に送信者のロールが要るので、先に送信者を読む（DeleteMessage と同じ流れ）。
		senderID, err := q.GetMessageSenderID(ctx, store.GetMessageSenderIDParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "get message sender")
		}
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor, senderID)
		if err != nil {
			return err
		}
		// ロックの順序は メッセージ → 添付 → rooms（ADR 0014）。メッセージの行を先に押さえるので、
		// 同じメッセージの添付を 2 つ同時に消しても、残りの数を数え違えない。
		m, err := q.GetMessageForUpdate(ctx, store.GetMessageForUpdateParams{RoomID: roomID, ID: messageID})
		if err != nil {
			return notFoundIfNoRows(err, "lock message")
		}
		// システムメッセージには添付が付かない（ADR 0033）。削除済みのメッセージの添付は跡を残さない（ADR 0038 / 0045 決定 5）。
		// どちらも「そのメッセージの添付ではない」ので 404 にそろえる。
		if MessageKind(m.Kind) == MessageKindSystem || m.DeletedAt != nil {
			return ErrNotFound
		}
		if !authz.CanDeleteMessage(a.kind(), a.actor(actor), m.SenderID == actor, a.roles[m.SenderID]) {
			return ErrForbidden
		}

		n, err := q.DeleteMessageAttachment(ctx, store.DeleteMessageAttachmentParams{ID: attachmentID, RoomID: roomID, MessageID: &messageID})
		if err != nil {
			return fmt.Errorf("delete message attachment: %w", err)
		}
		if n == 0 {
			// 行が変わらなかった。すでに消えているなら冪等な成功、そうでなければ 404（ADR 0045 決定 7）。
			if err := checkAlreadyDeleted(ctx, q, roomID, messageID, attachmentID); err != nil {
				return err
			}
			msg, err = getMessage(ctx, q, roomID, actor, messageID)
			return err
		}

		left, err := q.CountMessageAttachments(ctx, store.CountMessageAttachmentsParams{RoomID: roomID, MessageID: &messageID})
		if err != nil {
			return fmt.Errorf("count message attachments: %w", err)
		}
		// 本文は空白だけでも「空」とみなす。添付があるメッセージは本文の検証が緩いので（validateBody）、
		// 空白だけの本文が残ることがあり、それを残すと中身のない行がタイムラインに残る。
		if left == 0 && strings.TrimSpace(m.Body) == "" {
			// 中身のないメッセージは残さない（ADR 0045 決定 8）。DeleteMessage と同じ論理削除を行う。
			// 残っている添付はないので、MarkMessageAttachmentsDeleted は要らない。
			if root, err = s.softDeleteMessage(ctx, q, roomID, actor, m); err != nil {
				return err
			}
			event = EventMessageDeleted
		} else {
			changeSeq, err := q.AllocateChangeSeq(ctx, store.AllocateChangeSeqParams{RoomID: roomID, N: 1})
			if err != nil {
				return fmt.Errorf("allocate change_seq: %w", err)
			}
			// 添付が 1 件減るのは「このメッセージの見え方が変わった」こと。編集ではないので edited_at は触らない。
			if err := q.UpdateMessageChangeSeq(ctx, store.UpdateMessageChangeSeqParams{ID: messageID, ChangeSeq: changeSeq}); err != nil {
				return fmt.Errorf("update change_seq: %w", err)
			}
			event = EventMessageUpdated
		}
		msg, err = getMessage(ctx, q, roomID, actor, messageID)
		return err
	})
	if err != nil {
		return Message{}, err
	}
	if event != "" {
		s.deliver(ctx, messageEvent(event, msg))
	}
	// 返信がメッセージごと消えたときは、親の返信数の変化も届ける（ADR 0036）。
	if root != nil {
		s.deliver(ctx, messageEvent(EventMessageUpdated, *root))
	}
	return msg, nil
}

// checkAlreadyDeleted は、行を変えられなかった DELETE が冪等な成功か 404 かを見分ける（ADR 0045 決定 7）。
//
// そのメッセージの添付で、すでに deleted になっているときだけ冪等な成功にする。
// 掃除ジョブが行を消した後（24 時間後）の再送は、行がないので 404 になる。
func checkAlreadyDeleted(ctx context.Context, q *store.Queries, roomID, messageID, attachmentID ulid.ULID) error {
	row, err := q.GetAttachment(ctx, attachmentID)
	if err != nil {
		return notFoundIfNoRows(err, "get attachment")
	}
	if row.RoomID != roomID || row.MessageID == nil || *row.MessageID != messageID || AttachmentStatus(row.Status) != AttachmentDeleted {
		return ErrNotFound
	}
	return nil
}
