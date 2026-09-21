package chat

import (
	"context"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// ListMembers はワークスペースのメンバーを user_id の順に返す。actor がメンバーでなければ ErrNotFound。
func (s *Service) ListMembers(ctx context.Context, actor, workspaceID ulid.ULID, page PageRequest) (Page[Member], error) {
	q := store.New(s.db)
	// 自分がメンバーかの確認と一覧の取得は別の文になるが、ここはロックしない。
	// 確認の直後にキックされても、返るのはキックされる直前まで見えていた一覧で、書き込みは起きない。
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return Page[Member]{}, notFoundIfNoRows(err, "get role")
	}
	limit := page.limit()
	rows, err := q.ListWorkspaceMembers(ctx, store.ListWorkspaceMembersParams{
		WorkspaceID: workspaceID,
		// ゼロ値の ULID（全ビット 0）はどの ULID よりも小さいので、先頭から読むことになる。
		After:   page.After,
		MaxRows: int32(limit + 1),
	})
	if err != nil {
		return Page[Member]{}, fmt.Errorf("list members: %w", err)
	}
	members := make([]Member, len(rows))
	ids := make([]ulid.ULID, len(rows))
	now := s.clock.Now()
	for i, r := range rows {
		members[i] = Member{
			User:     UserProfile{ID: r.UserID, Handle: r.Handle, DisplayName: r.DisplayName},
			Role:     Role(r.Role),
			JoinedAt: r.JoinedAt,
			Away:     r.ManualAway,
			// 期限切れのステータスはここで落とす（ADR 0049 決定 6 の追記）。時刻は Clock から取る
			Status: statusOf(r.StatusEmoji, r.StatusText, r.StatusExpiresAt, now),
		}
		ids[i] = r.UserID
	}
	result := newPage(members, limit, func(m Member) ulid.ULID { return m.User.ID })
	// presence はページに残した分だけを 1 回の MGET で読む（ルームのメンバー一覧と同じ。ADR 0015）。
	online := s.online(ctx, ids[:len(result.Items)])
	for i := range result.Items {
		result.Items[i].Presence = presenceOf(online[result.Items[i].User.ID])
	}
	return result, nil
}

// GetMemberProfile は target のプロフィールを返す（ADR 0050 決定 1）。
// actor がメンバーでない、target がメンバーでない（外された・別のワークスペース）、退会済み、はどれも ErrNotFound
// （一覧と同じく、存在するかどうかを区別させない）。
func (s *Service) GetMemberProfile(ctx context.Context, actor, workspaceID, target ulid.ULID) (MemberProfile, error) {
	q := store.New(s.db)
	// ListMembers と同じく、確認と読み取りの間はロックしない。直後にキックされても書き込みは起きない
	role, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return MemberProfile{}, notFoundIfNoRows(err, "get role")
	}
	if !authz.CanViewMemberProfile(Role(role)) {
		return MemberProfile{}, ErrNotFound
	}
	r, err := q.GetWorkspaceMemberProfile(ctx, store.GetWorkspaceMemberProfileParams{WorkspaceID: workspaceID, UserID: target})
	if err != nil {
		return MemberProfile{}, notFoundIfNoRows(err, "get member profile")
	}
	p := MemberProfile{Member: Member{
		User:     UserProfile{ID: r.UserID, Handle: r.Handle, DisplayName: r.DisplayName},
		Role:     Role(r.Role),
		JoinedAt: r.JoinedAt,
		Presence: presenceOf(s.online(ctx, []ulid.ULID{r.UserID})[r.UserID]),
		Away:     r.ManualAway,
		Status:   statusOf(r.StatusEmoji, r.StatusText, r.StatusExpiresAt, s.clock.Now()),
	}}
	// 未検証の email は返さない。誰でも他人のアドレスで登録できるので、出すとカードがそのアドレスを
	// 本人のものとして保証しているように見える（決定 2）
	if r.EmailVerifiedAt != nil {
		p.Email = &r.Email
	}
	return p, nil
}

// lockedRoles は LockWorkspaceMembers でロックした行のロール。メンバーでない userID はキーに含まれない。
type lockedRoles map[ulid.ULID]Role

// lockMembers は actor と target の workspace_members の行をロックし、ロック後のロールを返す（ADR 0011）。
// 判定はこの戻り値だけを使う。ロックの前に読んだロールで判定すると、判定から書き込みまでの間に
// 自分が降格・キックされても操作が通ってしまう。
func lockMembers(ctx context.Context, q *store.Queries, workspaceID ulid.ULID, userIDs ...ulid.ULID) (lockedRoles, error) {
	rows, err := q.LockWorkspaceMembers(ctx, store.LockWorkspaceMembersParams{
		WorkspaceID: workspaceID,
		UserIds:     slices.Compact(slices.SortedFunc(slices.Values(userIDs), ulid.ULID.Compare)),
	})
	if err != nil {
		return nil, fmt.Errorf("lock members: %w", err)
	}
	roles := make(lockedRoles, len(rows))
	for _, r := range rows {
		roles[r.UserID] = Role(r.Role)
	}
	return roles, nil
}

// ChangeMemberRole は target のロールを newRole に変える。owner への変更は譲渡（TransferOwnership）で行う。
func (s *Service) ChangeMemberRole(ctx context.Context, actor, workspaceID, target ulid.ULID, newRole string) (Member, error) {
	role, ok := authz.ParseRole(newRole)
	if !ok {
		return Member{}, &ValidationError{Fields: []FieldError{{Field: "role", Reason: ReasonInvalidValue}}}
	}

	var (
		m       Member
		changed bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		roles, err := lockMembers(ctx, q, workspaceID, actor, target)
		if err != nil {
			return err
		}
		actorRole, ok := roles[actor]
		if !ok {
			return ErrNotFound
		}
		targetRole, ok := roles[target]
		if !ok {
			return ErrNotFound
		}
		if !authz.CanChangeRole(actorRole, targetRole, role) {
			return ErrForbidden
		}
		if targetRole != role {
			if err := q.UpdateWorkspaceMemberRole(ctx, store.UpdateWorkspaceMemberRoleParams{
				WorkspaceID: workspaceID, UserID: target, Role: string(role),
			}); err != nil {
				return fmt.Errorf("update role: %w", err)
			}
			changed = true
		}
		r, err := q.GetWorkspaceMember(ctx, store.GetWorkspaceMemberParams{WorkspaceID: workspaceID, UserID: target})
		if err != nil {
			return notFoundIfNoRows(err, "get member")
		}
		m = Member{
			User:     UserProfile{ID: r.UserID, Handle: r.Handle, DisplayName: r.DisplayName},
			Role:     Role(r.Role),
			JoinedAt: r.JoinedAt,
		}
		return nil
	})
	if err != nil {
		return Member{}, err
	}
	if changed {
		s.deliver(ctx, roleChangedEvent(workspaceID, target, role))
	}
	return m, nil
}

// roleChangedEvent は、ワークスペースの購読者（メンバー一覧のロールの表示）と本人に届ける。
// 読める範囲はロールに依存しないが、権限の変更として購読を再検証させる（CLAUDE.md ルール 8。判定を Hub に持たせない）。
func roleChangedEvent(workspaceID, userID ulid.ULID, role Role) Event {
	return Event{
		Type:          EventWorkspaceRoleChanged,
		To:            Audience{Workspaces: []ulid.ULID{workspaceID}, Users: []ulid.ULID{userID}},
		AccessChanges: []AccessChange{{UserID: userID, WorkspaceID: workspaceID}},
		Data:          WorkspaceRoleChanged{WorkspaceID: workspaceID, UserID: userID, Role: role},
	}
}

// RemoveMember は target をワークスペースから外す。target が actor 自身なら退出として扱う。
// ワークスペースのすべてのルームからも同じトランザクションで外す。
func (s *Service) RemoveMember(ctx context.Context, actor, workspaceID, target ulid.ULID) error {
	var leftRooms []ulid.ULID
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		roles, err := lockMembers(ctx, q, workspaceID, actor, target)
		if err != nil {
			return err
		}
		actorRole, ok := roles[actor]
		if !ok {
			return ErrNotFound
		}
		if actor == target {
			if !authz.CanLeaveWorkspace(actorRole) {
				// 退出できないのは owner だけ。クライアントが「先に譲渡する」導線を出せるよう、理由を区別して返す。
				return ErrOwnerMustTransfer
			}
		} else {
			targetRole, ok := roles[target]
			if !ok {
				return ErrNotFound
			}
			if !authz.CanRemoveMember(actorRole, targetRole) {
				return ErrForbidden
			}
		}
		// 先に room_members を消す。順序は結果に影響しないが、ワークスペースのメンバーでないのに
		// ルームのメンバーである状態を、トランザクションの中でも作らないようにしておく。
		leftRooms, err = q.DeleteRoomMembershipsInWorkspace(ctx, store.DeleteRoomMembershipsInWorkspaceParams{
			WorkspaceID: workspaceID, UserID: target,
		})
		if err != nil {
			return fmt.Errorf("delete room memberships: %w", err)
		}
		if err := q.DeleteWorkspaceMember(ctx, store.DeleteWorkspaceMemberParams{WorkspaceID: workspaceID, UserID: target}); err != nil {
			return fmt.Errorf("delete member: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	reason := RemovalRemoved
	if actor == target {
		reason = RemovalLeft
	}
	// 本人の購読を先に外させてから（AccessChanges）、ワークスペースと各ルームの購読者に知らせる。
	events := []Event{{
		Type:          EventWorkspaceMemberRemoved,
		To:            Audience{Workspaces: []ulid.ULID{workspaceID}, Users: []ulid.ULID{target}},
		AccessChanges: []AccessChange{{UserID: target, WorkspaceID: workspaceID}},
		Data:          WorkspaceMemberRemoved{WorkspaceID: workspaceID, UserID: target, Reason: reason},
	}}
	for _, roomID := range leftRooms {
		events = append(events, memberLeftEvent(workspaceID, roomID, target))
	}
	s.deliver(ctx, events...)
	return nil
}

func memberLeftEvent(workspaceID, roomID, userID ulid.ULID) Event {
	return Event{
		Type: EventMemberLeft,
		To:   Audience{Rooms: []ulid.ULID{roomID}},
		Data: MemberLeft{WorkspaceID: workspaceID, RoomID: roomID, UserID: userID},
	}
}

// TransferOwnership は owner を target に譲渡する。actor は admin になる。
func (s *Service) TransferOwnership(ctx context.Context, actor, workspaceID, target ulid.ULID) error {
	if actor == target {
		return &ValidationError{Fields: []FieldError{{Field: "user_id", Reason: ReasonInvalidValue}}}
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		roles, err := lockMembers(ctx, q, workspaceID, actor, target)
		if err != nil {
			return err
		}
		actorRole, ok := roles[actor]
		if !ok {
			return ErrNotFound
		}
		if !authz.CanTransferOwnership(actorRole) {
			return ErrForbidden
		}
		if _, ok := roles[target]; !ok {
			return ErrNotFound
		}
		// owner の部分 UNIQUE インデックスは遅延評価できないので、降格を先にする。
		// 逆にすると、昇格の時点で owner が 2 人になって UNIQUE 違反になる。
		if err := q.UpdateWorkspaceMemberRole(ctx, store.UpdateWorkspaceMemberRoleParams{
			WorkspaceID: workspaceID, UserID: actor, Role: string(authz.RoleAdmin),
		}); err != nil {
			return fmt.Errorf("demote owner: %w", err)
		}
		if err := q.UpdateWorkspaceMemberRole(ctx, store.UpdateWorkspaceMemberRoleParams{
			WorkspaceID: workspaceID, UserID: target, Role: string(authz.RoleOwner),
		}); err != nil {
			return fmt.Errorf("promote new owner: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.deliver(ctx, roleChangedEvent(workspaceID, actor, authz.RoleAdmin), roleChangedEvent(workspaceID, target, authz.RoleOwner))
	return nil
}
