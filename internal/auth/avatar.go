package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth/store"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
)

// Storage はアバター画像を置くオブジェクトストレージ（platform/storage の *S3 が実装する）。
// ファイルの中身はサーバーを経由しない（CLAUDE.md ルール 10）ので、署名・HEAD・削除だけを使う。
type Storage interface {
	PresignPut(ctx context.Context, key, contentType string, size int64, ttl time.Duration) (storage.PresignedRequest, error)
	PresignGet(ctx context.Context, key string, ttl time.Duration, opts storage.GetOptions) (string, error)
	Head(ctx context.Context, key string) (storage.ObjectInfo, error)
	Delete(ctx context.Context, key string) error
}

// AvatarLimits はアバター画像の設定値。
type AvatarLimits struct {
	// MaxBytes は 1 枚のサイズの上限。
	MaxBytes int64
	// AllowedTypes は受け付ける Content-Type。パラメータのない小文字の type/subtype。
	AllowedTypes []string
}

const (
	// avatarUploadURLTTL は PUT URL の有効期間。Content-Length を署名に含めるので、長めでも申告と違う画像は置けない。
	avatarUploadURLTTL = 15 * time.Minute
	// avatarURLTTL は GET URL の有効期間。アバターは秘密ではないので、添付（5 分）より長くして取り直しを減らす（ADR 0020）。
	avatarURLTTL = time.Hour
	// maxAvatarURLRequest は 1 回にまとめて署名できるユーザーの数。
	maxAvatarURLRequest = 200
)

var (
	// ErrAvatarNotUploaded は、complete の時点でオブジェクトが置かれていないことを表す。
	ErrAvatarNotUploaded = errors.New("auth: avatar is not uploaded")
	// ErrAvatarMismatch は、置かれたオブジェクトが申告した種類・サイズと違うことを表す。
	ErrAvatarMismatch = errors.New("auth: uploaded avatar does not match the request")
)

// AvatarUploadInput はアップロードの申告。
type AvatarUploadInput struct {
	ContentType string
	SizeBytes   *int64
}

func (l AvatarLimits) validate(in AvatarUploadInput) error {
	var fields []FieldError
	add := func(field, reason string) { fields = append(fields, FieldError{Field: field, Reason: reason}) }

	switch ct := in.ContentType; {
	case ct == "":
		add("content_type", ReasonRequired)
	case !isPlainMediaType(ct):
		add("content_type", ReasonInvalidFormat)
	case !slices.Contains(l.AllowedTypes, ct):
		add("content_type", ReasonInvalidValue)
	}
	switch {
	case in.SizeBytes == nil:
		add("size_bytes", ReasonRequired)
	case *in.SizeBytes < 1 || *in.SizeBytes > l.MaxBytes:
		add("size_bytes", ReasonOutOfRange)
	}

	if len(fields) > 0 {
		return &ValidationError{Fields: fields}
	}
	return nil
}

// isPlainMediaType は、パラメータのない小文字の type/subtype かを返す（クライアントの申告と完全一致で比べるため）。
func isPlainMediaType(s string) bool {
	mt, params, err := mime.ParseMediaType(s)
	return err == nil && len(params) == 0 && mt == s
}

// AvatarUpload はクライアントがストレージに直接 PUT するための指示。
type AvatarUpload struct {
	// UploadID は complete で渡す ID。サーバーはこれと認証したユーザーの ID からオブジェクトキーを組み立てる。
	UploadID  ulid.ULID
	Method    string
	URL       string
	Header    map[string]string
	ExpiresAt time.Time
}

// avatarObjectKey は userID のアバターのキー。userID を含めるので、他人の領域には書き込めない（ADR 0020）。
func avatarObjectKey(userID, uploadID ulid.ULID) string {
	return fmt.Sprintf("avatars/%s/%s", userID, uploadID)
}

// CreateAvatarUpload は、申告した種類とサイズだけを受け付ける PUT URL を返す。
func (s *Service) CreateAvatarUpload(ctx context.Context, userID ulid.ULID, in AvatarUploadInput) (AvatarUpload, error) {
	if err := s.avatarLimits.validate(in); err != nil {
		return AvatarUpload{}, err
	}
	uploadID := s.ids.New()
	req, err := s.storage.PresignPut(ctx, avatarObjectKey(userID, uploadID), in.ContentType, *in.SizeBytes, avatarUploadURLTTL)
	if err != nil {
		return AvatarUpload{}, err
	}
	header := make(map[string]string, len(req.Header))
	for k := range req.Header {
		header[k] = req.Header.Get(k)
	}
	// 署名の期限はストレージが実時間で見るが、クライアントへの目安は Clock から出す（ADR 0013 と同じ）。
	return AvatarUpload{
		UploadID:  uploadID,
		Method:    req.Method,
		URL:       req.URL,
		Header:    header,
		ExpiresAt: s.clock.Now().Add(avatarUploadURLTTL),
	}, nil
}

// CompleteAvatarUpload は、アップロードが済んだことを HEAD で確かめてからプロフィールに反映する。
// 置き換える前の画像は消す（消せなくても成功にする。ログには残す）。
func (s *Service) CompleteAvatarUpload(ctx context.Context, userID, uploadID ulid.ULID, in AvatarUploadInput) (User, error) {
	if err := s.avatarLimits.validate(in); err != nil {
		return User{}, err
	}
	key := avatarObjectKey(userID, uploadID)
	info, err := s.storage.Head(ctx, key)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return User{}, ErrAvatarNotUploaded
	case err != nil:
		return User{}, fmt.Errorf("head avatar: %w", err)
	}
	// 署名が種類とサイズを縛るので通常は一致する。ストレージの実装に依存しないための最後の防御（ADR 0013 / 0020）。
	if mt, _, err := mime.ParseMediaType(info.ContentType); err != nil || mt != in.ContentType || info.Size != *in.SizeBytes {
		s.deleteAvatarObject(ctx, key)
		return User{}, ErrAvatarMismatch
	}

	u, err := store.New(s.db).SetUserAvatar(ctx, store.SetUserAvatarParams{ID: userID, AvatarObjectKey: &key, Now: s.clock.Now()})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// 反映できないなら、置かれたままにしない。
		s.deleteAvatarObject(ctx, key)
		return User{}, ErrUserNotFound
	case err != nil:
		return User{}, fmt.Errorf("set avatar: %w", err)
	}
	if u.PreviousAvatarObjectKey != nil && *u.PreviousAvatarObjectKey != key {
		s.deleteAvatarObject(ctx, *u.PreviousAvatarObjectKey)
	}
	return s.userWithAvatarURL(ctx, u.User), nil
}

// DeleteAvatar は画像を外す（頭文字のアバターに戻る）。画像がなければ何もしない。
func (s *Service) DeleteAvatar(ctx context.Context, userID ulid.ULID) (User, error) {
	u, err := store.New(s.db).SetUserAvatar(ctx, store.SetUserAvatarParams{ID: userID, AvatarObjectKey: nil, Now: s.clock.Now()})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return User{}, ErrUserNotFound
	case err != nil:
		return User{}, fmt.Errorf("clear avatar: %w", err)
	}
	if u.PreviousAvatarObjectKey != nil {
		s.deleteAvatarObject(ctx, *u.PreviousAvatarObjectKey)
	}
	return toUser(u.User), nil
}

// AvatarURLs は userIDs のうち、画像を持つユーザーの署名付き GET URL を返す（画像がない人は入らない）。
// 画面に出すユーザーをまとめて渡す前提（ADR 0020）。
func (s *Service) AvatarURLs(ctx context.Context, userIDs []ulid.ULID) (map[ulid.ULID]AvatarURL, error) {
	if len(userIDs) == 0 {
		return map[ulid.ULID]AvatarURL{}, nil
	}
	if len(userIDs) > maxAvatarURLRequest {
		return nil, &ValidationError{Fields: []FieldError{{Field: "user_ids", Reason: ReasonOutOfRange}}}
	}
	ids := slices.Clone(userIDs)
	slices.SortFunc(ids, func(a, b ulid.ULID) int { return a.Compare(b) })
	rows, err := store.New(s.db).ListUserAvatars(ctx, slices.Compact(ids))
	if err != nil {
		return nil, fmt.Errorf("list avatars: %w", err)
	}
	expiresAt := s.clock.Now().Add(avatarURLTTL)
	out := make(map[ulid.ULID]AvatarURL, len(rows))
	for _, row := range rows {
		if row.AvatarObjectKey == nil {
			continue
		}
		url, err := s.signAvatarURL(ctx, *row.AvatarObjectKey)
		if err != nil {
			return nil, err
		}
		out[row.ID] = AvatarURL{URL: url, ExpiresAt: expiresAt}
	}
	return out, nil
}

// AvatarURL は署名付きの GET URL と、その目安の期限。
type AvatarURL struct {
	URL       string
	ExpiresAt time.Time
}

// signAvatarURL は key の GET URL を作る。画像はブラウザにそのまま表示させる。
func (s *Service) signAvatarURL(ctx context.Context, key string) (string, error) {
	url, err := s.storage.PresignGet(ctx, key, avatarURLTTL, storage.GetOptions{ContentDisposition: "inline"})
	if err != nil {
		return "", fmt.Errorf("sign avatar url: %w", err)
	}
	return url, nil
}

// userWithAvatarURL は、画像があれば署名付き URL を入れた User を返す。
// 署名に失敗しても、プロフィールそのものは返す（アバターは頭文字になるだけ）。
func (s *Service) userWithAvatarURL(ctx context.Context, u store.User) User {
	user := toUser(u)
	if u.AvatarObjectKey == nil {
		return user
	}
	url, err := s.signAvatarURL(ctx, *u.AvatarObjectKey)
	if err != nil {
		s.logger.ErrorContext(ctx, "sign avatar url failed", slog.String("user_id", u.ID.String()), slog.Any("error", err))
		return user
	}
	user.AvatarURL = url
	return user
}

// deleteAvatarObject はオブジェクトを消す。消せなくてもリクエストは失敗させない（残るのは参照されないオブジェクトだけ）。
func (s *Service) deleteAvatarObject(ctx context.Context, key string) {
	if err := s.storage.Delete(ctx, key); err != nil {
		s.logger.WarnContext(ctx, "delete avatar object failed", slog.String("object_key", key), slog.Any("error", err))
	}
}
