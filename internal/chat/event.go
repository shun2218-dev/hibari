package chat

import (
	"context"

	"github.com/oklog/ulid/v2"
)

// Delivery はコミット済みの変更を、宛先を解決してから届ける（CLAUDE.md ルール 6、ADR 0015）。
//
// ユースケースは「何が起きて、誰に関係するか」を Event として渡すだけで、WebSocket も接続も知らない。
// 宛先を接続に解決するのは実装（Phase 4 はインメモリの Hub、Phase 5 は Redis、Phase 7 以降は Push）。
//
// Deliver はエラーを返さない。コミット済みの変更を配信の失敗で取り消せないので、実装がログに残し、
// クライアントは change_seq の欠番と REST の差分取得で回復する（ADR 0004 / 0014）。
type Delivery interface {
	Deliver(ctx context.Context, ev Event)
}

// NopDelivery は何も配信しない Delivery。配信を確かめないテストで使う。
type NopDelivery struct{}

// Deliver は何もしない。
func (NopDelivery) Deliver(context.Context, Event) {}

// EventType はイベントの種類。値は docs/events.md の type と同じ。
type EventType string

const (
	EventMessageCreated         EventType = "message.created"
	EventMessageUpdated         EventType = "message.updated"
	EventMessageDeleted         EventType = "message.deleted"
	EventMemberJoined           EventType = "member.joined"
	EventMemberLeft             EventType = "member.left"
	EventRoomUpdated            EventType = "room.updated"
	EventRoomMemberRemoved      EventType = "room.member_removed"
	EventRoomRead               EventType = "room.read"
	EventWorkspaceUpdated       EventType = "workspace.updated"
	EventWorkspaceMemberRemoved EventType = "workspace.member_removed"
	EventWorkspaceRoleChanged   EventType = "workspace.role_changed"
	EventPresenceChanged        EventType = "presence.changed"
	EventTypingStarted          EventType = "typing.started"
)

// Audience はイベントの宛先。複数の経路で同じ接続に当たっても、実装は 1 回だけ届ける。
type Audience struct {
	// Rooms はそのルームを購読している接続。
	Rooms []ulid.ULID
	// Workspaces はそのワークスペースを購読している接続。
	Workspaces []ulid.ULID
	// Users はそのユーザーのすべての接続（購読の有無を問わない）。本人宛てのイベントに使う。
	Users []ulid.ULID
	// ExceptUser はこのユーザーの接続には届けない（typing.started を入力した本人に返さないため）。
	ExceptUser ulid.ULID
}

// AccessChange は、権限が変わったのでイベントを届ける前に購読を再検証すべきユーザーとワークスペース（CLAUDE.md ルール 8）。
// 実装は「どの購読を外すか」をイベントの中身から計算せず、DB を読み直して authz に聞く（ADR 0015）。
type AccessChange struct {
	UserID      ulid.ULID
	WorkspaceID ulid.ULID
}

// Event は配信するイベント。Data の型は Type で決まる（下の型の一覧）。
type Event struct {
	Type          EventType
	To            Audience
	AccessChanges []AccessChange
	Data          any
}

// イベントのデータ。JSON の形は WebSocket の層（httpx）が docs/events.md に合わせて決める。
//
//	message.created / updated / deleted → Message
//	member.joined                       → MemberJoined
//	member.left                         → MemberLeft
//	room.updated                        → RoomUpdated
//	room.member_removed                 → RoomMemberRemoved
//	room.read                           → RoomRead
//	workspace.updated                   → WorkspaceUpdated
//	workspace.member_removed            → WorkspaceMemberRemoved
//	workspace.role_changed              → WorkspaceRoleChanged
//	presence.changed                    → PresenceChanged
//	typing.started                      → TypingStarted

// RemovalReason はメンバーから外れた理由。
type RemovalReason string

const (
	// RemovalLeft は自分で抜けた。
	RemovalLeft RemovalReason = "left"
	// RemovalRemoved は他人に外された、またはサーバーの再検証で読めなくなった。
	RemovalRemoved RemovalReason = "removed"
)

type MemberJoined struct {
	WorkspaceID ulid.ULID
	RoomID      ulid.ULID
	User        UserProfile
}

type MemberLeft struct {
	WorkspaceID ulid.ULID
	RoomID      ulid.ULID
	UserID      ulid.ULID
}

type RoomUpdated struct {
	WorkspaceID ulid.ULID
	RoomID      ulid.ULID
	Name        string
	IsDefault   bool
}

type RoomMemberRemoved struct {
	WorkspaceID ulid.ULID
	RoomID      ulid.ULID
	Reason      RemovalReason
}

type RoomRead struct {
	WorkspaceID ulid.ULID
	RoomID      ulid.ULID
	LastReadSeq int64
	// LastReadUserSeq は既読位置に対応する user_seq（ADR 0033）。
	LastReadUserSeq int64
	UnreadCount     int64
}

type WorkspaceUpdated struct {
	WorkspaceID  ulid.ULID
	Name         string
	InvitePolicy InvitePolicy
}

type WorkspaceMemberRemoved struct {
	WorkspaceID ulid.ULID
	UserID      ulid.ULID
	Reason      RemovalReason
}

type WorkspaceRoleChanged struct {
	WorkspaceID ulid.ULID
	UserID      ulid.ULID
	Role        Role
}

type PresenceChanged struct {
	UserID ulid.ULID
	Online bool
}

type TypingStarted struct {
	WorkspaceID ulid.ULID
	RoomID      ulid.ULID
	User        UserProfile
}

// deliver はコミットの後にイベントを渡す。リクエストの ctx がレスポンスの直後にキャンセルされても配信は続ける。
func (s *Service) deliver(ctx context.Context, events ...Event) {
	ctx = context.WithoutCancel(ctx)
	for _, ev := range events {
		s.delivery.Deliver(ctx, ev)
	}
}

func messageEvent(typ EventType, m Message) Event {
	return Event{Type: typ, To: Audience{Rooms: []ulid.ULID{m.RoomID}}, Data: m}
}

// memberJoinedEvent は、ルームの購読者と参加した本人に届ける（本人はまだそのルームを購読していないため。ADR 0015）。
func memberJoinedEvent(workspaceID, roomID ulid.ULID, user UserProfile) Event {
	return Event{
		Type: EventMemberJoined,
		To:   Audience{Rooms: []ulid.ULID{roomID}, Users: []ulid.ULID{user.ID}},
		Data: MemberJoined{WorkspaceID: workspaceID, RoomID: roomID, User: user},
	}
}
