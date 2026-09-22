package chat

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// チャンネルのアーカイブ・復元・削除（ADR 0059）。削除はストレージのオブジェクトの掃除だけを列に残す。

// storageDeletionDelay は、ルームの削除から添付のオブジェクトを消すまでの猶予（ADR 0059 決定 6）。
// 削除の直前に発行された PUT URL で、削除の後にオブジェクトが置かれることがあるので、URL の有効期間が切れるまで待つ。
const storageDeletionDelay = uploadURLTTL

// ArchiveRoom はルームをアーカイブする（ADR 0059）。読めるが、投稿やリアクションなどはできなくなる。
// できるのはルームのメンバー（admin 以上は読めれば参加していなくても）。DM と is_default のルームは対象外。
func (s *Service) ArchiveRoom(ctx context.Context, actor, roomID ulid.ULID) (Room, error) {
	return s.setRoomArchived(ctx, actor, roomID, true)
}

// UnarchiveRoom はアーカイブを戻す。メンバーはアーカイブの前のまま残っている。できる人はアーカイブと同じ。
func (s *Service) UnarchiveRoom(ctx context.Context, actor, roomID ulid.ULID) (Room, error) {
	return s.setRoomArchived(ctx, actor, roomID, false)
}

func (s *Service) setRoomArchived(ctx context.Context, actor, roomID ulid.ULID, archive bool) (Room, error) {
	var (
		room   Room
		logged Event
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor)
		if err != nil {
			return err
		}
		r := a.authzRoom()
		if r.Kind == authz.RoomDM || r.IsDefault {
			return ErrRoomProtected
		}
		switch {
		case archive && r.Archived:
			return ErrRoomArchived
		case !archive && !r.Archived:
			return ErrRoomNotArchived
		}
		allowed := authz.CanUnarchiveRoom
		if archive {
			allowed = authz.CanArchiveRoom
		}
		if !allowed(r, a.actor(actor)) {
			return ErrForbidden
		}
		// ログはアーカイブの前に書く（アーカイブした後も書けるが、「アーカイブ中の最後の行」がアーカイブのログになるように順序をそろえる）。
		// システムメッセージの採番はアーカイブ中も止めないので、復元のログはどちらの順でも書ける（決定 4）。
		systemType := SystemRoomUnarchived
		if archive {
			systemType = SystemRoomArchived
		}
		if logged, err = s.writeSystemMessage(ctx, q, roomID, actor, SystemEvent{Type: systemType}); err != nil {
			return err
		}
		// 状態の確認と更新のあいだに別のリクエストが先に変えたら、行が返らない。そのときは先を越された側の 409 にする。
		if archive {
			_, err = q.ArchiveRoom(ctx, store.ArchiveRoomParams{ID: roomID, Now: s.clock.Now()})
		} else {
			_, err = q.UnarchiveRoom(ctx, roomID)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			if archive {
				return ErrRoomArchived
			}
			return ErrRoomNotArchived
		}
		if err != nil {
			return fmt.Errorf("set room archived: %w", err)
		}
		room, err = getRoom(ctx, q, actor, roomID, s.clock.Now())
		return err
	})
	if err != nil {
		return Room{}, err
	}
	// 読めることは変わらないので、購読は外さない（決定 5）。
	s.deliver(ctx, Event{Type: EventRoomUpdated, To: roomUpdatedAudience(room), Data: roomUpdated(room)}, logged)
	return room, nil
}

// DeleteRoom はルームを行ごと削除する（ADR 0059 決定 6）。元に戻せない。
// できるのは読める admin 以上。DM と is_default のルームは対象外。アーカイブ中でも削除できる。
// 添付のオブジェクトは、キーを storage_deletions に写しておき、掃除ジョブが猶予の後に消す。
func (s *Service) DeleteRoom(ctx context.Context, actor, roomID ulid.ULID) error {
	var (
		workspaceID ulid.ULID
		kind        RoomKind
		members     []ulid.ULID
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor)
		if err != nil {
			return err
		}
		r := a.authzRoom()
		if r.Kind == authz.RoomDM || r.IsDefault {
			return ErrRoomProtected
		}
		if !authz.CanDeleteRoom(r, a.actor(actor)) {
			return ErrForbidden
		}
		// 行ロックで、添付の INSERT（外部キーの KEY SHARE）と送信の採番を止める。写すキーと消す行のあいだに添付が増えないようにする。
		if _, err := q.LockRoomForDelete(ctx, roomID); err != nil {
			return fmt.Errorf("lock room: %w", err)
		}
		if members, err = q.ListRoomMemberIDs(ctx, roomID); err != nil {
			return fmt.Errorf("list room members: %w", err)
		}
		now := s.clock.Now()
		if err := q.EnqueueRoomStorageDeletions(ctx, store.EnqueueRoomStorageDeletionsParams{
			RoomID: roomID, NotBefore: now.Add(storageDeletionDelay), Now: now,
		}); err != nil {
			return fmt.Errorf("enqueue storage deletions: %w", err)
		}
		if err := q.DeleteRoom(ctx, roomID); err != nil {
			return fmt.Errorf("delete room: %w", err)
		}
		workspaceID, kind = a.room.WorkspaceID, r.Kind
		return nil
	})
	if err != nil {
		return err
	}
	// 宛先: ルームの購読者、public ならワークスペースの購読者、private なら削除した時点のメンバー本人（決定 7）。
	// private をワークスペース全体に配らないのは、読めない private ルームの ID を読めない人に知らせないため（ADR 0011）。
	to := Audience{Rooms: []ulid.ULID{roomID}}
	if kind == authz.RoomPublic {
		to.Workspaces = []ulid.ULID{workspaceID}
	} else {
		to.Users = members
	}
	// ルームがもうないので、届けたあとで全接続の購読を外す（CLAUDE.md ルール 8）。ユーザーごとの再検証は要らない。
	s.deliver(ctx, Event{
		Type:        EventRoomDeleted,
		To:          to,
		ClosedRooms: []ulid.ULID{roomID},
		Data:        RoomDeleted{WorkspaceID: workspaceID, RoomID: roomID},
	})
	return nil
}
