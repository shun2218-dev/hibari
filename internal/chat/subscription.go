package chat

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// SubscriptionAuthorizer は WebSocket の購読と typing の authz（ADR 0015）。
//
// Service と分けて DB だけを持たせる。Hub はこの authz を必要とし、Service は Hub（Delivery）を必要とするので、
// 1 つの型にすると依存が循環する。判定そのものは authz の関数が行い、ここは判定に必要な事実を DB から読むだけ（CLAUDE.md ルール 9）。
type SubscriptionAuthorizer struct {
	db *pgxpool.Pool
}

// NewSubscriptionAuthorizer は SubscriptionAuthorizer を返す。
func NewSubscriptionAuthorizer(db *pgxpool.Pool) *SubscriptionAuthorizer {
	return &SubscriptionAuthorizer{db: db}
}

// AuthorizeRoom は userID がルームを購読できるかを判定し、ルームのワークスペースを返す。
// 読めなければ（存在しない場合も）ErrNotFound。
func (a *SubscriptionAuthorizer) AuthorizeRoom(ctx context.Context, userID, roomID ulid.ULID) (workspaceID ulid.ULID, err error) {
	rooms, err := a.roomAccess(ctx, userID, []ulid.ULID{roomID})
	if err != nil {
		return ulid.ULID{}, err
	}
	r, ok := rooms[roomID]
	if !ok || !authz.CanSubscribeRoom(r.kind, r.actor) {
		return ulid.ULID{}, ErrNotFound
	}
	return r.workspaceID, nil
}

// AuthorizeWorkspace は userID がワークスペースを購読できるかを判定する。できなければ ErrNotFound。
func (a *SubscriptionAuthorizer) AuthorizeWorkspace(ctx context.Context, userID, workspaceID ulid.ULID) error {
	roles, err := a.workspaceRoles(ctx, userID, []ulid.ULID{workspaceID})
	if err != nil {
		return err
	}
	if !authz.CanSubscribeWorkspace(roles[workspaceID]) {
		return ErrNotFound
	}
	return nil
}

// Allowed は、roomIDs と workspaceIDs のうち userID がいまも購読できるものを返す。
// 権限の変更と定期的な再検証で、接続が持っている購読をまとめて確かめるのに使う（ルームとワークスペースで 1 本ずつのクエリ）。
func (a *SubscriptionAuthorizer) Allowed(ctx context.Context, userID ulid.ULID, roomIDs, workspaceIDs []ulid.ULID) (rooms, workspaces map[ulid.ULID]bool, err error) {
	rooms = map[ulid.ULID]bool{}
	workspaces = map[ulid.ULID]bool{}
	if len(roomIDs) > 0 {
		access, err := a.roomAccess(ctx, userID, roomIDs)
		if err != nil {
			return nil, nil, err
		}
		for id, r := range access {
			if authz.CanSubscribeRoom(r.kind, r.actor) {
				rooms[id] = true
			}
		}
	}
	if len(workspaceIDs) > 0 {
		roles, err := a.workspaceRoles(ctx, userID, workspaceIDs)
		if err != nil {
			return nil, nil, err
		}
		for id, role := range roles {
			if authz.CanSubscribeWorkspace(role) {
				workspaces[id] = true
			}
		}
	}
	return rooms, workspaces, nil
}

// AuthorizeTyping は userID がルームで入力中を知らせられるかを判定し、typing.started に載せる情報を返す。
// 読めなければ ErrNotFound、読めるが投稿できなければ ErrForbidden。
func (a *SubscriptionAuthorizer) AuthorizeTyping(ctx context.Context, userID, roomID ulid.ULID) (TypingStarted, error) {
	q := store.New(a.db)
	rooms, err := a.roomAccess(ctx, userID, []ulid.ULID{roomID})
	if err != nil {
		return TypingStarted{}, err
	}
	r, ok := rooms[roomID]
	switch {
	case !ok || !authz.CanReadRoom(r.kind, r.actor):
		return TypingStarted{}, ErrNotFound
	case !authz.CanSendTyping(r.kind, r.actor):
		return TypingStarted{}, ErrForbidden
	}
	user, err := userProfile(ctx, q, userID)
	if err != nil {
		return TypingStarted{}, err
	}
	return TypingStarted{WorkspaceID: r.workspaceID, RoomID: roomID, User: user}, nil
}

// WorkspaceIDs は userID が所属するワークスペースを返す。presence.changed の宛先に使う。
func (a *SubscriptionAuthorizer) WorkspaceIDs(ctx context.Context, userID ulid.ULID) ([]ulid.ULID, error) {
	ids, err := store.New(a.db).ListWorkspaceIDsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list workspaces for user: %w", err)
	}
	return ids, nil
}

type subscribedRoom struct {
	workspaceID ulid.ULID
	kind        RoomKind
	actor       authz.RoomActor
}

func (a *SubscriptionAuthorizer) roomAccess(ctx context.Context, userID ulid.ULID, roomIDs []ulid.ULID) (map[ulid.ULID]subscribedRoom, error) {
	rows, err := store.New(a.db).ListRoomAccessForUser(ctx, store.ListRoomAccessForUserParams{UserID: userID, RoomIds: roomIDs})
	if err != nil {
		return nil, fmt.Errorf("list room access: %w", err)
	}
	rooms := make(map[ulid.ULID]subscribedRoom, len(rows))
	for _, r := range rows {
		rooms[r.ID] = subscribedRoom{
			workspaceID: r.WorkspaceID,
			kind:        RoomKind(r.Kind),
			actor:       authz.RoomActor{Role: Role(r.Role), IsRoomMember: r.IsRoomMember},
		}
	}
	return rooms, nil
}

func (a *SubscriptionAuthorizer) workspaceRoles(ctx context.Context, userID ulid.ULID, workspaceIDs []ulid.ULID) (map[ulid.ULID]Role, error) {
	rows, err := store.New(a.db).ListWorkspaceRolesForUser(ctx, store.ListWorkspaceRolesForUserParams{UserID: userID, WorkspaceIds: workspaceIDs})
	if err != nil {
		return nil, fmt.Errorf("list workspace roles: %w", err)
	}
	roles := make(map[ulid.ULID]Role, len(rows))
	for _, r := range rows {
		roles[r.WorkspaceID] = Role(r.Role)
	}
	return roles, nil
}
