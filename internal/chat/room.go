package chat

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
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
	// ErrRoomArchived は、権限はあるがルームがアーカイブ中なのでできないことを表す（ADR 0059 決定 2）。
	// すでにアーカイブ済みのルームをアーカイブしようとしたときにも返す。
	ErrRoomArchived = errors.New("chat: room is archived")
	// ErrRoomNotArchived は、アーカイブされていないルームを復元しようとしたことを表す。
	ErrRoomNotArchived = errors.New("chat: room is not archived")
	// ErrRoomProtected は、アーカイブ・削除の対象外のルーム（DM と is_default のルーム）であることを表す（ADR 0059 決定 1）。
	ErrRoomProtected = errors.New("chat: room cannot be archived or deleted")
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
	DMPeer *UserProfile
	// DMPeerPresence は dm の相手の自動の presence（ADR 0015 / 0049）。dm 以外では offline。
	// 相手のカスタムステータスと手動の離席は、クライアントがワークスペースのメンバー一覧から引く（ADR 0049 決定 7 の追記）。
	DMPeerPresence Presence
	LastMessageSeq int64
	LastMessageAt  *time.Time
	// LastReadSeq は actor の既読位置。ルームのメンバーでなければ nil。
	LastReadSeq *int64
	// LastUserSeq は人の発言の総数。未読数の根拠（ADR 0033）。
	LastUserSeq int64
	// LastReadUserSeq は自分の既読位置に対応する user_seq。メンバーでなければ nil。
	LastReadUserSeq *int64
	// UnreadCount は last_user_seq - last_read_user_seq。削除済みのメッセージも数える近似（ADR 0002 / 0033）。メンバーでなければ 0。
	UnreadCount int64
	// MentionCount は未読の範囲にある自分宛てのメンションの数（ADR 0041）。未読数とは別に出す。メンバーでなければ 0。
	MentionCount int64
	// LastMessage はサイドバーに出す最終メッセージ。メッセージがなければ nil。
	LastMessage *MessagePreview
	// Notifications は actor のチャンネルごとの通知の設定（ADR 0055 決定 4）。ルームのメンバーでなければ nil。
	Notifications *RoomNotifications
	// ArchivedAt はアーカイブした時刻（ADR 0059）。アーカイブされていなければ nil。
	ArchivedAt *time.Time
	// Huddle は進行中のハドル（ADR 0066 決定 13）。なければ nil。いま入っている人は Redis から読む。
	Huddle    *RoomHuddle
	CreatedAt time.Time
}

// MessagePreview はサイドバーに出す最終メッセージ。
type MessagePreview struct {
	ID     ulid.ULID
	Sender UserProfile
	// Kind は user（人の発言）か system（ログ。ADR 0033）。
	Kind MessageKind
	// System は Kind が system のときだけ入る。
	System *SystemEvent
	// Body は削除済みなら空。システムメッセージでは常に空。
	Body      string
	CreatedAt time.Time
	Deleted   bool
}

// toRoom はルームの行と、actor の既読位置・最終メッセージを JOIN した行から Room を作る。
// GetRoomSummary の行は、同じ列の store.ListRoomsForUserRow に変換してから渡す。
// now は期限の来たミュートを落とすのに使う（ADR 0055 決定 3）。
func toRoom(r store.ListRoomsForUserRow, now time.Time) Room {
	room := Room{
		ID:              r.Room.ID,
		WorkspaceID:     r.Room.WorkspaceID,
		Kind:            RoomKind(r.Room.Kind),
		IsDefault:       r.Room.IsDefault,
		IsMember:        r.IsMember,
		LastMessageSeq:  r.Room.LastMessageSeq,
		LastMessageAt:   r.Room.LastMessageAt,
		LastReadSeq:     r.LastReadSeq,
		LastUserSeq:     r.Room.LastUserSeq,
		LastReadUserSeq: r.LastReadUserSeq,
		MentionCount:    r.MentionCount,
		ArchivedAt:      r.Room.ArchivedAt,
		CreatedAt:       r.Room.CreatedAt,
	}
	// 参加していない public ルームは room_members の行がなく、muted も NULL になる。設定を持てないので nil にする。
	if r.IsMember && r.Muted != nil {
		room.Notifications = roomNotificationsOf(r.NotifyLevel, *r.Muted, r.MutedUntil, now)
	}
	if r.Room.Name != nil {
		room.Name = *r.Room.Name
	}
	if r.LastReadSeq != nil && r.LastReadUserSeq != nil {
		// システムメッセージは数えない。人の発言だけを数えた番号の差を取る（ADR 0033）。
		room.UnreadCount = r.Room.LastUserSeq - *r.LastReadUserSeq
	}
	if r.LastMessageID != nil {
		preview := &MessagePreview{
			ID:        *r.LastMessageID,
			Sender:    UserProfile{ID: *r.LastMessageSenderID, Handle: *r.LastMessageSenderHandle, DisplayName: *r.LastMessageSenderDisplayName},
			Kind:      MessageKind(*r.LastMessageKind),
			Body:      *r.LastMessageBody,
			CreatedAt: *r.LastMessageCreatedAt,
			Deleted:   r.LastMessageDeletedAt != nil,
		}
		// サイドバーの 1 行にもログの文言を出せるよう、種類を渡す（文言はクライアントが作る。ADR 0033）。
		if preview.Kind == MessageKindSystem && r.LastMessageSystemType != nil {
			preview.System = &SystemEvent{Type: SystemEventType(*r.LastMessageSystemType)}
			if len(r.LastMessageSystemData) > 0 {
				if err := json.Unmarshal(r.LastMessageSystemData, preview.System); err != nil {
					preview.System = &SystemEvent{Type: SystemEventType(*r.LastMessageSystemType)}
				}
			}
		}
		room.LastMessage = preview
	}
	return room
}

// roomSummary は actor から見たルームを 1 件読む（既読位置と最終メッセージを含む）。読めるかどうかの判定は呼び出し側で済ませる。
func roomSummary(ctx context.Context, q *store.Queries, actor, roomID ulid.ULID, now time.Time) (Room, error) {
	row, err := q.GetRoomSummary(ctx, store.GetRoomSummaryParams{UserID: actor, RoomID: roomID})
	if err != nil {
		return Room{}, fmt.Errorf("get room summary: %w", err)
	}
	return toRoom(store.ListRoomsForUserRow(row), now), nil
}

// RoomMember はルームのメンバー。
type RoomMember struct {
	User UserProfile
	// Role はワークスペースでのロール（ルーム単位のロールは持たない。ADR 0006）。
	Role     Role
	JoinedAt time.Time
	// Presence は自動で決まる状態の初期値（ADR 0015 / 0049）。変化は WebSocket の presence.changed で届く。
	Presence Presence
	// Away は本人が手動で離席にしているか、Status はカスタムステータス（ADR 0049）。
	Away   bool
	Status *UserStatus
}

// userProfile は 1 人の公開プロフィールを読む。
func userProfile(ctx context.Context, q *store.Queries, userID ulid.ULID) (UserProfile, error) {
	profiles, err := q.ListUserProfiles(ctx, []ulid.ULID{userID})
	if err != nil {
		return UserProfile{}, fmt.Errorf("get user profile: %w", err)
	}
	if len(profiles) != 1 {
		return UserProfile{}, fmt.Errorf("get user profile %s: not found", userID)
	}
	p := profiles[0]
	return UserProfile{ID: p.ID, Handle: p.Handle, DisplayName: p.DisplayName}, nil
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

	var events []Event
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		joined := []ulid.ULID{actor}
		if kind == authz.RoomDM {
			room, created, joined, err = s.createDM(ctx, q, actor, workspaceID, in.UserID)
		} else {
			room, err = s.createNamedRoom(ctx, q, actor, workspaceID, kind, in.Name)
			created = err == nil
		}
		if err != nil {
			return err
		}
		// 作成者や DM の相手はまだこのルームを購読していないので、本人にも届く member.joined でサイドバーに出させる（ADR 0015）。
		events, err = newRoomMembers(ctx, q, workspaceID, room.ID, joined)
		return err
	})
	if err != nil {
		return Room{}, false, err
	}
	if room.DMPeer != nil {
		// presence（Redis）はコミットの後に読む。行ロックを持ったまま外部への I/O を挟まない（ADR 0002）。
		room.DMPeerPresence = presenceOf(s.online(ctx, []ulid.ULID{room.DMPeer.ID})[room.DMPeer.ID])
	}
	s.deliver(ctx, events...)
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
	// 「作成しました」を 1 行目に残す（ADR 0033）。作成者の member_joined は出さない（作成の行で分かる）。
	// 返ってくる message.created は配信しない。この時点ではこのルームを購読している人がまだ誰もおらず
	// （作成者も、作成の応答を受け取ってから購読する）、届く先がないため。
	if _, err := s.writeSystemMessage(ctx, q, r.ID, actor, SystemEvent{Type: SystemRoomCreated}); err != nil {
		return Room{}, err
	}
	room, err := roomSummary(ctx, q, actor, r.ID, s.clock.Now())
	if err != nil {
		return Room{}, err
	}
	room.MemberCount = 1
	return room, nil
}

// newRoomMembers は、作成でルームに入った人（joined）の member.joined を作る。
func newRoomMembers(ctx context.Context, q *store.Queries, workspaceID, roomID ulid.ULID, joined []ulid.ULID) ([]Event, error) {
	if len(joined) == 0 {
		return nil, nil
	}
	profiles, err := q.ListUserProfiles(ctx, joined)
	if err != nil {
		return nil, fmt.Errorf("list joined users: %w", err)
	}
	byID := make(map[ulid.ULID]UserProfile, len(profiles))
	for _, p := range profiles {
		byID[p.ID] = UserProfile{ID: p.ID, Handle: p.Handle, DisplayName: p.DisplayName}
	}
	events := make([]Event, 0, len(joined))
	for _, id := range joined {
		if p, ok := byID[id]; ok {
			events = append(events, memberJoinedEvent(workspaceID, roomID, p))
		}
	}
	return events, nil
}

// ListRooms は actor のサイドバーに出すルームを返す。参加しているルームと、参加していない public ルーム。
func (s *Service) ListRooms(ctx context.Context, actor, workspaceID ulid.ULID) ([]Room, error) {
	q := store.New(s.db)
	if _, err := q.GetWorkspaceRole(ctx, store.GetWorkspaceRoleParams{WorkspaceID: workspaceID, UserID: actor}); err != nil {
		return nil, notFoundIfNoRows(err, "get role")
	}
	rows, err := q.ListRoomsForUser(ctx, store.ListRoomsForUserParams{WorkspaceID: workspaceID, UserID: actor})
	now := s.clock.Now()
	if err != nil {
		return nil, fmt.Errorf("list rooms: %w", err)
	}
	rooms := make([]Room, len(rows))
	dmKeys := make([]*string, len(rows))
	for i, r := range rows {
		rooms[i] = toRoom(r, now)
		dmKeys[i] = r.Room.DmKey
	}
	if err := attachDMPeers(ctx, q, actor, rooms, dmKeys); err != nil {
		return nil, err
	}
	s.attachDMPeerPresence(ctx, rooms)
	s.attachHuddles(ctx, rooms)
	return rooms, nil
}

// GetRoom はルームを返す。読めなければ ErrNotFound。
func (s *Service) GetRoom(ctx context.Context, actor, roomID ulid.ULID) (Room, error) {
	room, err := getRoom(ctx, store.New(s.db), actor, roomID, s.clock.Now())
	if err != nil {
		return Room{}, err
	}
	rooms := []Room{room}
	s.attachDMPeerPresence(ctx, rooms)
	s.attachHuddles(ctx, rooms)
	return rooms[0], nil
}

// getRoom はロックせずにルームを読む。書き込みの後で結果を返すときは、同じトランザクションの q を渡す。
// dm の相手の presence は付けない（トランザクションの中で Redis を読まないため）。必要なら呼び出し側がコミットの後に付ける。
func getRoom(ctx context.Context, q *store.Queries, actor, roomID ulid.ULID, now time.Time) (Room, error) {
	a, err := loadRoomAccess(ctx, q, noLock, roomID, actor)
	if err != nil {
		return Room{}, err
	}
	room, err := roomSummary(ctx, q, actor, roomID, now)
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

	var (
		room         Room
		updated      bool
		systemEvents []Event
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		a, err := loadRoomAccess(ctx, q, shareLock, roomID, actor)
		if err != nil {
			return err
		}
		if err := a.authorize(func(r authz.Room) bool { return authz.CanUpdateRoom(r, a.actor(actor)) }); err != nil {
			return err
		}
		if params.Name != nil || params.IsDefault != nil {
			previousName := a.room.Name
			if _, err := q.UpdateRoom(ctx, params); err != nil {
				if isUniqueViolation(err, "rooms_workspace_id_name_idx") {
					return ErrRoomNameTaken
				}
				return fmt.Errorf("update room: %w", err)
			}
			updated = true
			// 名前が実際に変わったときだけログに残す（同じ名前での保存や is_default だけの変更では出さない。ADR 0033）。
			if params.Name != nil && previousName != nil && *params.Name != *previousName {
				renamed, err := s.writeSystemMessage(ctx, q, roomID, actor, SystemEvent{
					Type: SystemRoomRenamed, OldName: *previousName, NewName: *params.Name,
				})
				if err != nil {
					return err
				}
				systemEvents = append(systemEvents, renamed)
			}
		}
		room, err = getRoom(ctx, q, actor, roomID, s.clock.Now())
		return err
	})
	if err != nil {
		return Room{}, err
	}
	if updated {
		s.deliver(ctx, append([]Event{{
			Type: EventRoomUpdated,
			To:   roomUpdatedAudience(room),
			Data: roomUpdated(room),
		}}, systemEvents...)...)
	}
	return room, nil
}

// roomUpdated は room.updated のデータ。名前・既定・アーカイブのどれが変わっても、いまの値を全部入れる。
func roomUpdated(room Room) RoomUpdated {
	return RoomUpdated{WorkspaceID: room.WorkspaceID, RoomID: room.ID, Name: room.Name, IsDefault: room.IsDefault, ArchivedAt: room.ArchivedAt}
}

// roomUpdatedAudience は room.updated の宛先。public ルームは参加していないメンバーのサイドバーにも出るので、ワークスペースの購読者にも届ける。
func roomUpdatedAudience(room Room) Audience {
	to := Audience{Rooms: []ulid.ULID{room.ID}}
	if room.Kind == authz.RoomPublic {
		to.Workspaces = []ulid.ULID{room.WorkspaceID}
	}
	return to
}

// isUniqueViolation は err が constraint の UNIQUE 違反かを返す。
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
