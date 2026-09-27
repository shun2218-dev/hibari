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

// 本文に貼られたハドルのリンクのカード（ADR 0067 決定 2）。

type huddleLinksRequest struct {
	// RoomIDs はリンクが指すルーム（ハドルのリンクはルームを指す。決定 1）。20 件まで。
	RoomIDs []string `json:"room_ids"`
}

// huddleLinkResponse は 1 件のリンクの結果。status が ok のときだけ、workspace・room・huddle・can_join が意味を持つ。
type huddleLinkResponse struct {
	RoomID    string                   `json:"room_id"`
	Status    chat.MessageLinkStatus   `json:"status"`
	Workspace *linkedWorkspaceResponse `json:"workspace"`
	Room      *linkedRoomResponse      `json:"room"`
	// Huddle は進行中のハドル（ルームの応答と同じ形）。なければ null。
	Huddle *roomHuddleResponse `json:"huddle"`
	// CanJoin はそのルームのハドルに入れるか。入れない人にはボタンを出さない。
	CanJoin bool `json:"can_join"`
}

type huddleLinksResponse struct {
	Links []huddleLinkResponse `json:"links"`
}

// resolveHuddleLinks は、本文に貼られたハドルのリンクの中身を、見る人の権限でまとめて返す（決定 2）。
// 副作用はないが、ID の配列を渡すので POST にする（メッセージのリンクと同じ）。
func (h *chatHandlers) resolveHuddleLinks(w http.ResponseWriter, r *http.Request) {
	var req huddleLinksRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	roomIDs := make([]ulid.ULID, len(req.RoomIDs))
	for i, s := range req.RoomIDs {
		// ULID として読めない ID はゼロ値のまま渡す。どのルームにも一致しないので unavailable になる
		// （形式の違いで実在を当てられないようにする。メッセージのリンクと同じ）
		roomIDs[i], _ = ulid.ParseStrict(s)
	}
	results, err := h.svc.ResolveHuddleLinks(r.Context(), actorOf(r), roomIDs)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := huddleLinksResponse{Links: make([]huddleLinkResponse, len(results))}
	for i, res := range results {
		// ID は受け取った文字列のまま返す（クライアントが送った値で結果を引き当てられるように）
		resp.Links[i] = huddleLinkResponse{RoomID: req.RoomIDs[i], Status: res.Status}
		if res.Status != chat.MessageLinkOK {
			continue
		}
		if ws := res.Workspace; ws != nil {
			resp.Links[i].Workspace = &linkedWorkspaceResponse{ID: ws.ID.String(), Name: ws.Name}
		}
		if room := res.Room; room != nil {
			rr := &linkedRoomResponse{ID: room.ID.String(), Kind: room.Kind, Name: room.Name}
			if room.DMPeer != nil {
				p := newUserProfileResponse(*room.DMPeer)
				rr.DMPeer = &p
			}
			resp.Links[i].Room = rr
		}
		resp.Links[i].Huddle = newRoomHuddleResponse(res.Huddle)
		resp.Links[i].CanJoin = res.CanJoin
	}
	writeJSON(w, http.StatusOK, resp)
}
