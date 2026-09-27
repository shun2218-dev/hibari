package httpx

import (
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
)

// ハドルの一覧と提案のカード（ADR 0067 決定 6・7）。進行中のハドルは返さない（クライアントのストアから描く）。
// Cloudflare の設定がなくても（ハドルが無効でも）、過去のハドルは読める。

// huddlePlaceResponse はハドルのある場所。dm では name が null で、dm_peer に相手が入る（スレッドの一覧と同じ形）。
type huddlePlaceResponse struct {
	ID     string               `json:"id"`
	Kind   authz.RoomKind       `json:"kind"`
	Name   *string              `json:"name"`
	DMPeer *userProfileResponse `json:"dm_peer,omitzero"`
}

func newHuddlePlaceResponse(p chat.HuddlePlace) huddlePlaceResponse {
	out := huddlePlaceResponse{ID: p.ID.String(), Kind: p.Kind}
	if p.DMPeer != nil {
		peer := newUserProfileResponse(*p.DMPeer)
		out.DMPeer = &peer
	} else {
		name := p.Name
		out.Name = &name
	}
	return out
}

// pastHuddleResponse は「最近のハドルミーティング」の 1 行（終わったハドル）。
type pastHuddleResponse struct {
	ID string `json:"id"`
	// MessageID は会話のハドルのメッセージ（行を押したときの行き先。ハドルのチャットのスレッドの親）。
	MessageID string              `json:"message_id"`
	StartedBy string              `json:"started_by"`
	Room      huddlePlaceResponse `json:"room"`
	StartedAt time.Time           `json:"started_at"`
	EndedAt   time.Time           `json:"ended_at"`
	// ParticipantIDs は一度でも入った人（最初に入った順）。
	ParticipantIDs []string `json:"participant_ids"`
	// ReplyCount はハドルのチャットの返信の数。
	ReplyCount int64 `json:"reply_count"`
}

type huddleListResponse struct {
	Huddles    []pastHuddleResponse `json:"huddles"`
	NextCursor *string              `json:"next_cursor"`
}

// listHuddles は「最近のハドルミーティング」を新しい順に返す（?filter= / ?participant_id= / ?room_id= / ?before= / ?limit=）。
func (h *chatHandlers) listHuddles(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	query := r.URL.Query()
	hq := chat.HuddleListQuery{Scope: chat.HuddleListScope(query.Get("filter"))}
	if hq.ParticipantID, err = queryOptionalID(r, "participant_id"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if hq.RoomID, err = queryOptionalID(r, "room_id"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	before, err := queryOptionalID(r, "before")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if before != nil {
		hq.Before = *before
	}
	if hq.Limit, err = queryMessageLimit(r); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	page, err := h.svc.ListHuddles(r.Context(), actorOf(r), wsID, hq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := huddleListResponse{Huddles: make([]pastHuddleResponse, len(page.Items)), NextCursor: nextCursor(page.NextCursor)}
	for i, it := range page.Items {
		resp.Huddles[i] = pastHuddleResponse{
			ID: it.ID.String(), MessageID: it.MessageID.String(), StartedBy: it.StartedBy.String(),
			Room: newHuddlePlaceResponse(it.Room), StartedAt: it.StartedAt, EndedAt: it.EndedAt,
			ParticipantIDs: idStrings(it.ParticipantIDs), ReplyCount: it.ReplyCount,
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// huddleSuggestionResponse は提案のカード（決定 7）。count は過去 7 日間にそこで自分が参加したハドルの数。
type huddleSuggestionResponse struct {
	Room  huddlePlaceResponse `json:"room"`
	Count int64               `json:"count"`
	// ParticipantIDs は、そこの同じ期間のハドルに参加した人（自分を除く）。
	ParticipantIDs []string `json:"participant_ids"`
}

type huddleSuggestionsResponse struct {
	Suggestions []huddleSuggestionResponse `json:"suggestions"`
}

func (h *chatHandlers) listHuddleSuggestions(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	suggestions, err := h.svc.HuddleSuggestions(r.Context(), actorOf(r), wsID)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := huddleSuggestionsResponse{Suggestions: make([]huddleSuggestionResponse, len(suggestions))}
	for i, s := range suggestions {
		resp.Suggestions[i] = huddleSuggestionResponse{Room: newHuddlePlaceResponse(s.Room), Count: s.Count, ParticipantIDs: idStrings(s.ParticipantIDs)}
	}
	writeJSON(w, http.StatusOK, resp)
}

// queryOptionalID は ID のクエリを読む。なければ nil。
func queryOptionalID(r *http.Request, name string) (*ulid.ULID, error) {
	s := r.URL.Query().Get(name)
	if s == "" {
		return nil, nil
	}
	id, err := ulid.ParseStrict(s)
	if err != nil {
		return nil, &errBadRequest{status: http.StatusBadRequest, detail: name + " must be an ID"}
	}
	return &id, nil
}

// idStrings は ID の並びを文字列にする。空でも null ではなく [] にする。
func idStrings(ids []ulid.ULID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out
}
