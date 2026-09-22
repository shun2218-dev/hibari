package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// DM（ADR 0011）。ワークスペースの中に閉じ、同じ 2 人の DM は dm_key で 1 つに限る。

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

// createDM は DM を作るか既存の DM を返す。joined は、この呼び出しで room_members に入った人。
func (s *Service) createDM(ctx context.Context, q *store.Queries, actor, workspaceID, peer ulid.ULID) (room Room, created bool, joined []ulid.ULID, err error) {
	ids := slices.SortedFunc(slices.Values([]ulid.ULID{actor, peer}), ulid.ULID.Compare)
	locked, err := q.ShareLockWorkspaceMembers(ctx, store.ShareLockWorkspaceMembersParams{WorkspaceID: workspaceID, UserIds: ids})
	if err != nil {
		return Room{}, false, nil, fmt.Errorf("lock members: %w", err)
	}
	roles := map[ulid.ULID]Role{}
	for _, l := range locked {
		roles[l.UserID] = Role(l.Role)
	}
	if !authz.CanCreateRoom(roles[actor]) {
		return Room{}, false, nil, ErrNotFound
	}
	if !roles[peer].IsMember() {
		// DM はワークスペース内に閉じる（ADR 0006）。
		return Room{}, false, nil, ErrUserNotInWorkspace
	}

	now := s.clock.Now()
	key := dmKey(actor, peer)
	created = true
	r, err := q.CreateDMRoom(ctx, store.CreateDMRoomParams{
		ID: s.ids.New(), WorkspaceID: workspaceID, DmKey: &key, CreatedBy: actor, Now: now,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		created = false
		r, err = q.GetDMRoom(ctx, store.GetDMRoomParams{WorkspaceID: workspaceID, DmKey: &key})
	}
	if err != nil {
		return Room{}, false, nil, fmt.Errorf("create dm: %w", err)
	}
	// 既存の DM でも 2 人を入れ直す。ワークスペースを抜けて戻ってきた人が、元の DM に戻れるようにする（ADR 0011）。
	for _, u := range ids {
		n, err := q.AddRoomMember(ctx, store.AddRoomMemberParams{RoomID: r.ID, UserID: u, Now: now})
		if err != nil {
			return Room{}, false, nil, fmt.Errorf("add dm member: %w", err)
		}
		if n > 0 {
			joined = append(joined, u)
		}
	}
	// 既存の DM ならメッセージがありうるので、既読位置と最終メッセージも読む。
	room, err = roomSummary(ctx, q, actor, r.ID, s.clock.Now())
	if err != nil {
		return Room{}, false, nil, err
	}
	room.MemberCount = 2
	p, err := userProfile(ctx, q, peer)
	if err != nil {
		return Room{}, false, nil, fmt.Errorf("get dm peer: %w", err)
	}
	room.DMPeer = &p
	return room, created, joined, nil
}

// attachDMPeers は dm のルームに相手のプロフィールを付ける。dmKeys[i] は rooms[i] の dm_key（dm 以外は nil）。
// プロフィールは 1 回のクエリでまとめて引く（N+1 にしない）。presence は attachDMPeerPresence で、トランザクションの外で付ける。
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

// attachDMPeerPresence は dm の相手の presence を 1 回の MGET で付ける（ADR 0015）。
// Redis への I/O なので、行ロックを持つトランザクションの中では呼ばない（ADR 0002）。
func (s *Service) attachDMPeerPresence(ctx context.Context, rooms []Room) {
	var ids []ulid.ULID
	for _, r := range rooms {
		if r.DMPeer != nil {
			ids = append(ids, r.DMPeer.ID)
		}
	}
	if len(ids) == 0 {
		return
	}
	online := s.online(ctx, ids)
	for i := range rooms {
		if p := rooms[i].DMPeer; p != nil {
			rooms[i].DMPeerPresence = presenceOf(online[p.ID])
		}
	}
}

// online は userIDs のうちオンラインのユーザーを返す。
// presence は表示の補助なので、Redis に届かなければ全員をオフラインとして扱い、一覧そのものは失敗させない（ADR 0015）。
func (s *Service) online(ctx context.Context, userIDs []ulid.ULID) map[ulid.ULID]Presence {
	states, err := s.presence.Presence(ctx, userIDs)
	if err != nil {
		s.logger.WarnContext(ctx, "read presence failed", slog.Any("error", err))
		return map[ulid.ULID]Presence{}
	}
	return states
}
