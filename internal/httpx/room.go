package httpx

import (
	"context"
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
)

// ルーム（ADR 0011）。作成・一覧・1 件・設定の更新と、アーカイブ・復元・削除（ADR 0059）。

type roomResponse struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspace_id"`
	Kind        authz.RoomKind `json:"kind"`
	// Name は dm では null。
	Name      *string `json:"name"`
	IsDefault bool    `json:"is_default"`
	IsMember  bool    `json:"is_member"`
	// MemberCount は 1 件の取得でだけ返す。
	MemberCount    *int64          `json:"member_count,omitzero"`
	DMPeer         *dmPeerResponse `json:"dm_peer,omitzero"`
	LastMessageSeq int64           `json:"last_message_seq"`
	LastMessageAt  *time.Time      `json:"last_message_at"`
	// LastReadSeq はルームのメンバーでなければ null。
	LastReadSeq *int64 `json:"last_read_seq"`
	// LastUserSeq は人の発言の総数、LastReadUserSeq はその既読位置（未読数の根拠。ADR 0033）。
	LastUserSeq     int64  `json:"last_user_seq"`
	LastReadUserSeq *int64 `json:"last_read_user_seq"`
	UnreadCount     int64  `json:"unread_count"`
	// MentionCount は未読の範囲にある自分宛てのメンションの数（ADR 0041）。未読とは別のバッジに出す。
	MentionCount int64 `json:"mention_count"`
	// LastMessage はメッセージが 1 件もなければ null。
	LastMessage *lastMessageResponse `json:"last_message"`
	// Notifications は本人のチャンネルごとの通知の設定（ADR 0055 決定 4）。参加していない public ルームでは null。
	Notifications *roomNotificationsBody `json:"notifications"`
	// ArchivedAt はアーカイブされていなければ null（ADR 0059 決定 5）。一覧はアーカイブ済みも返す。
	ArchivedAt *time.Time `json:"archived_at"`
	// Huddle は進行中のハドル（ADR 0066 決定 13）。なければ null。再接続したクライアントはここから読み直す。
	Huddle    *roomHuddleResponse `json:"huddle"`
	CreatedAt time.Time           `json:"created_at"`
}

// dmPeerResponse は DM の相手。presence は自動で決まる状態の初期値（ADR 0015 / 0049）。
//
// 相手の away とカスタムステータスはここに載せない。クライアントはワークスペースのメンバー一覧から引く
// （メッセージの送信者の横に出すステータスと同じ経路にして、載せ場所を増やさない。ADR 0049 決定 7 の追記）。
type dmPeerResponse struct {
	userProfileResponse
	Presence chat.Presence `json:"presence"`
}

func newLastMessageResponse(m chat.MessagePreview) lastMessageResponse {
	return lastMessageResponse{
		ID: m.ID.String(), Sender: newUserProfileResponse(m.Sender), Kind: m.Kind,
		System: newSystemEventResponse(m.System), Body: m.Body, CreatedAt: m.CreatedAt, Deleted: m.Deleted,
	}
}

// lastMessageResponse はサイドバーの最終メッセージ。相対時刻の表示はクライアントが created_at から作る。
type lastMessageResponse struct {
	ID     string              `json:"id"`
	Sender userProfileResponse `json:"sender"`
	// Kind と System は、サイドバーの 1 行にログの文言を出すために返す（ADR 0033）。
	Kind      chat.MessageKind     `json:"kind"`
	System    *systemEventResponse `json:"system,omitzero"`
	Body      string               `json:"body"`
	CreatedAt time.Time            `json:"created_at"`
	Deleted   bool                 `json:"deleted"`
}

func newRoomResponse(r chat.Room, withCount bool) roomResponse {
	resp := roomResponse{
		ID:              r.ID.String(),
		WorkspaceID:     r.WorkspaceID.String(),
		Kind:            r.Kind,
		IsDefault:       r.IsDefault,
		IsMember:        r.IsMember,
		LastMessageSeq:  r.LastMessageSeq,
		LastMessageAt:   r.LastMessageAt,
		LastReadSeq:     r.LastReadSeq,
		LastUserSeq:     r.LastUserSeq,
		LastReadUserSeq: r.LastReadUserSeq,
		UnreadCount:     r.UnreadCount,
		MentionCount:    r.MentionCount,
		ArchivedAt:      r.ArchivedAt,
		Huddle:          newRoomHuddleResponse(r.Huddle),
		CreatedAt:       r.CreatedAt,
	}
	if m := r.LastMessage; m != nil {
		lm := newLastMessageResponse(*m)
		resp.LastMessage = &lm
	}
	if r.Kind != authz.RoomDM {
		resp.Name = &r.Name
	}
	if withCount {
		resp.MemberCount = &r.MemberCount
	}
	if n := r.Notifications; n != nil {
		body := newRoomNotificationsBody(*n)
		resp.Notifications = &body
	}
	if r.DMPeer != nil {
		resp.DMPeer = &dmPeerResponse{userProfileResponse: newUserProfileResponse(*r.DMPeer), Presence: r.DMPeerPresence}
	}
	return resp
}

// createRoomRequest の name は public / private で、user_id は dm で使う。
type createRoomRequest struct {
	Kind   string `json:"kind"`
	Name   string `json:"name,omitempty"`
	UserID string `json:"user_id,omitempty"`
}

// createRoom は新しく作ったら 201、既存の DM を返したら 200。
func (h *chatHandlers) createRoom(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req createRoomRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	in := chat.CreateRoomInput{Kind: req.Kind, Name: req.Name}
	if req.Kind == string(authz.RoomDM) {
		if in.UserID, err = bodyUserID(req.UserID); err != nil {
			writeError(h.logger, w, r, err)
			return
		}
	}
	room, created, err := h.svc.CreateRoom(r.Context(), actorOf(r), wsID, in)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, newRoomResponse(room, true))
}

func (h *chatHandlers) listRooms(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	rooms, err := h.svc.ListRooms(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	// サイドバーの「スレッド」のバッジも同じ呼び出しで返す（ADR 0036）。ルームと同じ時点である必要はないので、別に数える。
	unreadThreads, err := h.svc.UnreadThreadCount(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := roomListResponse{Rooms: make([]roomResponse, len(rooms)), UnreadThreadCount: unreadThreads}
	for i, room := range rooms {
		resp.Rooms[i] = newRoomResponse(room, false)
	}
	writeJSON(w, http.StatusOK, resp)
}

type roomListResponse struct {
	Rooms []roomResponse `json:"rooms"`
	// UnreadThreadCount は、未読の返信がある参加中のスレッドの数（ADR 0036）。
	UnreadThreadCount int64 `json:"unread_thread_count"`
}

func (h *chatHandlers) getRoom(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	room, err := h.svc.GetRoom(r.Context(), actorOf(r), roomID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomResponse(room, true))
}

type updateRoomRequest struct {
	Name      *string `json:"name"`
	IsDefault *bool   `json:"is_default"`
}

func (h *chatHandlers) updateRoom(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	var req updateRoomRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	room, err := h.svc.UpdateRoom(r.Context(), actorOf(r), roomID, chat.RoomUpdate{Name: req.Name, IsDefault: req.IsDefault})
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomResponse(room, true))
}

// archiveRoom はルームをアーカイブする（ADR 0059）。
func (h *chatHandlers) archiveRoom(w http.ResponseWriter, r *http.Request) {
	h.setRoomArchived(w, r, h.svc.ArchiveRoom)
}

// unarchiveRoom はアーカイブを戻す（ADR 0059）。
func (h *chatHandlers) unarchiveRoom(w http.ResponseWriter, r *http.Request) {
	h.setRoomArchived(w, r, h.svc.UnarchiveRoom)
}

func (h *chatHandlers) setRoomArchived(w http.ResponseWriter, r *http.Request, set func(ctx context.Context, actor, roomID ulid.ULID) (chat.Room, error)) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	room, err := set(r.Context(), actorOf(r), roomID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomResponse(room, true))
}

// deleteRoom はルームを削除する（ADR 0059）。元に戻せない。
func (h *chatHandlers) deleteRoom(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if err := h.svc.DeleteRoom(r.Context(), actorOf(r), roomID); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// joinRoom は public ルームに参加する。すでにメンバーでも 200 を返す。
func (h *chatHandlers) joinRoom(w http.ResponseWriter, r *http.Request) {
	roomID, err := pathID(r, "roomID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	room, err := h.svc.JoinRoom(r.Context(), actorOf(r), roomID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoomResponse(room, true))
}
