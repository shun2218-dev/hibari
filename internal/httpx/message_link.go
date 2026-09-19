package httpx

import (
	"net/http"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// 本文に貼られたメッセージへのリンクのカード（ロードマップ Phase 6.11a / ADR 0040）。

type messageLinkRef struct {
	RoomID    string `json:"room_id"`
	MessageID string `json:"message_id"`
}

type messageLinksRequest struct {
	Links []messageLinkRef `json:"links"`
}

// linkedWorkspaceResponse は、今いるワークスペースと違うときだけクライアントが名前を出す。
type linkedWorkspaceResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type linkedRoomResponse struct {
	ID   string        `json:"id"`
	Kind chat.RoomKind `json:"kind"`
	// Name は dm では空。
	Name string `json:"name"`
	// DMPeer は dm の相手。dm 以外では null。dm にはルーム名がないので、カードは相手の名前を出す。
	DMPeer *userProfileResponse `json:"dm_peer"`
}

// linkedMessageResponse はカードに出すメッセージ。タイムラインの Message とは別の、意図的に小さい形（ADR 0040）。
type linkedMessageResponse struct {
	ID     string              `json:"id"`
	Seq    int64               `json:"seq"`
	Sender userProfileResponse `json:"sender"`
	// Body は削除済みなら空。
	Body string `json:"body"`
	// ThreadRootID はスレッドの返信なら親の ID。カードから開くパネルを決めるのに使う。
	ThreadRootID *string `json:"thread_root_id"`
	// AttachmentCount は添付の件数。カードに画像は出さない（ADR 0040）。
	AttachmentCount int        `json:"attachment_count"`
	CreatedAt       time.Time  `json:"created_at"`
	EditedAt        *time.Time `json:"edited_at"`
	// DeletedAt が入っていたら削除済み。カードとしての見せ方はクライアントが決める（ADR 0038）。
	DeletedAt *time.Time `json:"deleted_at"`
}

// messageLinkResponse は 1 件のリンクの結果。status が ok のときだけ、あとの 3 つが入る。
type messageLinkResponse struct {
	RoomID    string                   `json:"room_id"`
	MessageID string                   `json:"message_id"`
	Status    chat.MessageLinkStatus   `json:"status"`
	Workspace *linkedWorkspaceResponse `json:"workspace"`
	Room      *linkedRoomResponse      `json:"room"`
	Message   *linkedMessageResponse   `json:"message"`
}

type messageLinksResponse struct {
	Links []messageLinkResponse `json:"links"`
}

// resolveMessageLinks は、本文に貼られたパーマリンクの中身を、見る人の権限でまとめて返す（ADR 0040）。
//
// 副作用はないが、ID の配列を渡すので POST にする（ADR 0020 の POST /users/avatars と同じ）。
func (h *chatHandlers) resolveMessageLinks(w http.ResponseWriter, r *http.Request) {
	var req messageLinksRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	links := make([]chat.MessageLink, len(req.Links))
	for i, l := range req.Links {
		// ULID として読めない ID は、ゼロ値のまま渡す。どの行にも一致しないので unavailable になり、
		// 「存在しない ID」と同じ結果になる（ADR 0040。形式の違いで実在を当てられないようにする）。
		roomID, _ := ulid.ParseStrict(l.RoomID)
		messageID, _ := ulid.ParseStrict(l.MessageID)
		links[i] = chat.MessageLink{RoomID: roomID, MessageID: messageID}
	}
	results, err := h.svc.ResolveMessageLinks(r.Context(), actorOf(r), links)
	if err != nil {
		writeError(h.logger, w, r, err)
		return
	}
	resp := messageLinksResponse{Links: make([]messageLinkResponse, len(results))}
	for i, res := range results {
		// ID は、リクエストで受け取った文字列をそのまま返す。クライアントが自分の送った値で結果を引き当てられるようにする
		// （ULID として読めなかった値でも、送った形のまま返る）。
		resp.Links[i] = messageLinkResponse{RoomID: req.Links[i].RoomID, MessageID: req.Links[i].MessageID, Status: res.Status}
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
		if m := res.Message; m != nil {
			mr := &linkedMessageResponse{
				ID:              m.ID.String(),
				Seq:             m.Seq,
				Sender:          newUserProfileResponse(m.Sender),
				Body:            m.Body,
				AttachmentCount: m.AttachmentCount,
				CreatedAt:       m.CreatedAt,
				EditedAt:        m.EditedAt,
				DeletedAt:       m.DeletedAt,
			}
			if m.ThreadRootID != nil {
				id := m.ThreadRootID.String()
				mr.ThreadRootID = &id
			}
			resp.Links[i].Message = mr
		}
	}
	writeJSON(w, http.StatusOK, resp)
}
