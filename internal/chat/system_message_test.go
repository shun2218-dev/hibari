package chat_test

import (
	"errors"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// システムメッセージ（ADR 0033）。参加・退出・作成・名前の変更をチャンネルのログに残す。

// systemLog はルームのシステムメッセージを seq の順に返す。
func systemLog(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID) []chat.Message {
	t.Helper()
	page, err := env.Service.ListMessages(t.Context(), actor, roomID, chat.MessageQuery{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	var log []chat.Message
	for _, m := range page.Messages {
		if m.Kind == chat.MessageKindSystem {
			log = append(log, m)
		}
	}
	return log
}

func TestSystemMessagesForRoomLifecycle(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.owner, r.ws.ID, "public", "雑談")

	// 作成した時点で「作成しました」が 1 行。主語は作成者で、本文は空（文言はクライアントが作る）。
	log := systemLog(t, env, r.owner, room.ID)
	if len(log) != 1 || log[0].System == nil || log[0].System.Type != chat.SystemRoomCreated {
		t.Fatalf("after create: %+v", log)
	}
	if log[0].Sender.ID != r.owner || log[0].Body != "" || log[0].Seq != 1 {
		t.Errorf("room_created = %+v", log[0])
	}

	if _, err := env.Service.JoinRoom(t.Context(), r.member, room.ID); err != nil {
		t.Fatal(err)
	}
	// 冪等な参加では増やさない。
	if _, err := env.Service.JoinRoom(t.Context(), r.member, room.ID); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.RemoveRoomMember(t.Context(), r.member, room.ID, r.member); err != nil {
		t.Fatal(err)
	}
	if _, err := env.Service.UpdateRoom(t.Context(), r.owner, room.ID, chat.RoomUpdate{Name: ptr("雑談 改")}); err != nil {
		t.Fatal(err)
	}
	// 同じ名前での保存では増やさない。
	if _, err := env.Service.UpdateRoom(t.Context(), r.owner, room.ID, chat.RoomUpdate{Name: ptr("雑談 改")}); err != nil {
		t.Fatal(err)
	}

	log = systemLog(t, env, r.owner, room.ID)
	var types []chat.SystemEventType
	for _, m := range log {
		types = append(types, m.System.Type)
	}
	want := []chat.SystemEventType{chat.SystemRoomCreated, chat.SystemMemberJoined, chat.SystemMemberLeft, chat.SystemRoomRenamed}
	if len(types) != len(want) {
		t.Fatalf("system messages = %v, want %v", types, want)
	}
	for i := range want {
		if types[i] != want[i] {
			t.Fatalf("system messages = %v, want %v", types, want)
		}
	}
	// 参加・退出の主語はその人。
	if log[1].Sender.ID != r.member || log[2].Sender.ID != r.member {
		t.Errorf("join/leave subject = %s / %s, want %s", log[1].Sender.ID, log[2].Sender.ID, r.member)
	}
	renamed := log[3]
	if renamed.Sender.ID != r.owner || renamed.System.OldName != "雑談" || renamed.System.NewName != "雑談 改" {
		t.Errorf("room_renamed = %+v", renamed.System)
	}
}

func TestSystemMessageWhenRemovedByAnother(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.owner, r.ws.ID, "private", "リリース準備")
	if err := env.Service.AddRoomMember(t.Context(), r.owner, room.ID, r.member); err != nil {
		t.Fatal(err)
	}
	if err := env.Service.RemoveRoomMember(t.Context(), r.owner, room.ID, r.member); err != nil {
		t.Fatal(err)
	}

	log := systemLog(t, env, r.owner, room.ID)
	if len(log) != 3 {
		t.Fatalf("system messages = %d, want 3", len(log))
	}
	// 追加されたときも「参加しました」で、主語は追加された人（ADR 0033）。
	if log[1].System.Type != chat.SystemMemberJoined || log[1].Sender.ID != r.member {
		t.Errorf("joined = %+v (sender %s)", log[1].System, log[1].Sender.ID)
	}
	// 外されたときは member_removed。誰が外したかは残さない。
	if log[2].System.Type != chat.SystemMemberRemoved || log[2].Sender.ID != r.member {
		t.Errorf("removed = %+v (sender %s)", log[2].System, log[2].Sender.ID)
	}
}

func TestSystemMessagesAreNotCountedAsUnread(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.owner, r.ws.ID, "public", "雑談")
	if _, err := env.Service.JoinRoom(t.Context(), r.member, room.ID); err != nil {
		t.Fatal(err)
	}

	// member から見て、自分の参加のログと owner の参加のログは未読にならない。
	got, err := env.Service.GetRoom(t.Context(), r.member, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.UnreadCount != 0 {
		t.Errorf("unread after joining = %d, want 0", got.UnreadCount)
	}

	send(t, env, r.owner, room.ID, "こんにちは")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	send(t, env, r.owner, room.ID, "もう 1 通")

	got, err = env.Service.GetRoom(t.Context(), r.member, room.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 人の発言 2 件だけを数える（間に member2 の参加のログが挟まっていても 2）。
	if got.UnreadCount != 2 {
		t.Errorf("unread = %d, want 2", got.UnreadCount)
	}

	// 既読にすると 0 に戻る。seq は最新（システムメッセージ）まで進めてよい。
	st, err := env.Service.MarkRoomRead(t.Context(), r.member, room.ID, got.LastMessageSeq)
	if err != nil {
		t.Fatal(err)
	}
	if st.UnreadCount != 0 {
		t.Errorf("unread after reading = %d, want 0", st.UnreadCount)
	}
}

func TestSystemMessagesCannotBeEditedOrDeleted(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.owner, r.ws.ID, "public", "雑談")
	log := systemLog(t, env, r.owner, room.ID)
	if len(log) != 1 {
		t.Fatalf("system messages = %d, want 1", len(log))
	}

	if _, err := env.Service.EditMessage(t.Context(), r.owner, room.ID, log[0].ID, "書き換え"); !errors.Is(err, chat.ErrForbidden) {
		t.Errorf("EditMessage(system) error = %v, want ErrForbidden", err)
	}
	if err := env.Service.DeleteMessage(t.Context(), r.owner, room.ID, log[0].ID); !errors.Is(err, chat.ErrForbidden) {
		t.Errorf("DeleteMessage(system) error = %v, want ErrForbidden", err)
	}
}

func TestDMHasNoSystemMessages(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)

	if log := systemLog(t, env, r.member, dm.ID); len(log) != 0 {
		t.Errorf("dm system messages = %+v, want none", log)
	}
}
