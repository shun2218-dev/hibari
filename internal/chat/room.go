package chat

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

var (
	// ErrRoomNameTaken は同じ名前のルームがワークスペースにあることを表す。
	ErrRoomNameTaken = errors.New("chat: room name already taken")
	// ErrUserNotInWorkspace は、ルームへの追加や DM の相手がワークスペースのメンバーではないことを表す。
	ErrUserNotInWorkspace = errors.New("chat: user is not a member of the workspace")
)

// roomNameMax はルーム名の長さの上限（rune 単位）。
const roomNameMax = 80

// RoomKind はルームの種類。
type RoomKind = authz.RoomKind

// Room は actor から見たルーム。
type Room struct {
	ID          ulid.ULID
	WorkspaceID ulid.ULID
	Kind        RoomKind
	// Name は dm では空。
	Name      string
	IsDefault bool
	// IsMember は actor がルームのメンバーか。public は参加していなくても読める。
	IsMember bool
	// MemberCount は 1 件を取得したときだけ入る。一覧では 0。
	MemberCount int64
	// DMPeer は dm の相手。dm 以外では nil。
	DMPeer         *UserProfile
	LastMessageSeq int64
	LastMessageAt  *time.Time
	// LastReadSeq は actor の既読位置。ルームのメンバーでなければ nil。
	LastReadSeq *int64
	// UnreadCount は last_message_seq - last_read_seq。削除済みのメッセージも数える近似（ADR 0002）。メンバーでなければ 0。
	UnreadCount int64
	// LastMessage はサイドバーに出す最終メッセージ。メッセージがなければ nil。
	LastMessage *MessagePreview
	CreatedAt   time.Time
}

// MessagePreview はサイドバーに出す最終メッセージ。
type MessagePreview struct {
	ID     ulid.ULID
	Sender UserProfile
	// Body は削除済みなら空。
	Body      string
	CreatedAt time.Time
	Deleted   bool
}

// toRoom はルームの行と、actor の既読位置・最終メッセージを JOIN した行から Room を作る。
// GetRoomSummary の行は、同じ列の store.ListRoomsForUserRow に変換してから渡す。
func toRoom(r store.ListRoomsForUserRow) Room {
	room := Room{
		ID:             r.Room.ID,
		WorkspaceID:    r.Room.WorkspaceID,
		Kind:           RoomKind(r.Room.Kind),
		IsDefault:      r.Room.IsDefault,
		IsMember:       r.IsMember,
		LastMessageSeq: r.Room.LastMessageSeq,
		LastMessageAt:  r.Room.LastMessageAt,
		LastReadSeq:    r.LastReadSeq,
		CreatedAt:      r.Room.CreatedAt,
	}
	if r.Room.Name != nil {
		room.Name = *r.Room.Name
	}
	if r.LastReadSeq != nil {
		room.UnreadCount = r.Room.LastMessageSeq - *r.LastReadSeq
	}
	if r.LastMessageID != nil {
		room.LastMessage = &MessagePreview{
			ID:        *r.LastMessageID,
			Sender:    UserProfile{ID: *r.LastMessageSenderID, Handle: *r.LastMessageSenderHandle, DisplayName: *r.LastMessageSenderDisplayName},
			Body:      *r.LastMessageBody,
			CreatedAt: *r.LastMessageCreatedAt,
			Deleted:   r.LastMessageDeletedAt != nil,
		}
	}
	return room
}

// roomSummary は actor から見たルームを 1 件読む（既読位置と最終メッセージを含む）。読めるかどうかの判定は呼び出し側で済ませる。
func roomSummary(ctx context.Context, q *store.Queries, actor, roomID ulid.ULID) (Room, error) {
	row, err := q.GetRoomSummary(ctx, store.GetRoomSummaryParams{UserID: actor, RoomID: roomID})
	if err != nil {
		return Room{}, fmt.Errorf("get room summary: %w", err)
	}
	return toRoom(store.ListRoomsForUserRow(row)), nil
}

// RoomMember はルームのメンバー。
type RoomMember struct {
	User UserProfile
	// Role はワークスペースでのロール（ルーム単位のロールは持たない。ADR 0006）。
	Role     Role
	JoinedAt time.Time
}

// dmKey は同じ 2 人の DM を 1 つに限るための値。順序に依存しないよう、ULID の文字列をソートして連結する（ADR 0006）。
func dmKey(a, b ulid.ULID) string {
	ids := []string{a.String(), b.String()}
	slices.Sort(ids)
	return ids[0] + ":" + ids[1]
}

// dmPeerID は dm_key から actor ではない方の userID を返す。
// room_members からは求めない。相手がワークスペースを抜けると、その行は消えているため。
func dmPeerID(key string, actor ulid.ULID) (ulid.ULID, error) {
	a, b, ok := strings.Cut(key, ":")
	if !ok {
		return ulid.ULID{}, fmt.Errorf("malformed dm_key %q", key)
	}
	peer := a
	if a == actor.String() {
		peer = b
	}
	return ulid.ParseStrict(peer)
}

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
	if !authz.CanReadRoom(a.kind(), a.actor(userIDs[0])) {
		return roomAccess{}, ErrNotFound
	}
	return a, nil
}

// CreateRoomInput はルームの作成の入力。
type CreateRoomInput struct {
	Kind string
	// Name は public / private で使う。
	Name string
	// UserID は dm の相手。
	UserID ulid.ULID
}

// CreateRoom はルームを作る。dm で同じ 2 人の DM がすでにあれば、created を false にして既存のルームを返す。
func (s *Service) CreateRoom(ctx context.Context, actor, workspaceID ulid.ULID, in CreateRoomInput) (room Room, created bool, err error) {
	kind := RoomKind(in.Kind)
	var fields fieldErrors
	switch kind {
	case authz.RoomPublic, authz.RoomPrivate:
		in.Name = normalizeName(&fields, "name", in.Name, roomNameMax)
	case authz.RoomDM:
		switch in.UserID {
		case ulid.ULID{}:
			fields.add("user_id", ReasonRequired)
		case actor:
			// 自分自身との DM は作れない（ADR 0011）。
			fields.add("user_id", ReasonInvalidValue)
		}
	default:
		fields.add("kind", ReasonInvalidValue)
	}
	if err := fields.err(); err != nil {
		return Room{}, false, err
	}

	err = s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		if kind == authz.RoomDM {
			room, created, err = s.createDM(ctx, q, actor, workspaceID, in.UserID)
			return err
		}
		room, err = s.createNamedRoom(ctx, q, actor, workspaceID, kind, in.Name)
		created = err == nil
		return err
	})
	if err != nil {
		return Room{}, false, err
	}
	return room, created, nil
}

func (s *Service) createNamedRoom(ctx context.Context, q *store.Queries, actor, workspaceID ulid.ULID, kind RoomKind, name string) (Room, error) {
	me, err := q.GetWorkspaceRoleForShare(ctx, store.GetWorkspaceRoleForShareParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return Room{}, notFoundIfNoRows(err, "get role")
	}
	if !authz.CanCreateRoom(Role(me.Role)) {
		return Room{}, ErrForbidden
	}
	now := s.clock.Now()
	r, err := q.CreateRoom(ctx, store.CreateRoomParams{
		ID:          s.ids.New(),
		WorkspaceID: workspaceID,
		Kind:        string(kind),
		Name:        &name,
		CreatedBy:   actor,
		Now:         now,
	})
	if err != nil {
		// 先に SELECT で確かめると、並行した作成の間に割り込まれるので、制約違反をエラーとして受け取る。
		if isUniqueViolation(err, "rooms_workspace_id_name_idx") {
			return Room{}, ErrRoomNameTaken
		}
		return Room{}, fmt.Errorf("create room: %w", err)
	}
	if _, err := q.AddRoomMember(ctx, store.AddRoomMemberParams{RoomID: r.ID, UserID: actor, Now: now}); err != nil {
		return Room{}, fmt.Errorf("add creator: %w", err)
	}
	room, err := roomSummary(ctx, q, actor, r.ID)
	if err != nil {
		return Room{}, err
	}
	room.MemberCount = 1
	return room, nil
}

func (s *Service) createDM(ctx context.Context, q *store.Queries, actor, workspaceID, peer ulid.ULID) (Room, bool, error) {
	ids := slices.SortedFunc(slices.Values([]ulid.ULID{actor, peer}), ulid.ULID.Compare)
	locked, err := q.ShareLockWorkspaceMembers(ctx, store.ShareLockWorkspaceMembersParams{WorkspaceID: workspaceID, UserIds: ids})
	if err != nil {
		return Room{}, false, fmt.Errorf("lock members: %w", err)
	}
	roles := map[ulid.ULID]Role{}
	for _, l := range locked {
		roles[l.UserID] = Role(l.Role)
	}
	if !authz.CanCreateRoom(roles[actor]) {
		return Room{}, false, ErrNotFound
	}
	if !roles[peer].IsMember() {
		// DM はワークスペース内に閉じる（ADR 0006）。
		return Room{}, false, ErrUserNotInWorkspace
	}

	now := s.clock.Now()
	key := dmKey(actor, peer)
	created := true
	r, err := q.CreateDMRoom(ctx, store.CreateDMRoomParams{
		ID: s.ids.New(), WorkspaceID: workspaceID, DmKey: &key, CreatedBy: actor, Now: now,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		created = false
		r, err = q.GetDMRoom(ctx, store.GetDMRoomParams{WorkspaceID: workspaceID, DmKey: &key})
	}
	if err != nil {
		return Room{}, false, fmt.Errorf("create dm: %w", err)
	}
	// 既存の DM でも 2 人を入れ直す。ワークスペースを抜けて戻ってきた人が、元の DM に戻れるようにする（ADR 0011）。
	for _, u := range ids {
		if _, err := q.AddRoomMember(ctx, store.AddRoomMemberParams{RoomID: r.ID, UserID: u, Now: now}); err != nil {
			return Room{}, false, fmt.Errorf("add dm member: %w", err)
		}
	}
	// 既存の DM ならメッセージがありうるので、既読位置と最終メッセージも読む。
	room, err := roomSummary(ctx, q, actor, r.ID)
	if err != nil {
		return Room{}, false, err
	}
	room.MemberCount = 2
	profiles, err := q.ListUserProfiles(ctx, []ulid.ULID{peer})
	if err != nil || len(profiles) != 1 {
		return Room{}, false, fmt.Errorf("get dm peer: %w (found %d)", err, len(profiles))
	}
	room.DMPeer = &UserProfile{ID: profiles[0].ID, Handle: profiles[0].Handle, DisplayName: profiles[0].DisplayName}
	return room, created, nil
}

// ListRooms は actor のサイドバーに出すルームを返す。参加しているルームと、参加していない public ルーム。
func (s *Service) ListRooms(ctx context.Context, actor, workspaceID ulid.ULID) ([]Room, error) {
	q := store.New(s.db)
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return nil, notFoundIfNoRows(err, "get role")
	}
	rows, err := q.ListRoomsForUser(ctx, store.ListRoomsForUserParams{WorkspaceID: workspaceID, UserID: actor})
	if err != nil {
		return nil, fmt.Errorf("list rooms: %w", err)
	}
	rooms := make([]Room, len(rows))
	dmKeys := make([]*string, len(rows))
	for i, r := range rows {
		rooms[i] = toRoom(r)
		dmKeys[i] = r.Room.DmKey
	}
	if err := attachDMPeers(ctx, q, actor, rooms, dmKeys); err != nil {
		return nil, err
	}
	return rooms, nil
}

// attachDMPeers は dm のルームに相手のプロフィールを付ける。dmKeys[i] は rooms[i] の dm_key（dm 以外は nil）。
// プロフィールは 1 回のクエリでまとめて引く（N+1 にしない）。
func attachDMPeers(ctx context.Context, q *store.Queries, actor ulid.ULID, rooms []Room, dmKeys []*string) error {
	peers := map[int]ulid.ULID{}
	var ids []ulid.ULID
	for i, key := range dmKeys {
		if key == nil {
			continue
		}
		peer, err := dmPeerID(*key, actor)
		if err != nil {
			return fmt.Errorf("room %s: %w", rooms[i].ID, err)
		}
		peers[i] = peer
		ids = append(ids, peer)
	}
	if len(ids) == 0 {
		return nil
	}
	profiles, err := q.ListUserProfiles(ctx, ids)
	if err != nil {
		return fmt.Errorf("list dm peers: %w", err)
	}
	byID := make(map[ulid.ULID]UserProfile, len(profiles))
	for _, p := range profiles {
		byID[p.ID] = UserProfile{ID: p.ID, Handle: p.Handle, DisplayName: p.DisplayName}
	}
	for i, peer := range peers {
		if p, ok := byID[peer]; ok {
			rooms[i].DMPeer = &p
		}
	}
	return nil
}

// GetRoom はルームを返す。読めなければ ErrNotFound。
func (s *Service) GetRoom(ctx context.Context, actor, roomID ulid.ULID) (Room, error) {
	return getRoom(ctx, store.New(s.db), actor, roomID)
}

// getRoom はロックせずにルームを読む。書き込みの後で結果を返すときは、同じトランザクションの q を渡す。
func getRoom(ctx context.Context, q *store.Queries, actor, roomID ulid.ULID) (Room, error) {
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return Room{}, err
	}
	room, err := roomSummary(ctx, q, actor, roomID)
	if err != nil {
		return Room{}, err
	}
	if room.MemberCount, err = q.GetRoomMemberCount(ctx, roomID); err != nil {
		return Room{}, fmt.Errorf("count room members: %w", err)
	}
	rooms := []Room{room}
	if err := attachDMPeers(ctx, q, actor, rooms, []*string{a.room.DmKey}); err != nil {
		return Room{}, err
	}
	return rooms[0], nil
}

// RoomUpdate はルームの変更。nil の項目は変更しない。
type RoomUpdate struct {
	Name      *string
	IsDefault *bool
}

// UpdateRoom はルームの名前と is_default を変更する。admin 以上で、そのルームを読める人だけができる（ADR 0011）。
func (s *Service) UpdateRoom(ctx context.Context, actor, roomID ulid.ULID, in RoomUpdate) (Room, error) {
	var fields fieldErrors
	params := store.UpdateRoomParams{ID: roomID, IsDefault: in.IsDefault}
	if in.Name != nil {
		name := normalizeName(&fields, "name", *in.Name, roomNameMax)
		params.Name = &name
	}
	if err := fields.err(); err != nil {
		return Room{}, err
	}

	var room Room
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor)
		if err != nil {
			return err
		}
		if !authz.CanUpdateRoom(a.kind(), a.actor(actor)) {
			return ErrForbidden
		}
		if params.Name != nil || params.IsDefault != nil {
			if _, err := q.UpdateRoom(ctx, params); err != nil {
				if isUniqueViolation(err, "rooms_workspace_id_name_idx") {
					return ErrRoomNameTaken
				}
				return fmt.Errorf("update room: %w", err)
			}
		}
		room, err = getRoom(ctx, q, actor, roomID)
		return err
	})
	return room, err
}

// JoinRoom は public ルームに参加する。すでにメンバーでも成功を返す（冪等）。
func (s *Service) JoinRoom(ctx context.Context, actor, roomID ulid.ULID) (Room, error) {
	var room Room
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor)
		if err != nil {
			return err
		}
		if !authz.CanJoinRoom(a.kind(), a.actor(actor)) {
			return ErrForbidden
		}
		if _, err := q.AddRoomMember(ctx, store.AddRoomMemberParams{RoomID: roomID, UserID: actor, Now: s.clock.Now()}); err != nil {
			return fmt.Errorf("join room: %w", err)
		}
		room, err = getRoom(ctx, q, actor, roomID)
		return err
	})
	return room, err
}

// AddRoomMember は target を private ルームに追加する。すでにメンバーでも成功を返す（冪等）。
func (s *Service) AddRoomMember(ctx context.Context, actor, roomID, target ulid.ULID) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor, target)
		if err != nil {
			return err
		}
		if !authz.CanAddRoomMember(a.kind(), a.actor(actor)) {
			return ErrForbidden
		}
		if !a.roles[target].IsMember() {
			return ErrUserNotInWorkspace
		}
		if _, err := q.AddRoomMember(ctx, store.AddRoomMemberParams{RoomID: roomID, UserID: target, Now: s.clock.Now()}); err != nil {
			return fmt.Errorf("add room member: %w", err)
		}
		return nil
	})
}

// RemoveRoomMember は target をルームから外す。target が actor 自身なら退出として扱う。
func (s *Service) RemoveRoomMember(ctx context.Context, actor, roomID, target ulid.ULID) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
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
			if !authz.CanLeaveRoom(a.kind(), a.actor(actor)) {
				return ErrForbidden
			}
		} else if !authz.CanRemoveRoomMember(a.kind(), a.actor(actor), a.roles[target]) {
			return ErrForbidden
		}
		if _, err := q.DeleteRoomMember(ctx, store.DeleteRoomMemberParams{RoomID: roomID, UserID: target}); err != nil {
			return fmt.Errorf("delete room member: %w", err)
		}
		return nil
	})
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
	for i, r := range rows {
		members[i] = RoomMember{
			User:     UserProfile{ID: r.UserID, Handle: r.Handle, DisplayName: r.DisplayName},
			Role:     Role(r.Role),
			JoinedAt: r.JoinedAt,
		}
	}
	return newPage(members, limit, func(m RoomMember) ulid.ULID { return m.User.ID }), nil
}

// isUniqueViolation は err が constraint の UNIQUE 違反かを返す。
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
