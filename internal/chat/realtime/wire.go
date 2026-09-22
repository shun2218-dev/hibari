package realtime

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
)

// インスタンスの間で chat.Event を運ぶ形（ADR 0016）。
//
// これはサーバーの内部の形で、クライアントに見せる JSON（docs/events.md。httpx が決める）とは別にする。
// 受け取ったインスタンスは chat.Event に戻して、自分の接続に対して宛先を解決し直す。
// 権限の変更の再検証（AccessChanges）も、接続を持つインスタンスが行う必要があるので、宛先と一緒に運ぶ。

// wireVersion は形の版。フィールドの意味を変えるときに上げ、ローリングデプロイの間に古い版を受け取ったら捨てる。
const wireVersion = 1

// Redis Pub/Sub のチャンネル名。インスタンスは、自分の接続が購読しているチャンネルだけを購読する。
func roomChannel(id ulid.ULID) string      { return "room:" + id.String() }
func workspaceChannel(id ulid.ULID) string { return "workspace:" + id.String() }
func userChannel(id ulid.ULID) string      { return "user:" + id.String() }

// channel は購読の対象のチャンネル名を返す。
func (t Topic) channel() string {
	if t.RoomID != (ulid.ULID{}) {
		return roomChannel(t.RoomID)
	}
	return workspaceChannel(t.WorkspaceID)
}

type wireEvent struct {
	Version int       `json:"v"`
	ID      ulid.ULID `json:"id"`
	// Fanout は同じイベントを publish したチャンネルの数。2 以上なら、同じインスタンスに複数回届きうるので ID で重複を除く。
	Fanout        int                 `json:"fanout"`
	Type          chat.EventType      `json:"type"`
	Rooms         []ulid.ULID         `json:"rooms,omitempty"`
	Workspaces    []ulid.ULID         `json:"workspaces,omitempty"`
	Users         []ulid.ULID         `json:"users,omitempty"`
	ExceptUser    *ulid.ULID          `json:"except_user,omitzero"`
	AccessChanges []chat.AccessChange `json:"access_changes,omitempty"`
	// Data はドメインの型をそのまま JSON にしたもの。型は Type で決まる（dataDecoders）。
	Data jsontext.Value `json:"data"`
}

// dataDecoders は、イベントの種類ごとに Data を戻す型（chat.Event の Data の一覧と同じ）。
var dataDecoders = map[chat.EventType]func([]byte) (any, error){
	chat.EventMessageCreated:         decodeData[chat.Message],
	chat.EventMessageUpdated:         decodeData[chat.Message],
	chat.EventMessageDeleted:         decodeData[chat.Message],
	chat.EventMemberJoined:           decodeData[chat.MemberJoined],
	chat.EventMemberLeft:             decodeData[chat.MemberLeft],
	chat.EventRoomUpdated:            decodeData[chat.RoomUpdated],
	chat.EventRoomMemberRemoved:      decodeData[chat.RoomMemberRemoved],
	chat.EventRoomRead:               decodeData[chat.RoomRead],
	chat.EventWorkspaceUpdated:       decodeData[chat.WorkspaceUpdated],
	chat.EventWorkspaceMemberRemoved: decodeData[chat.WorkspaceMemberRemoved],
	chat.EventWorkspaceRoleChanged:   decodeData[chat.WorkspaceRoleChanged],
	chat.EventPresenceChanged:        decodeData[chat.PresenceChanged],
	chat.EventMemberStatusChanged:    decodeData[chat.MemberStatusChanged],
	chat.EventTypingStarted:          decodeData[chat.TypingStarted],
	chat.EventThreadRead:             decodeData[chat.ThreadRead],
	chat.EventThreadFollowed:         decodeData[chat.ThreadFollowed],
	chat.EventSavedUpdated:           decodeData[chat.SavedItem],
}

func decodeData[T any](b []byte) (any, error) {
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	return v, nil
}

// channelsFor はイベントを publish するチャンネルを返す。
// 権限が変わったユーザーのチャンネルも含める。そのユーザーの接続を持つインスタンスが、配信の前に購読を再検証するため（ADR 0015）。
func channelsFor(ev chat.Event) []string {
	seen := map[string]bool{}
	var out []string
	add := func(ch string) {
		if !seen[ch] {
			seen[ch] = true
			out = append(out, ch)
		}
	}
	for _, id := range ev.To.Rooms {
		add(roomChannel(id))
	}
	for _, id := range ev.To.Workspaces {
		add(workspaceChannel(id))
	}
	for _, id := range ev.To.Users {
		add(userChannel(id))
	}
	for _, ch := range ev.AccessChanges {
		add(userChannel(ch.UserID))
	}
	return out
}

// encodeWire は ev を id の付いた形にする。fanout は publish するチャンネルの数。
func encodeWire(ev chat.Event, id ulid.ULID, fanout int) ([]byte, error) {
	data, err := json.Marshal(ev.Data)
	if err != nil {
		return nil, fmt.Errorf("marshal %s data: %w", ev.Type, err)
	}
	w := wireEvent{
		Version:       wireVersion,
		ID:            id,
		Fanout:        fanout,
		Type:          ev.Type,
		Rooms:         ev.To.Rooms,
		Workspaces:    ev.To.Workspaces,
		Users:         ev.To.Users,
		AccessChanges: ev.AccessChanges,
		Data:          data,
	}
	if ev.To.ExceptUser != (ulid.ULID{}) {
		w.ExceptUser = &ev.To.ExceptUser
	}
	b, err := json.Marshal(w)
	if err != nil {
		return nil, fmt.Errorf("marshal %s: %w", ev.Type, err)
	}
	return b, nil
}

// decodeWire は encodeWire の逆。知らない版や種類は、古い（または新しい）インスタンスが publish したものとしてエラーにする。
func decodeWire(payload []byte) (w wireEvent, ev chat.Event, err error) {
	if err := json.Unmarshal(payload, &w); err != nil {
		return wireEvent{}, chat.Event{}, fmt.Errorf("unmarshal wire event: %w", err)
	}
	if w.Version != wireVersion {
		return wireEvent{}, chat.Event{}, fmt.Errorf("unsupported wire event version %d", w.Version)
	}
	decode, ok := dataDecoders[w.Type]
	if !ok {
		return wireEvent{}, chat.Event{}, fmt.Errorf("unknown event type %q", w.Type)
	}
	data, err := decode(w.Data)
	if err != nil {
		return wireEvent{}, chat.Event{}, fmt.Errorf("unmarshal %s data: %w", w.Type, err)
	}
	ev = chat.Event{
		Type:          w.Type,
		To:            chat.Audience{Rooms: w.Rooms, Workspaces: w.Workspaces, Users: w.Users},
		AccessChanges: w.AccessChanges,
		Data:          data,
	}
	if w.ExceptUser != nil {
		ev.To.ExceptUser = *w.ExceptUser
	}
	return w, ev, nil
}

// recentIDs は、直近に受け取ったイベントの ID を決まった数だけ覚える（重複の除去）。
// 1 つのイベントの複数のコピーは続けて publish されるので、少し前までを覚えていれば足りる。
// Broker の受信の goroutine だけが使うので、ロックを持たない。
type recentIDs struct {
	ring []ulid.ULID
	next int
	set  map[ulid.ULID]struct{}
}

func newRecentIDs(size int) *recentIDs {
	return &recentIDs{ring: make([]ulid.ULID, size), set: make(map[ulid.ULID]struct{}, size)}
}

// seen は id をすでに受け取っていれば true を返す。初めてなら覚えて false を返す。
func (r *recentIDs) seen(id ulid.ULID) bool {
	if _, ok := r.set[id]; ok {
		return true
	}
	if old := r.ring[r.next]; old != (ulid.ULID{}) {
		delete(r.set, old)
	}
	r.ring[r.next] = id
	r.set[id] = struct{}{}
	r.next = (r.next + 1) % len(r.ring)
	return false
}
