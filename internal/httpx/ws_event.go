package httpx

import (
	"fmt"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// サーバーから送るイベントの形（docs/events.md）。ドメインのイベント（chat.Event）を、
// そのまま JSON にできる形に変える。型は internal/httpx/tsgen_test.go が TypeScript に写す。

// serverEvent はサーバーからのイベントの外側の形。
type serverEvent struct {
	Type chat.EventType `json:"type"`
	Data any            `json:"data"`
}

// イベントの data の形（docs/events.md）。ID は ULID の文字列にする。
// TypeScript の型は tsgen_test.go がここから生成する。

type memberJoinedData struct {
	WorkspaceID string              `json:"workspace_id"`
	RoomID      string              `json:"room_id"`
	User        userProfileResponse `json:"user"`
}

type memberLeftData struct {
	WorkspaceID string `json:"workspace_id"`
	RoomID      string `json:"room_id"`
	UserID      string `json:"user_id"`
}

type roomUpdatedData struct {
	WorkspaceID string `json:"workspace_id"`
	RoomID      string `json:"room_id"`
	Name        string `json:"name"`
	IsDefault   bool   `json:"is_default"`
	// ArchivedAt はアーカイブされていなければ null（ADR 0059 決定 5）。
	ArchivedAt *time.Time `json:"archived_at"`
}

// roomDeletedData はルームの削除（ADR 0059 決定 7）。届いた時点で、サーバーはそのルームの購読を外している。
type roomDeletedData struct {
	WorkspaceID string `json:"workspace_id"`
	RoomID      string `json:"room_id"`
}

type roomMemberRemovedData struct {
	WorkspaceID string             `json:"workspace_id"`
	RoomID      string             `json:"room_id"`
	Reason      chat.RemovalReason `json:"reason"`
}

type roomReadData struct {
	WorkspaceID string `json:"workspace_id"`
	RoomID      string `json:"room_id"`
	LastReadSeq int64  `json:"last_read_seq"`
	// LastReadUserSeq は既読位置に対応する user_seq（ADR 0033）。
	LastReadUserSeq int64 `json:"last_read_user_seq"`
	UnreadCount     int64 `json:"unread_count"`
	// MentionCount は既読を進めた後の、自分宛ての未読のメンションの数（ADR 0041）。別の端末のバッジも揃える。
	MentionCount int64 `json:"mention_count"`
}

type workspaceUpdatedData struct {
	WorkspaceID  string            `json:"workspace_id"`
	Name         string            `json:"name"`
	InvitePolicy chat.InvitePolicy `json:"invite_policy"`
}

type workspaceMemberRemovedData struct {
	WorkspaceID string             `json:"workspace_id"`
	UserID      string             `json:"user_id"`
	Reason      chat.RemovalReason `json:"reason"`
}

type workspaceRoleChangedData struct {
	WorkspaceID string    `json:"workspace_id"`
	UserID      string    `json:"user_id"`
	Role        chat.Role `json:"role"`
}

// presenceChangedData は自動で決まる状態だけ（ADR 0049）。手動の離席は memberStatusChangedData で届く。
type presenceChangedData struct {
	UserID   string        `json:"user_id"`
	Presence chat.Presence `json:"presence"`
}

// memberStatusChangedData は本人が選んだ設定（ADR 0049 決定 8）。
// away はユーザーごとなので所属するすべてのワークスペースに同じ値が飛び、status はワークスペースごと。
type memberStatusChangedData struct {
	WorkspaceID string              `json:"workspace_id"`
	UserID      string              `json:"user_id"`
	Away        bool                `json:"away"`
	Status      *userStatusResponse `json:"status"`
}

type typingStartedData struct {
	WorkspaceID string `json:"workspace_id"`
	RoomID      string `json:"room_id"`
	// ThreadRootID は、スレッドで入力しているときの親。チャンネルなら null（ADR 0036）。
	ThreadRootID *string             `json:"thread_root_id"`
	User         userProfileResponse `json:"user"`
}

type threadReadData struct {
	WorkspaceID       string `json:"workspace_id"`
	RoomID            string `json:"room_id"`
	ThreadRootID      string `json:"thread_root_id"`
	LastReadThreadSeq int64  `json:"last_read_thread_seq"`
	UnreadCount       int64  `json:"unread_count"`
}

type threadFollowedData struct {
	WorkspaceID       string `json:"workspace_id"`
	RoomID            string `json:"room_id"`
	ThreadRootID      string `json:"thread_root_id"`
	LastReadThreadSeq int64  `json:"last_read_thread_seq"`
}

// notificationsUpdatedData は全体の通知の設定（ADR 0055 決定 5）。本人にだけ届く。
type notificationsUpdatedData struct {
	WorkspaceID string           `json:"workspace_id"`
	Level       chat.NotifyLevel `json:"level"`
}

// roomNotificationsUpdatedData はルームごとの本人の設定。値の形は REST の roomNotificationsBody と同じ。
type roomNotificationsUpdatedData struct {
	WorkspaceID string `json:"workspace_id"`
	RoomID      string `json:"room_id"`
	roomNotificationsBody
}

// threadNotificationsUpdatedData はスレッドの返信の通知（ADR 0056）。本人にだけ届く。
type threadNotificationsUpdatedData struct {
	WorkspaceID   string `json:"workspace_id"`
	RoomID        string `json:"room_id"`
	ThreadRootID  string `json:"thread_root_id"`
	NotifyReplies bool   `json:"notify_replies"`
}

// encodeEvent はイベントを docs/events.md の JSON にする。
func encodeEvent(ev chat.Event) ([]byte, error) {
	data, err := eventData(ev.Data)
	if err != nil {
		return nil, fmt.Errorf("encode %s: %w", ev.Type, err)
	}
	return marshalJSON(serverEvent{Type: ev.Type, Data: data})
}

// eventData は chat のイベントのデータを JSON の形に変換する。
// メッセージは REST とほぼ同じ形だが、受け取る人ごとの値（リアクションの me）は落とす（ADR 0044）。
func eventData(d any) (any, error) {
	switch d := d.(type) {
	case chat.Message:
		return newBroadcastMessageResponse(d), nil
	case chat.MemberJoined:
		return memberJoinedData{d.WorkspaceID.String(), d.RoomID.String(), newUserProfileResponse(d.User)}, nil
	case chat.MemberLeft:
		return memberLeftData{d.WorkspaceID.String(), d.RoomID.String(), d.UserID.String()}, nil
	case chat.RoomUpdated:
		return roomUpdatedData{d.WorkspaceID.String(), d.RoomID.String(), d.Name, d.IsDefault, d.ArchivedAt}, nil
	case chat.RoomDeleted:
		return roomDeletedData{d.WorkspaceID.String(), d.RoomID.String()}, nil
	case chat.RoomMemberRemoved:
		return roomMemberRemovedData{d.WorkspaceID.String(), d.RoomID.String(), d.Reason}, nil
	case chat.RoomRead:
		return roomReadData{d.WorkspaceID.String(), d.RoomID.String(), d.LastReadSeq, d.LastReadUserSeq, d.UnreadCount, d.MentionCount}, nil
	case chat.WorkspaceUpdated:
		return workspaceUpdatedData{d.WorkspaceID.String(), d.Name, d.InvitePolicy}, nil
	case chat.WorkspaceMemberRemoved:
		return workspaceMemberRemovedData{d.WorkspaceID.String(), d.UserID.String(), d.Reason}, nil
	case chat.WorkspaceRoleChanged:
		return workspaceRoleChangedData{d.WorkspaceID.String(), d.UserID.String(), d.Role}, nil
	case chat.PresenceChanged:
		return presenceChangedData{d.UserID.String(), d.Presence}, nil
	case chat.MemberStatusChanged:
		return memberStatusChangedData{d.WorkspaceID.String(), d.UserID.String(), d.Away, newUserStatusResponse(d.Status)}, nil
	case chat.TypingStarted:
		var root *string
		if d.ThreadRootID != nil {
			s := d.ThreadRootID.String()
			root = &s
		}
		return typingStartedData{d.WorkspaceID.String(), d.RoomID.String(), root, newUserProfileResponse(d.User)}, nil
	case chat.ThreadRead:
		return threadReadData{d.WorkspaceID.String(), d.RoomID.String(), d.ThreadRootID.String(), d.LastReadThreadSeq, d.UnreadCount}, nil
	case chat.ThreadFollowed:
		return threadFollowedData{d.WorkspaceID.String(), d.RoomID.String(), d.ThreadRootID.String(), d.LastReadThreadSeq}, nil
	case chat.SavedItem:
		// 本人にしか届かないので、REST と同じ形（me / saved を含む）で配る（ADR 0054 決定 7）。
		return newSavedItemResponse(d), nil
	case chat.NotificationsUpdated:
		return notificationsUpdatedData{d.WorkspaceID.String(), d.Level}, nil
	case chat.RoomNotificationsUpdated:
		return roomNotificationsUpdatedData{d.WorkspaceID.String(), d.RoomID.String(), newRoomNotificationsBody(d.Notifications)}, nil
	case chat.ThreadNotificationsUpdated:
		return threadNotificationsUpdatedData{d.WorkspaceID.String(), d.RoomID.String(), d.ThreadRootID.String(), d.NotifyReplies}, nil
	case chat.ActivityReactionAdded:
		// 本人（メッセージの送信者）にしか届かないので、REST と同じ形（me を含む）で配る（ADR 0058 決定 9）。
		return activityReactionAddedData{d.WorkspaceID.String(), newActivityItemResponse(d.Item)}, nil
	case chat.ActivityReactionRemoved:
		return activityReactionRemovedData{d.WorkspaceID.String(), d.Key}, nil
	default:
		return nil, fmt.Errorf("unknown event data %T", d)
	}
}
