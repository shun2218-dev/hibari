package httpx

import (
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// どの画面にも出るユーザーの表示（名前・ハンドル・アバターの有無）と、カスタムステータス（ADR 0049）。

type userProfileResponse struct {
	ID          string `json:"id"`
	Handle      string `json:"handle"`
	DisplayName string `json:"display_name"`
}

func newUserProfileResponse(u chat.UserProfile) userProfileResponse {
	return userProfileResponse{ID: u.ID.String(), Handle: u.Handle, DisplayName: u.DisplayName}
}

// userStatusResponse はカスタムステータス（ADR 0049）。expires_at が null なら消えない。
type userStatusResponse struct {
	Emoji     string     `json:"emoji"`
	Text      string     `json:"text"`
	ExpiresAt *time.Time `json:"expires_at"`
}

func newUserStatusResponse(s *chat.UserStatus) *userStatusResponse {
	if s == nil {
		return nil
	}
	return &userStatusResponse{Emoji: s.Emoji, Text: s.Text, ExpiresAt: s.ExpiresAt}
}
