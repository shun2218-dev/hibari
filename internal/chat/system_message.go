package chat

import (
	"context"
	"encoding/json/v2"
	"fmt"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// システムメッセージ（参加・退出・作成・名前の変更のログ。ADR 0033）。
//
// 人の発言と同じ messages の行として seq を採番するので、並び・ページング・差分取得・配信の仕組みがそのまま効く。
// 未読数には数えないので、user_seq は進めない（採番は AllocateSystemMessageSeq）。
// sender はその行の主語（参加した人、名前を変えた人）にする。対象者を別に JOIN しないで文を組み立てられるようにするため。

// writeSystemMessage はシステムメッセージを 1 行書き、配信するイベントを返す。
// DM には書かない（メンバーが固定で、名前もない）ので、呼び出し側が種類を確かめてから呼ぶ。
func (s *Service) writeSystemMessage(
	ctx context.Context,
	q *store.Queries,
	roomID ulid.ULID,
	subject ulid.ULID,
	event SystemEvent,
) (Event, error) {
	now := s.clock.Now()
	allocated, err := q.AllocateSystemMessageSeq(ctx, store.AllocateSystemMessageSeqParams{RoomID: roomID, Now: now})
	if err != nil {
		return Event{}, fmt.Errorf("allocate system message seq: %w", err)
	}
	data, err := marshalSystemEvent(event)
	if err != nil {
		return Event{}, err
	}
	id := s.ids.New()
	systemType := string(event.Type)
	err = q.CreateSystemMessage(ctx, store.CreateSystemMessageParams{
		ID: id, RoomID: roomID, Seq: allocated.LastMessageSeq, ChangeSeq: allocated.LastChangeSeq,
		UserSeq: allocated.LastUserSeq, SenderID: subject,
		// client_msg_id は冪等な再送のための値だが、システムメッセージはクライアントから送られない。
		// NOT NULL なのでサーバーが ULID を作って入れる（UNIQUE(room_id, sender_id, client_msg_id) は自然に満たされる）。
		ClientMsgID: s.ids.New(), SystemType: &systemType, SystemData: data, Now: now,
	})
	if err != nil {
		return Event{}, fmt.Errorf("create system message: %w", err)
	}
	// システムメッセージにはリアクションを付けられない（ADR 0044 決定 6）ので、閲覧者は誰でもよい。
	msg, err := getMessage(ctx, q, roomID, ulid.ULID{}, id)
	if err != nil {
		return Event{}, err
	}
	return Event{Type: EventMessageCreated, To: Audience{Rooms: []ulid.ULID{roomID}}, Data: msg}, nil
}

// marshalSystemEvent は system_data の JSON を作る。中身のない種類（参加・退出など）は null にする。
func marshalSystemEvent(event SystemEvent) ([]byte, error) {
	if event.OldName == "" && event.NewName == "" && event.MessageID == nil && event.HuddleID == nil {
		return nil, nil
	}
	data, err := json.Marshal(event)
	if err != nil {
		return nil, fmt.Errorf("marshal system data: %w", err)
	}
	return data, nil
}
