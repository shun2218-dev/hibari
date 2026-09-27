package chat

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// MaxHuddleLinks は 1 回で解決できるハドルのリンクの数（メッセージのリンクと同じ。ADR 0067 決定 2）。
const MaxHuddleLinks = MaxMessageLinks

// HuddleLinkResult は、本文に貼られたハドルのリンク 1 件を、見る人の権限で解決した結果（ADR 0067 決定 2）。
//
// ハドルのリンクはルームを指す（決定 1）。Status はメッセージのリンクと同じ ok / unavailable の 2 つで、
// ルームがない・読めないを区別しない（リンクを貼るだけでルームの実在を当てられないようにする。ADR 0040 と同じ）。
// Status が ok のときだけ、あとのフィールドが入る。
type HuddleLinkResult struct {
	RoomID    ulid.ULID
	Status    MessageLinkStatus
	Workspace *LinkedWorkspace
	Room      *LinkedRoom
	// Huddle は進行中のハドル（いま入っている人つき）。なければ nil。
	Huddle *RoomHuddle
	// CanJoin はそのルームのハドルに入れるか（authz.CanJoinHuddle）。入れない人にはボタンを出さない。
	CanJoin bool
}

// ResolveHuddleLinks は、本文に貼られたハドルのリンクの中身を、actor の権限でまとめて取る（ADR 0067 決定 2）。
//
// 結果は roomIDs と同じ順序・同じ件数で返す。読めないルームだけを unavailable にし、ほかのリンクの取得を失敗させない。
// 認可はルームの単位なので、別のワークスペースのルームでも actor が読めるなら ok になる（メッセージのリンクと同じ）。
func (s *Service) ResolveHuddleLinks(ctx context.Context, actor ulid.ULID, roomIDs []ulid.ULID) ([]HuddleLinkResult, error) {
	var fields fieldErrors
	if len(roomIDs) > MaxHuddleLinks {
		fields.add("room_ids", ReasonTooLong)
	}
	if err := fields.err(); err != nil {
		return nil, err
	}
	results := make([]HuddleLinkResult, len(roomIDs))
	for i, id := range roomIDs {
		results[i] = HuddleLinkResult{RoomID: id, Status: MessageLinkUnavailable}
	}
	if len(roomIDs) == 0 {
		return results, nil
	}

	// 同じルームへのリンクが複数あっても、ルームの認可は 1 回だけ引く（N+1 にしない）。
	byRoom := map[ulid.ULID][]int{}
	for i, id := range roomIDs {
		byRoom[id] = append(byRoom[id], i)
	}
	q := store.New(s.db)
	var (
		rooms        []Room
		dmKeys       []*string
		canJoin      []bool
		workspaceIDs []ulid.ULID
	)
	for _, roomID := range slices.SortedFunc(maps.Keys(byRoom), ulid.ULID.Compare) {
		// loadRoomAccess は、読めないルームにも存在しないルームにも ErrNotFound を返す（存在を明かさない）。
		a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue // unavailable のまま
			}
			return nil, err
		}
		name := ""
		if a.room.Name != nil {
			name = *a.room.Name
		}
		rooms = append(rooms, Room{ID: roomID, WorkspaceID: a.room.WorkspaceID, Kind: a.kind(), Name: name})
		dmKeys = append(dmKeys, a.room.DmKey)
		// 入れるかの判断は authz だけがする（ルール 9。ADR 0066 決定 7）
		canJoin = append(canJoin, authz.CanJoinHuddle(a.authzRoom(), a.actor(actor)))
		workspaceIDs = append(workspaceIDs, a.room.WorkspaceID)
	}
	if len(rooms) == 0 {
		return results, nil
	}
	// dm にはルーム名がないので、相手のプロフィールをまとめて引く（N+1 にしない）。
	if err := attachDMPeers(ctx, q, actor, rooms, dmKeys); err != nil {
		return nil, err
	}
	// 進行中のハドルといま入っている人を、ルームの一覧と同じ方法でまとめて読む（決定 13。Postgres と Redis を 1 回ずつ）
	s.attachHuddles(ctx, rooms)
	names, err := q.GetWorkspaceNames(ctx, slices.Compact(slices.SortedFunc(slices.Values(workspaceIDs), ulid.ULID.Compare)))
	if err != nil {
		return nil, fmt.Errorf("get workspace names: %w", err)
	}
	workspaceNames := make(map[ulid.ULID]string, len(names))
	for _, n := range names {
		workspaceNames[n.ID] = n.Name
	}

	for i, r := range rooms {
		for _, at := range byRoom[r.ID] {
			results[at] = HuddleLinkResult{
				RoomID:    r.ID,
				Status:    MessageLinkOK,
				Workspace: &LinkedWorkspace{ID: r.WorkspaceID, Name: workspaceNames[r.WorkspaceID]},
				Room:      &LinkedRoom{ID: r.ID, Kind: r.Kind, Name: r.Name, DMPeer: r.DMPeer},
				Huddle:    r.Huddle,
				CanJoin:   canJoin[i],
			}
		}
	}
	return results, nil
}
