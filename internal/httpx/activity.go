package httpx

import (
	"net/http"
	"time"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// アクティビティの API（ADR 0058 決定 6）。ルートの登録は registerChatRoutes にまとめている。

// activityItemResponse はアクティビティの 1 件。type が reaction のときだけ reaction が入り、message はリアクションの付いた自分のメッセージ。
type activityItemResponse struct {
	// ID は一覧の中で 1 件を決める値（activity.reaction_removed の id と同じ）。
	ID      string                `json:"id"`
	Type    chat.ActivityItemType `json:"type"`
	Reasons []chat.ActivityReason `json:"reasons"`
	// Unread はルームやスレッドの既読位置から導いた未読（決定 5）。リアクションは常に false。
	Unread     bool                      `json:"unread"`
	OccurredAt time.Time                 `json:"occurred_at"`
	Room       linkedRoomResponse        `json:"room"`
	Message    messageResponse           `json:"message"`
	Reaction   *activityReactionResponse `json:"reaction"`
}

type activityReactionResponse struct {
	Emoji string              `json:"emoji"`
	User  userProfileResponse `json:"user"`
}

func newActivityItemResponse(it chat.ActivityItem) activityItemResponse {
	room := linkedRoomResponse{ID: it.Room.ID.String(), Kind: it.Room.Kind, Name: it.Room.Name}
	if it.Room.DMPeer != nil {
		p := newUserProfileResponse(*it.Room.DMPeer)
		room.DMPeer = &p
	}
	resp := activityItemResponse{
		ID: it.Key, Type: it.Type, Reasons: it.Reasons, Unread: it.Unread, OccurredAt: it.OccurredAt,
		Room: room, Message: newMessageResponse(it.Message),
	}
	if resp.Reasons == nil {
		resp.Reasons = []chat.ActivityReason{}
	}
	if it.Reaction != nil {
		resp.Reaction = &activityReactionResponse{Emoji: it.Reaction.Emoji, User: newUserProfileResponse(it.Reaction.User)}
	}
	return resp
}

// activityListResponse は一覧の 1 ページ。next_cursor は has_more のときだけ入り、次の ?before= にそのまま渡す。
type activityListResponse struct {
	Items      []activityItemResponse `json:"items"`
	NextCursor *string                `json:"next_cursor"`
	HasMore    bool                   `json:"has_more"`
}

// activityUnreadCountResponse は未読のアクティビティの件数。100 で打ち切る（メニューのバッジは「99+」）。
type activityUnreadCountResponse struct {
	Count int64 `json:"count"`
}

// activityReactionAddedData は activity.reaction_added。本人にしか届かないので、REST と同じ形（me を含む）で配る。
type activityReactionAddedData struct {
	WorkspaceID string               `json:"workspace_id"`
	Item        activityItemResponse `json:"item"`
}

// activityReactionRemovedData は activity.reaction_removed。id の 1 件を一覧から外す。
type activityReactionRemovedData struct {
	WorkspaceID string `json:"workspace_id"`
	ID          string `json:"id"`
}

// listActivity は ?filter= / ?unread= / ?before= / ?limit= でアクティビティの 1 ページを返す。
func (h *chatHandlers) listActivity(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	query := r.URL.Query()
	aq := chat.ActivityQuery{Filter: chat.ActivityFilter(query.Get("filter")), Before: query.Get("before")}
	switch query.Get("unread") {
	case "", "false":
	case "true":
		aq.UnreadOnly = true
	default:
		writeError(h.logger, w, r, &errBadRequest{status: http.StatusBadRequest, detail: "unread must be true or false"})
		return
	}
	if aq.Limit, err = queryMessageLimit(r); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := h.svc.ListActivity(r.Context(), actorOf(r), wsID, aq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := activityListResponse{Items: make([]activityItemResponse, len(page.Items)), HasMore: page.HasMore}
	for i, it := range page.Items {
		resp.Items[i] = newActivityItemResponse(it)
	}
	if page.HasMore {
		resp.NextCursor = &page.NextCursor
	}
	writeJSON(w, http.StatusOK, resp)
}

// activityUnreadCount は未読のアクティビティの件数（メニューのバッジ）を返す。
func (h *chatHandlers) activityUnreadCount(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	n, err := h.svc.CountUnreadActivity(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, activityUnreadCountResponse{Count: n})
}
