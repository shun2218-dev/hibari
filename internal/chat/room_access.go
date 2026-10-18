package chat

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// ルームを読めるか・書けるかの判定に使う値（ADR 0011）。message / thread / attachment からも使う。

// roomAccess は、ルームに対する関係者の立場をまとめて読んだもの。
type roomAccess struct {
	room  store.Room
	roles map[ulid.ULID]Role
	// members は userIDs のうちルームのメンバーである人。
	members map[ulid.ULID]bool
}

func (a roomAccess) actor(userID ulid.ULID) authz.RoomActor {
	return authz.RoomActor{Role: a.roles[userID], IsRoomMember: a.members[userID]}
}

func (a roomAccess) kind() RoomKind { return RoomKind(a.room.Kind) }

// authzRoom は authz に渡すルームの情報（ADR 0059 決定 2）。
func (a roomAccess) authzRoom() authz.Room {
	return authz.Room{Kind: a.kind(), IsDefault: a.room.IsDefault, Archived: a.room.ArchivedAt != nil}
}

// authorize は authz の判定 check をルームに当て、拒まれたときに返すエラーを選ぶ（ADR 0059 決定 2）。
// アーカイブ中でなければ許されたのなら ErrRoomArchived（権限はあるが、今はできない）、そうでなければ ErrForbidden。
// 「アーカイブ中でなければ」の判定も authz に聞き直し、判定の中身をここに書かない。
func (a roomAccess) authorize(check func(authz.Room) bool) error {
	r := a.authzRoom()
	if check(r) {
		return nil
	}
	if r.Archived {
		r.Archived = false
		if check(r) {
			return ErrRoomArchived
		}
	}
	return ErrForbidden
}

// archivedIfNoRows は、採番の UPDATE が行を返さなかったこと（= その間にアーカイブされた。ADR 0059 決定 3）を ErrRoomArchived にする。
// 採番の前に rooms の行はあることを確かめているので、行がないのはアーカイブのときだけ。
func archivedIfNoRows(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRoomArchived
	}
	return fmt.Errorf("%s: %w", what, err)
}

// lockMode は loadRoomAccess がどの行をロックするか。
type lockMode int

const (
	// noLock は読み取りだけの API で使う。FOR SHARE は行にロックの情報を書き込むので、頻繁に呼ばれる読み取りでは取らない。
	noLock lockMode = iota
	// shareLock は、判定の後に room_members を増やしたり、ロールに基づいて書き込んだりする API で使う。
	// workspace_members の行を共有ロックし、キックやロールの変更と直列化する（ADR 0011）。
	shareLock
	// memberRowLock は、ルームのメンバーであることだけを根拠に書き込む API（送信・編集）で使う。
	// room_members の行を FOR NO KEY UPDATE でロックし、キック・退出（行の DELETE）と直列化する（ADR 0012）。
	// workspace_members はロックしない。送信のたびにその行へロックの情報を書き込まないため。
	memberRowLock
)

// loadRoomAccess はルームと、userIDs（先頭が actor）のワークスペースでのロールとルームのメンバーかどうかを読む。
//
// ロックの範囲は mode で選ぶ（lockMode の説明を参照）。
// actor がルームを読めなければ ErrNotFound を返す（存在を明かさない）。
func loadRoomAccess(ctx context.Context, q *store.Queries, mode lockMode, roomID ulid.ULID, userIDs ...ulid.ULID) (roomAccess, error) {
	room, err := q.GetRoom(ctx, roomID)
	if err != nil {
		return roomAccess{}, notFoundIfNoRows(err, "get room")
	}
	ids := slices.Compact(slices.SortedFunc(slices.Values(userIDs), ulid.ULID.Compare))
	a := roomAccess{room: room, roles: map[ulid.ULID]Role{}, members: map[ulid.ULID]bool{}}
	if mode == shareLock {
		rows, err := q.ShareLockWorkspaceMembers(ctx, store.ShareLockWorkspaceMembersParams{WorkspaceID: room.WorkspaceID, UserIds: ids})
		if err != nil {
			return roomAccess{}, fmt.Errorf("lock members: %w", err)
		}
		for _, r := range rows {
			a.roles[r.UserID] = Role(r.Role)
		}
	} else {
		rows, err := q.GetWorkspaceMemberRoles(ctx, store.GetWorkspaceMemberRolesParams{WorkspaceID: room.WorkspaceID, UserIds: ids})
		if err != nil {
			return roomAccess{}, fmt.Errorf("get member roles: %w", err)
		}
		for _, r := range rows {
			a.roles[r.UserID] = Role(r.Role)
		}
	}
	var memberships []ulid.ULID
	if mode == memberRowLock {
		memberships, err = q.LockRoomMemberships(ctx, store.LockRoomMembershipsParams{RoomID: roomID, UserIds: ids})
	} else {
		memberships, err = q.GetRoomMemberships(ctx, store.GetRoomMembershipsParams{RoomID: roomID, UserIds: ids})
	}
	if err != nil {
		return roomAccess{}, fmt.Errorf("get room memberships: %w", err)
	}
	for _, m := range memberships {
		a.members[m] = true
	}
	if !authz.CanReadRoom(a.authzRoom(), a.actor(userIDs[0])) {
		return roomAccess{}, ErrNotFound
	}
	return a, nil
}
