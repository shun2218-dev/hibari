package chat

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// メッセージへのパーマリンクのカード（ロードマップ Phase 6.11a / ADR 0040）。
//
// 本文に貼られたリンクの中身は本文には保存せず、表示するたびに「見る人の権限で」取り直す。
// 貼った人は読めても見る人は読めない private ルームがあるため、保存すると権限を越えて見えてしまう。

// MaxMessageLinks は 1 回で解決できるリンクの数。画面に出るカードの枚数の上限（ADR 0040）。
const MaxMessageLinks = 20

// MessageLinkStatus はリンクを解決した結果。
//
// 値が ok と unavailable の 2 つしかないのは意図したもの。ルームが存在しない・メッセージが存在しない・
// 読む権限がない・システムメッセージを指している、のどれであっても unavailable にする。
// 区別すると、リンクを貼るだけで「その ID のメッセージが実在するか」を当てられる。
type MessageLinkStatus string

const (
	MessageLinkOK          MessageLinkStatus = "ok"
	MessageLinkUnavailable MessageLinkStatus = "unavailable"
)

// MessageLink は本文に貼られたパーマリンクが指す 1 件のメッセージ。
type MessageLink struct {
	RoomID    ulid.ULID
	MessageID ulid.ULID
}

// LinkedWorkspace はカードに出すワークスペース。今いるワークスペースと違うときだけ、クライアントが名前を出す。
type LinkedWorkspace struct {
	ID   ulid.ULID
	Name string
}

// LinkedRoom はカードに出すルーム。
type LinkedRoom struct {
	ID   ulid.ULID
	Kind RoomKind
	// Name は dm では空。
	Name string
	// DMPeer は dm の相手。dm 以外では nil。dm にはルーム名がないので、カードは相手の名前を出す。
	DMPeer *UserProfile
}

// LinkedMessage はカードに出すメッセージ。
//
// タイムラインの Message とは別の、意図的に小さい形にしている（ADR 0040）。
// change_seq / user_seq / client_msg_id / スレッドの要約を持たないので、
// カードのデータをタイムラインの行として使い回せない。「カードは追従しない」という約束が型で守られる。
type LinkedMessage struct {
	ID  ulid.ULID
	Seq int64
	// Sender は削除済みでも入る（タイムラインの tombstone と同じ。ADR 0012 / 0038）。
	Sender UserProfile
	// Body は削除済みなら空。
	Body string
	// ThreadRootID はスレッドの返信なら親の ID。カードから開くパネルを決めるのに使う。
	ThreadRootID *ulid.ULID
	// AttachmentCount は添付の件数。カードには画像を出さない（1 件ごとに署名付き URL を発行することになるため。ADR 0040）。
	AttachmentCount int
	CreatedAt       time.Time
	EditedAt        *time.Time
	// DeletedAt が入っていたら削除済み。カードとしてどう見せるかはクライアントが決める（ADR 0038）。
	DeletedAt *time.Time
}

// MessageLinkResult は 1 件のリンクの解決結果。Status が ok のときだけ、あとのフィールドが入る。
type MessageLinkResult struct {
	Link      MessageLink
	Status    MessageLinkStatus
	Workspace *LinkedWorkspace
	Room      *LinkedRoom
	Message   *LinkedMessage
}

// ResolveMessageLinks は、本文に貼られたパーマリンクの中身を、actor の権限でまとめて取る（ADR 0040）。
//
// 結果は links と同じ順序・同じ件数で返す。読めないリンクだけを unavailable にし、
// 1 件が読めないことで他のリンクの取得を失敗させない。
//
// 認可はルームの単位なので、別のワークスペースのメッセージでも actor が読めるなら ok になる。
func (s *Service) ResolveMessageLinks(ctx context.Context, actor ulid.ULID, links []MessageLink) ([]MessageLinkResult, error) {
	var fields fieldErrors
	if len(links) > MaxMessageLinks {
		fields.add("links", ReasonTooLong)
	}
	if err := fields.err(); err != nil {
		return nil, err
	}
	results := make([]MessageLinkResult, len(links))
	for i, l := range links {
		results[i] = MessageLinkResult{Link: l, Status: MessageLinkUnavailable}
	}
	if len(links) == 0 {
		return results, nil
	}

	// 同じルームへのリンクが複数あっても、ルームの認可は 1 回だけ引く（N+1 にしない）。
	byRoom := map[ulid.ULID][]int{}
	for i, l := range links {
		byRoom[l.RoomID] = append(byRoom[l.RoomID], i)
	}
	roomIDs := slices.SortedFunc(maps.Keys(byRoom), ulid.ULID.Compare)

	q := store.New(s.db)
	rooms := make([]Room, 0, len(roomIDs))
	dmKeys := make([]*string, 0, len(roomIDs))
	// roomIndex は rooms の添字。dm の相手をまとめて付けたあとに結果へ写すため。
	roomIndex := map[ulid.ULID]int{}
	workspaceIDs := make([]ulid.ULID, 0, len(roomIDs))

	for _, roomID := range roomIDs {
		// loadRoomAccess は、読めないルームにも存在しないルームにも ErrNotFound を返す（存在を明かさない）。
		a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue // unavailable のまま
			}
			return nil, err
		}
		roomIndex[roomID] = len(rooms)
		name := ""
		if a.room.Name != nil {
			name = *a.room.Name
		}
		rooms = append(rooms, Room{ID: roomID, WorkspaceID: a.room.WorkspaceID, Kind: a.kind(), Name: name})
		dmKeys = append(dmKeys, a.room.DmKey)
		workspaceIDs = append(workspaceIDs, a.room.WorkspaceID)

		if err := s.resolveLinksInRoom(ctx, q, roomID, links, byRoom[roomID], results); err != nil {
			return nil, err
		}
	}
	if len(rooms) == 0 {
		return results, nil
	}
	// dm にはルーム名がないので、相手のプロフィールをまとめて引く（N+1 にしない）。
	if err := attachDMPeers(ctx, q, actor, rooms, dmKeys); err != nil {
		return nil, err
	}
	names, err := q.GetWorkspaceNames(ctx, slices.Compact(slices.SortedFunc(slices.Values(workspaceIDs), ulid.ULID.Compare)))
	if err != nil {
		return nil, fmt.Errorf("get workspace names: %w", err)
	}
	workspaceNames := make(map[ulid.ULID]string, len(names))
	for _, n := range names {
		workspaceNames[n.ID] = n.Name
	}

	for i := range results {
		if results[i].Status != MessageLinkOK {
			continue
		}
		r := rooms[roomIndex[results[i].Link.RoomID]]
		results[i].Room = &LinkedRoom{ID: r.ID, Kind: r.Kind, Name: r.Name, DMPeer: r.DMPeer}
		results[i].Workspace = &LinkedWorkspace{ID: r.WorkspaceID, Name: workspaceNames[r.WorkspaceID]}
	}
	return results, nil
}

// resolveLinksInRoom は、1 つのルームに属するリンクを解決して results を埋める。ルームの認可は呼ぶ側で済ませておく。
func (s *Service) resolveLinksInRoom(ctx context.Context, q *store.Queries, roomID ulid.ULID, links []MessageLink, idx []int, results []MessageLinkResult) error {
	// 同じメッセージへのリンクが複数あっても、読むのは 1 回だけ。
	found := map[ulid.ULID]*LinkedMessage{}
	ids := make([]ulid.ULID, 0, len(idx))
	for _, i := range idx {
		id := links[i].MessageID
		if _, seen := found[id]; seen {
			continue
		}
		row, err := q.GetMessageView(ctx, store.GetMessageViewParams{RoomID: roomID, ID: id})
		if err != nil {
			if errors.Is(notFoundIfNoRows(err, "get message view"), ErrNotFound) {
				found[id] = nil // unavailable のまま
				continue
			}
			return fmt.Errorf("get message view: %w", err)
		}
		// システムメッセージ（参加や名前の変更のログ。ADR 0033）は本文を持たず、文言はクライアントが作る。
		// カードにする中身がないので、読めないリンクと同じ扱いにする。
		if MessageKind(row.Kind) == MessageKindSystem {
			found[id] = nil
			continue
		}
		found[id] = &LinkedMessage{
			ID:           row.ID,
			Seq:          row.Seq,
			Sender:       UserProfile{ID: row.SenderID, Handle: row.SenderHandle, DisplayName: row.SenderDisplayName},
			Body:         row.Body,
			ThreadRootID: row.ThreadRootID,
			CreatedAt:    row.CreatedAt,
			EditedAt:     row.EditedAt,
			DeletedAt:    row.DeletedAt,
		}
		ids = append(ids, id)
	}

	// 添付は件数だけ出す。ルームぶんを 1 文でまとめて数える（N+1 にしない）。
	if len(ids) > 0 {
		rows, err := q.ListAttachmentsForMessages(ctx, store.ListAttachmentsForMessagesParams{RoomID: roomID, MessageIds: ids})
		if err != nil {
			return fmt.Errorf("list attachments: %w", err)
		}
		for _, r := range rows {
			if m := found[*r.MessageID]; m != nil {
				m.AttachmentCount++
			}
		}
	}

	for _, i := range idx {
		m := found[links[i].MessageID]
		if m == nil {
			continue
		}
		// 同じメッセージへのリンクが 2 つあっても、それぞれが自分のコピーを持つようにする。
		copied := *m
		results[i].Status = MessageLinkOK
		results[i].Message = &copied
	}
	return nil
}
