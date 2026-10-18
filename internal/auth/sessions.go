package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/auth/store"
)

// ErrSessionNotFound は、そのセッションが自分のものとして見つからない（他人のもの、すでに失効済み、存在しない）ことを表す。
// どれであるかは区別しない（他人のセッションの存在を明かさない。ADR 0019）。
var ErrSessionNotFound = errors.New("auth: session not found")

// Session の一覧の 1 件（設定画面の「ログイン中のデバイス」。ADR 0019）。
type SessionInfo struct {
	// ID はセッション ID（refresh_tokens.family_id = Access Token の sid）。
	ID ulid.ULID
	// UserAgent は最後に使われたときのもの。表示用のラベルはクライアントが作る。
	UserAgent string
	// StartedAt はこのセッションでログインした時刻、LastUsedAt は最後に refresh した時刻。
	StartedAt  time.Time
	LastUsedAt time.Time
	// Current はいまのリクエストのセッションか。
	Current bool
}

// Sessions は userID の有効なセッションを、最後に使った順に返す。currentSessionID のものに Current を立てる。
func (s *Service) Sessions(ctx context.Context, userID, currentSessionID ulid.ULID) ([]SessionInfo, error) {
	rows, err := store.New(s.db).ListActiveSessions(ctx, store.ListActiveSessionsParams{UserID: userID, Now: s.clock.Now()})
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	sessions := make([]SessionInfo, 0, len(rows))
	for _, r := range rows {
		ua := ""
		if r.UserAgent != nil {
			ua = *r.UserAgent
		}
		sessions = append(sessions, SessionInfo{
			ID:         r.FamilyID,
			UserAgent:  ua,
			StartedAt:  r.StartedAt,
			LastUsedAt: r.LastUsedAt,
			Current:    r.FamilyID == currentSessionID,
		})
	}
	return sessions, nil
}

// RevokeSession は userID の sessionID を失効させる。他人のセッションや、すでに失効したものは ErrSessionNotFound。
//
// 失効した瞬間に切れるのは WebSocket だけで、相手の Access Token は最長で TTL のあいだ使える（ADR 0007 / 0019）。
func (s *Service) RevokeSession(ctx context.Context, userID, sessionID ulid.ULID) error {
	n, err := store.New(s.db).RevokeSessionForUser(ctx, store.RevokeSessionForUserParams{
		UserID:   userID,
		FamilyID: sessionID,
		Reason:   revokedLogout,
		Now:      s.clock.Now(),
	})
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if n == 0 {
		return ErrSessionNotFound
	}
	s.notifySessionRevoked(ctx, sessionID)
	return nil
}

// RevokeOtherSessions は keepSessionID 以外のセッションをすべて失効させ、失効した数を返す。
//
// ユーザー単位の失効イベントは使わない。それを受け取った側は、いま操作している本人の接続まで切ってしまうため（ADR 0019）。
func (s *Service) RevokeOtherSessions(ctx context.Context, userID, keepSessionID ulid.ULID) (int, error) {
	revoked, err := store.New(s.db).RevokeOtherSessions(ctx, store.RevokeOtherSessionsParams{
		UserID:       userID,
		KeepFamilyID: keepSessionID,
		Reason:       revokedLogout,
		Now:          s.clock.Now(),
	})
	if err != nil {
		return 0, fmt.Errorf("revoke other sessions: %w", err)
	}
	// 1 つの family に複数の行があるので、family 単位に畳んでから 1 回ずつ知らせる。
	seen := make(map[ulid.ULID]struct{}, len(revoked))
	for _, familyID := range revoked {
		if _, ok := seen[familyID]; ok {
			continue
		}
		seen[familyID] = struct{}{}
		s.notifySessionRevoked(ctx, familyID)
	}
	return len(seen), nil
}

// ProfileInput はプロフィールの更新の入力。nil の項目は変えない（部分更新）。
type ProfileInput struct {
	DisplayName *string
	Handle      *string
}

// UpdateProfile は表示名とハンドルを変える。両方 nil なら何も変えずに現在の値を返す。
func (s *Service) UpdateProfile(ctx context.Context, userID ulid.ULID, in ProfileInput) (User, error) {
	in, err := in.normalize()
	if err != nil {
		return User{}, err
	}
	u, err := store.New(s.db).UpdateUserProfile(ctx, store.UpdateUserProfileParams{
		ID:          userID,
		DisplayName: in.DisplayName,
		Handle:      in.Handle,
		Now:         s.clock.Now(),
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return User{}, ErrUserNotFound
	case isUniqueViolation(err, "users_handle_key"):
		return User{}, ErrHandleTaken
	case err != nil:
		return User{}, fmt.Errorf("update profile: %w", err)
	}
	return s.userWithAvatarURL(ctx, u), nil
}
