package chat

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

var (
	// ErrInviteInvalid は招待が見つからない、または取り消し済みであることを表す。
	// どちらなのかは区別しない（取り消されたリンクと打ち間違えたリンクで、見せる情報を変える必要がない）。
	ErrInviteInvalid = errors.New("chat: invite is invalid")
	// ErrInviteExpired は招待の期限が切れていることを表す。
	ErrInviteExpired = errors.New("chat: invite has expired")
	// ErrInviteExhausted は招待の使用回数が上限に達していることを表す。
	ErrInviteExhausted = errors.New("chat: invite has reached its usage limit")
)

// 招待の入力の制約（ADR 0011）。作成ダイアログの選択肢（最大 100 回、最長 7 日）より広くしておく。
const (
	inviteMaxUsesLimit = 1000
	inviteMinTTL       = time.Minute
	inviteMaxTTL       = 30 * 24 * time.Hour
)

// inviteCodeBytes は招待コードの乱数のバイト数（128 ビット）。
// 総当たりが現実的でない長さにして、プレビューと受け入れに回数制限を付けずに済ませる（ADR 0011）。
const inviteCodeBytes = 16

// InviteStatus は招待の状態。DB には持たず、取得した時点の時刻から計算する。
type InviteStatus string

const (
	InviteActive    InviteStatus = "active"
	InviteExhausted InviteStatus = "exhausted"
	InviteExpired   InviteStatus = "expired"
	InviteRevoked   InviteStatus = "revoked"
)

// inviteStatus は招待の状態を返す。複数に当てはまるときは、取り消し > 期限切れ > 上限の順に優先する。
// 取り消しは人の判断なので最も強く、期限切れは待っても戻らないので、上限より先に伝える。
func inviteStatus(inv store.WorkspaceInvite, now time.Time) InviteStatus {
	switch {
	case inv.RevokedAt != nil:
		return InviteRevoked
	case !now.Before(inv.ExpiresAt):
		return InviteExpired
	case inv.MaxUses != nil && inv.UseCount >= *inv.MaxUses:
		return InviteExhausted
	default:
		return InviteActive
	}
}

// Invite はワークスペースの招待リンク。コードは含まない（作成時に 1 度だけ返す）。
type Invite struct {
	ID          ulid.ULID
	WorkspaceID ulid.ULID
	CreatedBy   UserProfile
	// MaxUses が nil なら無制限。
	MaxUses   *int
	UseCount  int
	ExpiresAt time.Time
	RevokedAt *time.Time
	CreatedAt time.Time
	Status    InviteStatus
}

func toInvite(inv store.WorkspaceInvite, creatorHandle, creatorDisplayName string, now time.Time) Invite {
	var maxUses *int
	if inv.MaxUses != nil {
		n := int(*inv.MaxUses)
		maxUses = &n
	}
	return Invite{
		ID:          inv.ID,
		WorkspaceID: inv.WorkspaceID,
		CreatedBy:   UserProfile{ID: inv.CreatedBy, Handle: creatorHandle, DisplayName: creatorDisplayName},
		MaxUses:     maxUses,
		UseCount:    int(inv.UseCount),
		ExpiresAt:   inv.ExpiresAt,
		RevokedAt:   inv.RevokedAt,
		CreatedAt:   inv.CreatedAt,
		Status:      inviteStatus(inv, now),
	}
}

// CreatedInvite は作成した招待と、1 度だけ返す生のコード。
type CreatedInvite struct {
	Invite
	Code string
}

// InviteInput は招待の作成の入力。
type InviteInput struct {
	// MaxUses が nil なら無制限。
	MaxUses *int
	// ExpiresIn は作成時点からの有効期間。期限はサーバーの Clock から計算する（クライアントの時計を信じない）。
	ExpiresIn *time.Duration
}

func (in InviteInput) validate() error {
	var fields fieldErrors
	if in.MaxUses != nil && (*in.MaxUses < 1 || *in.MaxUses > inviteMaxUsesLimit) {
		fields.add("max_uses", ReasonOutOfRange)
	}
	switch {
	case in.ExpiresIn == nil:
		fields.add("expires_in_seconds", ReasonRequired)
	case *in.ExpiresIn < inviteMinTTL || *in.ExpiresIn > inviteMaxTTL:
		fields.add("expires_in_seconds", ReasonOutOfRange)
	}
	return fields.err()
}

// newInviteCode は生のコードと、DB に保存する SHA-256 ハッシュを返す。
// 乱数なので、パスワードのような遅いハッシュは要らない（辞書攻撃が成り立たない）。
func newInviteCode(random io.Reader) (code string, hash []byte, err error) {
	b := make([]byte, inviteCodeBytes)
	if _, err := io.ReadFull(random, b); err != nil {
		return "", nil, fmt.Errorf("read random: %w", err)
	}
	// URL のパスに置いてもエスケープが要らない base64url にする。
	code = base64.RawURLEncoding.EncodeToString(b)
	return code, hashInviteCode(code), nil
}

func hashInviteCode(code string) []byte {
	h := sha256.Sum256([]byte(code))
	return h[:]
}

// CreateInvite は招待リンクを作る。作成できるのは admin 以上か、invite_policy = all_members のときの member。
func (s *Service) CreateInvite(ctx context.Context, actor, workspaceID ulid.ULID, in InviteInput) (CreatedInvite, error) {
	if err := in.validate(); err != nil {
		return CreatedInvite{}, err
	}
	code, hash, err := newInviteCode(s.random)
	if err != nil {
		return CreatedInvite{}, err
	}

	var created CreatedInvite
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		me, err := q.GetWorkspaceRoleForShare(ctx, store.GetWorkspaceRoleForShareParams{WorkspaceID: workspaceID, UserID: actor})
		if err != nil {
			return notFoundIfNoRows(err, "get role")
		}
		if !authz.CanCreateInvite(Role(me.Role), InvitePolicy(me.InvitePolicy)) {
			return ErrForbidden
		}
		var maxUses *int32
		if in.MaxUses != nil {
			n := int32(*in.MaxUses) // validate で inviteMaxUsesLimit 以下を確かめている。
			maxUses = &n
		}
		now := s.clock.Now()
		inv, err := q.CreateInvite(ctx, store.CreateInviteParams{
			ID:          s.ids.New(),
			WorkspaceID: workspaceID,
			CodeHash:    hash,
			CreatedBy:   actor,
			MaxUses:     maxUses,
			ExpiresAt:   now.Add(*in.ExpiresIn),
			Now:         now,
		})
		if err != nil {
			return fmt.Errorf("create invite: %w", err)
		}
		creator, err := q.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{WorkspaceID: workspaceID, UserID: actor})
		if err != nil {
			return fmt.Errorf("get creator: %w", err)
		}
		created = CreatedInvite{Invite: toInvite(inv, creator.Handle, creator.DisplayName, now), Code: code}
		return nil
	})
	return created, err
}

// ListInvites はワークスペースの招待リンクを新しい順に返す。取り消し済み・期限切れも含む。メンバーなら誰でも見られる。
func (s *Service) ListInvites(ctx context.Context, actor, workspaceID ulid.ULID, page PageRequest) (Page[Invite], error) {
	q := store.New(s.db)
	role, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return Page[Invite]{}, notFoundIfNoRows(err, "get role")
	}
	if !authz.CanListInvites(Role(role)) {
		return Page[Invite]{}, ErrForbidden
	}
	var before *ulid.ULID
	if page.After != (ulid.ULID{}) {
		before = &page.After
	}
	limit := page.limit()
	rows, err := q.ListInvites(ctx, store.ListInvitesParams{
		WorkspaceID: workspaceID,
		Before:      before,
		MaxRows:     int32(limit + 1),
	})
	if err != nil {
		return Page[Invite]{}, fmt.Errorf("list invites: %w", err)
	}
	now := s.clock.Now()
	invites := make([]Invite, len(rows))
	for i, r := range rows {
		invites[i] = toInvite(r.WorkspaceInvite, r.CreatorHandle, r.CreatorDisplayName, now)
	}
	return newPage(invites, limit, func(inv Invite) ulid.ULID { return inv.ID }), nil
}

// RevokeInvite は招待リンクを取り消す。取り消し済みでも成功を返す（冪等）。
func (s *Service) RevokeInvite(ctx context.Context, actor, workspaceID, inviteID ulid.ULID) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		me, err := q.GetWorkspaceRoleForShare(ctx, store.GetWorkspaceRoleForShareParams{WorkspaceID: workspaceID, UserID: actor})
		if err != nil {
			return notFoundIfNoRows(err, "get role")
		}
		inv, err := q.GetInviteWithCreator(ctx, store.GetInviteWithCreatorParams{ID: inviteID, WorkspaceID: workspaceID})
		if err != nil {
			return notFoundIfNoRows(err, "get invite")
		}
		if !authz.CanRevokeInvite(Role(me.Role), InvitePolicy(me.InvitePolicy), inv.WorkspaceInvite.CreatedBy == actor) {
			return ErrForbidden
		}
		if err := q.RevokeInvite(ctx, store.RevokeInviteParams{ID: inviteID, WorkspaceID: workspaceID, Now: s.clock.Now()}); err != nil {
			return fmt.Errorf("revoke invite: %w", err)
		}
		return nil
	})
}

// InvitePreview は招待を受け入れる前に見せる情報（ADR 0011）。
type InvitePreview struct {
	WorkspaceID     ulid.ULID
	WorkspaceName   string
	MemberCount     int64
	PublicRoomCount int64
	Inviter         UserProfile
	AlreadyMember   bool
	ExpiresAt       time.Time
}

// PreviewInvite は招待の中身を返す。
// 使えない招待（無効・期限切れ・上限）ではワークスペースの情報を返さず、理由のエラーだけを返す。
// ただし、すでにメンバーなら期限切れや上限でも AlreadyMember として返す（取り消し済みは除く）。
func (s *Service) PreviewInvite(ctx context.Context, actor ulid.ULID, code string) (InvitePreview, error) {
	if code == "" {
		return InvitePreview{}, ErrInviteInvalid
	}
	r, err := store.New(s.db).GetInvitePreview(ctx, store.GetInvitePreviewParams{UserID: actor, CodeHash: hashInviteCode(code)})
	if errors.Is(err, pgx.ErrNoRows) {
		return InvitePreview{}, ErrInviteInvalid
	}
	if err != nil {
		return InvitePreview{}, fmt.Errorf("get invite preview: %w", err)
	}
	inv := r.WorkspaceInvite
	status := inviteStatus(inv, s.clock.Now())
	if status == InviteRevoked {
		return InvitePreview{}, ErrInviteInvalid
	}
	if !r.AlreadyMember {
		if err := statusError(status); err != nil {
			return InvitePreview{}, err
		}
	}
	return InvitePreview{
		WorkspaceID:     inv.WorkspaceID,
		WorkspaceName:   r.WorkspaceName,
		MemberCount:     r.MemberCount,
		PublicRoomCount: r.PublicRoomCount,
		Inviter:         UserProfile{ID: inv.CreatedBy, Handle: r.CreatorHandle, DisplayName: r.CreatorDisplayName},
		AlreadyMember:   r.AlreadyMember,
		ExpiresAt:       inv.ExpiresAt,
	}, nil
}

// statusError は使えない招待の状態をエラーにする。使えるなら nil。
func statusError(status InviteStatus) error {
	switch status {
	case InviteRevoked:
		return ErrInviteInvalid
	case InviteExpired:
		return ErrInviteExpired
	case InviteExhausted:
		return ErrInviteExhausted
	default:
		return nil
	}
}

// InviteAcceptance は招待を受け入れた結果。
type InviteAcceptance struct {
	Workspace Workspace
	// AlreadyMember はすでにメンバーだったか。そのときは使用回数を消費していない。
	AlreadyMember bool
}

// AcceptInvite は招待を受け入れて、ワークスペースと is_default のルームに参加する（1 トランザクション。ADR 0011）。
func (s *Service) AcceptInvite(ctx context.Context, actor ulid.ULID, code string) (InviteAcceptance, error) {
	if code == "" {
		return InviteAcceptance{}, ErrInviteInvalid
	}
	var (
		result       InviteAcceptance
		joined       []ulid.ULID
		me           UserProfile
		systemEvents []Event
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		inv, err := q.GetInviteByCodeHash(ctx, hashInviteCode(code))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInviteInvalid
		}
		if err != nil {
			return fmt.Errorf("get invite: %w", err)
		}
		if inv.RevokedAt != nil {
			return ErrInviteInvalid
		}

		now := s.clock.Now()
		// 先にメンバーにしてみる。すでにメンバーなら、使用回数を消費せずに成功を返す。
		// 逆順（消費してからメンバーにする）だと、すでにメンバーの人が上限に達した招待を開いたときに失敗になる。
		added, err := q.AddWorkspaceMemberIfAbsent(ctx, store.AddWorkspaceMemberIfAbsentParams{
			WorkspaceID: inv.WorkspaceID, UserID: actor, Now: now,
		})
		if err != nil {
			return fmt.Errorf("add member: %w", err)
		}
		if added == 0 {
			result.AlreadyMember = true
		} else {
			consumed, err := q.ConsumeInvite(ctx, store.ConsumeInviteParams{ID: inv.ID, Now: now})
			if err != nil {
				return fmt.Errorf("consume invite: %w", err)
			}
			if consumed == 0 {
				// 条件付き UPDATE が 0 行だった理由を、最新の行から求める。エラーを返すので、メンバーの追加もロールバックされる。
				latest, err := q.GetInvite(ctx, inv.ID)
				if err != nil {
					return fmt.Errorf("get invite: %w", err)
				}
				if err := statusError(inviteStatus(latest, now)); err != nil {
					return err
				}
				return fmt.Errorf("consume invite %s: no row updated although it is active", inv.ID)
			}
			joined, err = q.JoinDefaultRooms(ctx, store.JoinDefaultRoomsParams{WorkspaceID: inv.WorkspaceID, UserID: actor, Now: now})
			if err != nil {
				return fmt.Errorf("join default rooms: %w", err)
			}
			if len(joined) > 0 {
				if me, err = userProfile(ctx, q, actor); err != nil {
					return err
				}
				// 既定のルームにも「参加しました」を残す（ADR 0033）。is_default は多くて数件。
				for _, roomID := range joined {
					ev, err := s.writeSystemMessage(ctx, q, roomID, actor, SystemEvent{Type: SystemMemberJoined})
					if err != nil {
						return err
					}
					systemEvents = append(systemEvents, ev)
				}
			}
		}
		result.Workspace, err = getWorkspace(ctx, q, actor, inv.WorkspaceID)
		return err
	})
	if err != nil {
		return InviteAcceptance{}, err
	}
	// 本人は default ルームをまだ購読していないので、member.joined を本人にも届けてサイドバーに出させる（ADR 0015）。
	events := make([]Event, 0, len(joined)+len(systemEvents))
	for _, roomID := range joined {
		events = append(events, memberJoinedEvent(result.Workspace.ID, roomID, me))
	}
	s.deliver(ctx, append(events, systemEvents...)...)
	return result, nil
}
