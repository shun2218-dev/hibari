package chat

import (
	"github.com/oklog/ulid/v2"
)

// システムメッセージの種類と中身（ADR 0033）。書き込みは system_message.go、文言はクライアントが作る。

// SystemEventType はシステムメッセージの種類（ADR 0033）。文言はクライアントが作る。
type SystemEventType string

const (
	SystemRoomCreated   SystemEventType = "room_created"
	SystemMemberJoined  SystemEventType = "member_joined"
	SystemMemberLeft    SystemEventType = "member_left"
	SystemMemberRemoved SystemEventType = "member_removed"
	SystemRoomRenamed   SystemEventType = "room_renamed"
	// SystemMessagePinned はメッセージをピン留めした（ADR 0054 決定 3）。主語はピン留めした人。
	// **いまは書かない**（Slack の実物にログがなかったので改めた。決定 3 の追記）。
	// 改める前に書かれた行を読めるように、種類と DB の CHECK だけを残している。
	SystemMessagePinned SystemEventType = "message_pinned"
	// SystemRoomArchived / SystemRoomUnarchived はアーカイブした・戻した（ADR 0059 決定 4）。主語はアーカイブ・復元した人。
	SystemRoomArchived   SystemEventType = "room_archived"
	SystemRoomUnarchived SystemEventType = "room_unarchived"
)

// SystemEvent はシステムメッセージの中身。主語は Message.Sender（ADR 0033）。
type SystemEvent struct {
	Type SystemEventType
	// OldName と NewName は room_renamed だけで入る。
	OldName string `json:"old_name,omitzero"`
	NewName string `json:"new_name,omitzero"`
	// MessageID は message_pinned だけで入る。ピン留めした対象（ADR 0054 決定 3）。
	MessageID *ulid.ULID `json:"message_id,omitzero"`
}
