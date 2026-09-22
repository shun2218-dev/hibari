package chat

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// ルームのメンバー（ADR 0011）。参加・追加・削除・一覧。

// JoinRoom は public ルームに参加する。すでにメンバーでも成功を返す（冪等）。
func (s *Service) JoinRoom(ctx context.Context, actor, roomID ulid.ULID) (Room, error) {
	var (
		room   Room
		events []Event
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor)
		if err != nil {
			return err
		}
		if err := a.authorize(func(r authz.Room) bool { return authz.CanJoinRoom(r, a.actor(actor)) }); err != nil {
			return err
		}
		n, err := q.AddRoomMember(ctx, store.AddRoomMemberParams{RoomID: roomID, UserID: actor, Now: s.clock.Now()})
		if err != nil {
			return fmt.Errorf("join room: %w", err)
		}
		if n > 0 {
			if events, err = newRoomMembers(ctx, q, a.room.WorkspaceID, roomID, []ulid.ULID{actor}); err != nil {
				return err
			}
			joined, err := s.writeSystemMessage(ctx, q, roomID, actor, SystemEvent{Type: SystemMemberJoined})
			if err != nil {
				return err
			}
			events = append(events, joined)
		}
		room, err = getRoom(ctx, q, actor, roomID, s.clock.Now())
		return err
	})
	if err != nil {
		return Room{}, err
	}
	s.deliver(ctx, events...)
	return room, nil
}

// AddRoomMember は target を private ルームに追加する。すでにメンバーでも成功を返す（冪等）。
func (s *Service) AddRoomMember(ctx context.Context, actor, roomID, target ulid.ULID) error {
	var events []Event
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor, target)
		if err != nil {
			return err
		}
		if err := a.authorize(func(r authz.Room) bool { return authz.CanAddRoomMember(r, a.actor(actor)) }); err != nil {
			return err
		}
		if !a.roles[target].IsMember() {
			return ErrUserNotInWorkspace
		}
		n, err := q.AddRoomMember(ctx, store.AddRoomMemberParams{RoomID: roomID, UserID: target, Now: s.clock.Now()})
		if err != nil {
			return fmt.Errorf("add room member: %w", err)
		}
		if n > 0 {
			// 追加された本人はまだこのルームを購読していないので、本人にも member.joined を届ける（ADR 0015）。
			if events, err = newRoomMembers(ctx, q, a.room.WorkspaceID, roomID, []ulid.ULID{target}); err != nil {
				return err
			}
			// ログの主語は追加された人（自分で参加したときと同じ行にする。ADR 0033）。
			joined, err := s.writeSystemMessage(ctx, q, roomID, target, SystemEvent{Type: SystemMemberJoined})
			if err != nil {
				return err
			}
			events = append(events, joined)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.deliver(ctx, events...)
	return nil
}

// RemoveRoomMember は target をルームから外す。target が actor 自身なら退出として扱う。
func (s *Service) RemoveRoomMember(ctx context.Context, actor, roomID, target ulid.ULID) error {
	var (
		workspaceID  ulid.ULID
		systemEvents []Event
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor, target)
		if err != nil {
			return err
		}
		if a.kind() == authz.RoomDM {
			// DM のメンバーは作成時の 2 人で固定する（ADR 0011）。
			return ErrForbidden
		}
		if !a.members[target] {
			return ErrNotFound
		}
		if actor == target {
			if !authz.CanLeaveRoom(a.authzRoom(), a.actor(actor)) {
				return ErrForbidden
			}
		} else if err := a.authorize(func(r authz.Room) bool {
			return authz.CanRemoveRoomMember(r, a.actor(actor), a.roles[target])
		}); err != nil {
			return err
		}
		if _, err := q.DeleteRoomMember(ctx, store.DeleteRoomMemberParams{RoomID: roomID, UserID: target}); err != nil {
			return fmt.Errorf("delete room member: %w", err)
		}
		workspaceID = a.room.WorkspaceID
		// 主語は抜けた人。誰が外したかは出さない（ADR 0033）。
		systemType := SystemMemberRemoved
		if actor == target {
			systemType = SystemMemberLeft
		}
		left, err := s.writeSystemMessage(ctx, q, roomID, target, SystemEvent{Type: systemType})
		if err != nil {
			return err
		}
		systemEvents = append(systemEvents, left)
		return nil
	})
	if err != nil {
		return err
	}
	reason := RemovalRemoved
	if actor == target {
		reason = RemovalLeft
	}
	// 本人の購読を先に再検証させてから（private なら外れる）、本人とルームの購読者に知らせる（CLAUDE.md ルール 8）。
	s.deliver(ctx, append([]Event{
		{
			Type:          EventRoomMemberRemoved,
			To:            Audience{Users: []ulid.ULID{target}},
			AccessChanges: []AccessChange{{UserID: target, WorkspaceID: workspaceID}},
			Data:          RoomMemberRemoved{WorkspaceID: workspaceID, RoomID: roomID, Reason: reason},
		},
		memberLeftEvent(workspaceID, roomID, target),
	}, systemEvents...)...)
	return nil
}

// ListRoomMembers はルームのメンバーを user_id の順に返す。ルームを読める人なら取得できる。
func (s *Service) ListRoomMembers(ctx context.Context, actor, roomID ulid.ULID, page PageRequest) (Page[RoomMember], error) {
	q := store.New(s.db)
	if _, err := loadRoomAccess(ctx, q, noLock, roomID, actor); err != nil {
		return Page[RoomMember]{}, err
	}
	limit := page.limit()
	rows, err := q.ListRoomMembers(ctx, store.ListRoomMembersParams{RoomID: roomID, After: page.After, MaxRows: int32(limit + 1)})
	if err != nil {
		return Page[RoomMember]{}, fmt.Errorf("list room members: %w", err)
	}
	members := make([]RoomMember, len(rows))
	ids := make([]ulid.ULID, len(rows))
	now := s.clock.Now()
	for i, r := range rows {
		members[i] = RoomMember{
			User:     UserProfile{ID: r.UserID, Handle: r.Handle, DisplayName: r.DisplayName},
			Role:     Role(r.Role),
			JoinedAt: r.JoinedAt,
			Away:     r.ManualAway,
			Status:   statusOf(r.StatusEmoji, r.StatusText, r.StatusExpiresAt, now),
		}
		ids[i] = r.UserID
	}
	result := newPage(members, limit, func(m RoomMember) ulid.ULID { return m.User.ID })
	// presence はページに残した分だけを 1 回の MGET で読む。
	pageIDs := ids[:len(result.Items)]
	online := s.online(ctx, pageIDs)
	for i := range result.Items {
		result.Items[i].Presence = presenceOf(online[result.Items[i].User.ID])
	}
	return result, nil
}
