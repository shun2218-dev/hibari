package httpx

import (
	"net/http"
	"strconv"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// メッセージの検索の API（ADR 0061 決定 8）。ルートの登録は registerChatRoutes にまとめている。

// searchResultResponse は検索結果の 1 件（決定 7）。
//
// タイムラインの messageResponse ではなく、この小さい形にする。結果は要求した時点のもので、
// あとから WebSocket で追従しない（決定 8）ため、追従する値（change_seq・リアクション・既読）を持たせない。
type searchResultResponse struct {
	ID     string             `json:"id"`
	RoomID string             `json:"room_id"`
	// Seq はルーム内の番号。飛んだ先でページを取り直すのに使う（ADR 0042）。
	Seq    int64              `json:"seq"`
	Room   linkedRoomResponse `json:"room"`
	Sender userProfileResponse `json:"sender"`
	Body   string             `json:"body"`
	// ThreadRootID はスレッドの返信なら親。押したらスレッドを開く。
	ThreadRootID    *string    `json:"thread_root_id"`
	CreatedAt       time.Time  `json:"created_at"`
	EditedAt        *time.Time `json:"edited_at"`
	AttachmentCount int64      `json:"attachment_count"`
}

func newSearchResultResponse(r chat.SearchResult) searchResultResponse {
	room := linkedRoomResponse{ID: r.Room.ID.String(), Kind: r.Room.Kind, Name: r.Room.Name}
	if r.Room.DMPeer != nil {
		p := newUserProfileResponse(*r.Room.DMPeer)
		room.DMPeer = &p
	}
	resp := searchResultResponse{
		ID: r.ID.String(), RoomID: r.RoomID.String(), Seq: r.Seq, Room: room,
		Sender: newUserProfileResponse(r.Sender), Body: r.Body,
		CreatedAt: r.CreatedAt, EditedAt: r.EditedAt, AttachmentCount: r.AttachmentCount,
	}
	if r.ThreadRootID != nil {
		id := r.ThreadRootID.String()
		resp.ThreadRootID = &id
	}
	return resp
}

// searchResponse は結果の 1 ページ。**総件数は返さない**（決定 4。O(1) で出せないため）。
type searchResponse struct {
	Items []searchResultResponse `json:"items"`
	// NextCursor は続きがあるときだけ入り、次の ?cursor= にそのまま渡す。
	NextCursor *string `json:"next_cursor"`
	// Terms は本文に当たった語（決定 7）。クライアントはこれを本文の上に重ねて塗る。
	// `q` の解釈（引用符・除外）はサーバーにしかないので、塗る語もサーバーが返す。
	Terms []string `json:"terms"`
}

// searchMessages は ?q= と絞り込みでメッセージを探し、新しい順に 1 ページ返す。
//
// 修飾子（`in:` `from:` `before:`）はクライアントが解釈して ID と日時にしてから渡す（決定 5）。
// サーバーは名前を受け取らない。名前で受け取ると、読めないチャンネルの存在が
// 「その名前が有効かどうか」で漏れるため（ADR 0011 と同じ理由）。
func (h *chatHandlers) searchMessages(w http.ResponseWriter, r *http.Request) {
	wsID, err := pathID(r, "workspaceID")
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	query := r.URL.Query()
	sq := chat.SearchQuery{Text: query.Get("q"), Cursor: query.Get("cursor")}
	for _, spec := range []struct {
		name string
		into *[]ulid.ULID
	}{
		{"room_id", &sq.RoomIDs},
		{"exclude_room_id", &sq.ExcludeRoomIDs},
		{"sender_id", &sq.SenderIDs},
		{"exclude_sender_id", &sq.ExcludeSenderIDs},
	} {
		if *spec.into, err = queryIDs(query[spec.name], spec.name); err != nil {
			writeError(h.logger, w, r, err)
			return
		}
	}
	if sq.After, err = queryTime(query.Get("after"), "after"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if sq.Before, err = queryTime(query.Get("before"), "before"); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	if raw := query.Get("limit"); raw != "" {
		n, convErr := strconv.Atoi(raw)
		if convErr != nil {
			writeError(h.logger, w, r, &errBadRequest{status: http.StatusBadRequest, detail: "limit must be an integer"})
			return
		}
		sq.Limit = n
	}

	page, err := h.svc.SearchMessages(r.Context(), actorOf(r), wsID, sq)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := searchResponse{Items: make([]searchResultResponse, len(page.Results)), Terms: page.Terms}
	for i, it := range page.Results {
		resp.Items[i] = newSearchResultResponse(it)
	}
	if page.NextCursor != "" {
		resp.NextCursor = &page.NextCursor
	}
	if resp.Terms == nil {
		resp.Terms = []string{}
	}
	writeJSON(w, http.StatusOK, resp)
}

// queryIDs は同じ名前で何度も渡せる ULID のクエリ引数を読む（`?room_id=..&room_id=..`）。
func queryIDs(values []string, name string) ([]ulid.ULID, error) {
	if len(values) == 0 {
		return nil, nil
	}
	ids := make([]ulid.ULID, 0, len(values))
	for _, v := range values {
		id, err := ulid.Parse(v)
		if err != nil {
			return nil, &errBadRequest{status: http.StatusBadRequest, detail: name + " must be a ULID"}
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// queryTime は RFC 3339 の日時のクエリ引数を読む。空なら nil（条件なし）。
func queryTime(value, name string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, &errBadRequest{status: http.StatusBadRequest, detail: name + " must be an RFC 3339 timestamp"}
	}
	return &t, nil
}
