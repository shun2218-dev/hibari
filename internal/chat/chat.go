// Package chat はチャットドメイン（ワークスペース・ロール・招待・ルーム・メッセージ）。
//
// HTTP の知識は持たない。エラーは sentinel error / 型付きエラーで返し、
// HTTP ステータスへの変換は internal/httpx が行う（CLAUDE.md「エラーハンドリング」）。
//
// 誰が何をできるかの判定は internal/chat/authz だけが行う。このパッケージは判定に必要な事実を DB から読み、
// authz の関数に渡して、結果をエラーに変換する（CLAUDE.md ルール 9）。
//
// internal/auth は import しない（ADR 0001）。操作の主体は internal/platform/authn が検証した userID として受け取り、
// ユーザーの表示名などは users の公開プロフィールの列だけを SQL で読む（ADR 0011）。
package chat

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
)

var (
	// ErrNotFound は対象が存在しない、または actor から見えないことを表す。
	// ワークスペースのメンバーでない人や、private ルームを読めない人には、存在するかどうかも明かさない（ADR 0011）。
	ErrNotFound = errors.New("chat: not found")
	// ErrForbidden は対象は見えるが、その操作が許されていないことを表す。
	ErrForbidden = errors.New("chat: forbidden")
	// ErrOwnerMustTransfer は owner が譲渡せずに退出しようとしたことを表す。
	ErrOwnerMustTransfer = errors.New("chat: owner must transfer ownership before leaving")
)

// ValidationError は入力値の検証エラー。どの項目がなぜ不正かをまとめて返す。
type ValidationError struct {
	Fields []FieldError
}

// FieldError は 1 項目の検証エラー。Reason はクライアントが文言を選ぶための機械可読な値。
type FieldError struct {
	Field  string
	Reason string
}

// FieldError.Reason の値。auth と同じ値は同じ意味で使う（ADR 0010）。
const (
	ReasonRequired      = "required"
	ReasonTooLong       = "too_long"
	ReasonInvalidFormat = "invalid_format"
	// ReasonInvalidValue は列挙値にない値など、形式は正しいが受け付けられない値。
	ReasonInvalidValue = "invalid_value"
	// ReasonOutOfRange は数値が許される範囲の外にあることを表す。
	ReasonOutOfRange = "out_of_range"
	// ReasonTooMany は、1 つ 1 つは正しいが数が多すぎることを表す（リアクションの種類の上限。ADR 0044）。
	ReasonTooMany = "too_many"
)

func (e *ValidationError) Error() string {
	parts := make([]string, len(e.Fields))
	for i, f := range e.Fields {
		parts[i] = f.Field + ": " + f.Reason
	}
	return fmt.Sprintf("chat: invalid input (%s)", strings.Join(parts, ", "))
}

// fieldErrors は検証エラーを集める。1 つ目で止めず、すべての項目をまとめて返す（フォームで一度に表示できるように）。
type fieldErrors []FieldError

func (f *fieldErrors) add(field, reason string) {
	*f = append(*f, FieldError{Field: field, Reason: reason})
}

func (f fieldErrors) err() error {
	if len(f) == 0 {
		return nil
	}
	return &ValidationError{Fields: f}
}

// Role はワークスペース単位のロール。
type Role = authz.Role

// InvitePolicy は招待リンクを作成できる人の設定。
type InvitePolicy = authz.InvitePolicy

// UserProfile はほかのユーザーに見せてよいユーザーの情報。
type UserProfile struct {
	ID          ulid.ULID
	Handle      string
	DisplayName string
}

// Workspace は actor から見たワークスペース。
type Workspace struct {
	ID           ulid.ULID
	Slug         string
	Name         string
	InvitePolicy InvitePolicy
	// MyRole は actor のロール。クライアントが操作の可否を表示するために返す（最終的な判定は常にサーバー）。
	MyRole Role
	// MemberCount は 1 件を取得したときだけ入る。一覧では 0。
	MemberCount int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Member はワークスペースのメンバー。
type Member struct {
	User     UserProfile
	Role     Role
	JoinedAt time.Time
	// Presence は自動で決まる状態の初期値（ADR 0015 / 0049）。変化は WebSocket の presence.changed で届く。
	Presence Presence
	// Away は本人が手動で離席にしているか（ADR 0049）。変化は member.status_changed で届く。
	Away bool
	// Status はカスタムステータス。設定していなければ nil（期限切れも nil）。
	Status *UserStatus
}

// MemberProfile はプロフィールのパネルの 1 人分（ADR 0050 決定 1）。
// email を持つ型はこれだけにする（Member・UserProfile に足すと、一覧やイベントに乗って広く流れる）。
type MemberProfile struct {
	Member
	// Email は検証済みのときだけ入る（決定 2）。未検証なら nil。
	Email *string
}

// 一覧のページングの既定値と上限（ADR 0011）。
const (
	DefaultPageLimit = 100
	MaxPageLimit     = 200
)

// PageRequest はカーソル方式のページングの指定。OFFSET は使わない（CLAUDE.md「DB / SQL」）。
type PageRequest struct {
	// After はこの ID より後ろから返す。ゼロ値なら先頭から。
	After ulid.ULID
	// Limit が 0 以下なら DefaultPageLimit、MaxPageLimit を超えたら MaxPageLimit にする。
	Limit int
}

func (p PageRequest) limit() int {
	switch {
	case p.Limit <= 0:
		return DefaultPageLimit
	case p.Limit > MaxPageLimit:
		return MaxPageLimit
	default:
		return p.Limit
	}
}

// Page は一覧の 1 ページ。
type Page[T any] struct {
	Items []T
	// NextCursor は次のページの PageRequest.After に渡す値。最後のページなら nil。
	NextCursor *ulid.ULID
}

// newPage は limit+1 件まで読んだ結果から 1 ページを作る。
// 1 件多く読むことで、「ちょうど limit 件で終わり」のときに空の次ページを返さずに済む。
func newPage[T any](rows []T, limit int, cursor func(T) ulid.ULID) Page[T] {
	if len(rows) <= limit {
		return Page[T]{Items: rows}
	}
	rows = rows[:limit]
	next := cursor(rows[len(rows)-1])
	return Page[T]{Items: rows, NextCursor: &next}
}
