package realtime

import (
	"crypto/rand"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

var testIDs = id.NewGenerator(clock.NewFake(time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)), rand.Reader)

func TestWireRoundTrip(t *testing.T) {
	u := func() ulid.ULID { return testIDs.New() }
	at := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	edited := at.Add(time.Minute)
	width := 640
	user := chat.UserProfile{ID: u(), Handle: "alice", DisplayName: "Alice"}
	threadRootID, threadSeq := u(), int64(3)
	message := chat.Message{
		ID: u(), RoomID: u(), Seq: 42, ChangeSeq: 50, Sender: user, ClientMsgID: u(), Body: "こんにちは",
		ThreadRootID: &threadRootID, ThreadSeq: &threadSeq,
		Thread:      &chat.ThreadSummary{ReplyCount: 2, LastThreadSeq: 3, LastReplyAt: at},
		Attachments: []chat.MessageAttachment{{ID: u(), FileName: "a.png", ContentType: "image/png", SizeBytes: 10, Width: &width}},
		CreatedAt:   at, EditedAt: &edited,
	}

	// すべてのイベントの種類を 1 つずつ。種類を足したら、ここと dataDecoders の両方に足す。
	events := []chat.Event{
		{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{message.RoomID}}, Data: message},
		{Type: chat.EventMessageUpdated, To: chat.Audience{Rooms: []ulid.ULID{message.RoomID}}, Data: message},
		// 添付のないメッセージは、store と同じく空のスライスで持つ。encoding/json/v2 は nil のスライスを [] にするので、
		// nil を送ると空のスライスとして戻る（どちらも len が 0 で、配信の処理は区別しない）。
		{Type: chat.EventMessageDeleted, To: chat.Audience{Rooms: []ulid.ULID{message.RoomID}}, Data: chat.Message{ID: u(), Attachments: []chat.MessageAttachment{}, DeletedAt: &edited}},
		{Type: chat.EventMemberJoined, To: chat.Audience{Rooms: []ulid.ULID{u()}, Users: []ulid.ULID{user.ID}}, Data: chat.MemberJoined{WorkspaceID: u(), RoomID: u(), User: user}},
		{Type: chat.EventMemberLeft, To: chat.Audience{Rooms: []ulid.ULID{u()}}, Data: chat.MemberLeft{WorkspaceID: u(), RoomID: u(), UserID: u()}},
		{Type: chat.EventRoomUpdated, To: chat.Audience{Rooms: []ulid.ULID{u()}, Workspaces: []ulid.ULID{u()}}, Data: chat.RoomUpdated{WorkspaceID: u(), RoomID: u(), Name: "general", IsDefault: true}},
		{
			Type: chat.EventRoomMemberRemoved, To: chat.Audience{Users: []ulid.ULID{user.ID}},
			AccessChanges: []chat.AccessChange{{UserID: user.ID, WorkspaceID: u()}},
			Data:          chat.RoomMemberRemoved{WorkspaceID: u(), RoomID: u(), Reason: chat.RemovalRemoved},
		},
		{Type: chat.EventRoomRead, To: chat.Audience{Users: []ulid.ULID{user.ID}}, Data: chat.RoomRead{WorkspaceID: u(), RoomID: u(), LastReadSeq: 3, UnreadCount: 2}},
		{Type: chat.EventWorkspaceUpdated, To: chat.Audience{Workspaces: []ulid.ULID{u()}}, Data: chat.WorkspaceUpdated{WorkspaceID: u(), Name: "hibari", InvitePolicy: "all_members"}},
		{
			Type: chat.EventWorkspaceMemberRemoved, To: chat.Audience{Workspaces: []ulid.ULID{u()}, Users: []ulid.ULID{user.ID}},
			AccessChanges: []chat.AccessChange{{UserID: user.ID, WorkspaceID: u()}},
			Data:          chat.WorkspaceMemberRemoved{WorkspaceID: u(), UserID: user.ID, Reason: chat.RemovalLeft},
		},
		{Type: chat.EventWorkspaceRoleChanged, To: chat.Audience{Workspaces: []ulid.ULID{u()}}, Data: chat.WorkspaceRoleChanged{WorkspaceID: u(), UserID: u(), Role: "admin"}},
		{Type: chat.EventPresenceChanged, To: chat.Audience{Workspaces: []ulid.ULID{u(), u()}}, Data: chat.PresenceChanged{UserID: u(), Online: true}},
		{Type: chat.EventTypingStarted, To: chat.Audience{Rooms: []ulid.ULID{u()}, ExceptUser: user.ID}, Data: chat.TypingStarted{WorkspaceID: u(), RoomID: u(), User: user}},
	}
	if len(events) != len(dataDecoders) {
		t.Fatalf("test covers %d event types, dataDecoders has %d", len(events), len(dataDecoders))
	}

	for _, ev := range events {
		t.Run(string(ev.Type), func(t *testing.T) {
			eventID := u()
			b, err := encodeWire(ev, eventID, 3)
			if err != nil {
				t.Fatal(err)
			}
			w, got, err := decodeWire(b)
			if err != nil {
				t.Fatal(err)
			}
			if w.ID != eventID || w.Fanout != 3 {
				t.Errorf("id, fanout = %v, %d; want %v, 3", w.ID, w.Fanout, eventID)
			}
			if !reflect.DeepEqual(got, ev) {
				t.Errorf("decoded event = %+v\nwant %+v", got, ev)
			}
		})
	}
}

func TestDecodeWireRejectsUnknown(t *testing.T) {
	for name, payload := range map[string]string{
		"not json":        `{`,
		"other version":   `{"v":2,"type":"message.created","data":{}}`,
		"unknown type":    `{"v":1,"type":"reaction.added","data":{}}`,
		"mismatched data": `{"v":1,"type":"presence.changed","data":"online"}`,
	} {
		if _, _, err := decodeWire([]byte(payload)); err == nil {
			t.Errorf("%s: decodeWire() error = nil", name)
		}
	}
}

func TestChannelsFor(t *testing.T) {
	room, ws, alice, bob := testIDs.New(), testIDs.New(), testIDs.New(), testIDs.New()
	got := channelsFor(chat.Event{
		To: chat.Audience{Rooms: []ulid.ULID{room}, Workspaces: []ulid.ULID{ws}, Users: []ulid.ULID{alice, alice}, ExceptUser: bob},
		// 権限が変わったユーザーのチャンネルにも流す（そのユーザーの接続を持つインスタンスが再検証する）。宛先と重なっても 1 回だけ。
		AccessChanges: []chat.AccessChange{{UserID: alice, WorkspaceID: ws}, {UserID: bob, WorkspaceID: ws}},
	})
	want := []string{"room:" + room.String(), "workspace:" + ws.String(), "user:" + alice.String(), "user:" + bob.String()}
	if !slices.Equal(got, want) {
		t.Fatalf("channelsFor() = %v, want %v", got, want)
	}
}

func TestRecentIDs(t *testing.T) {
	r := newRecentIDs(2)
	a, b, c := testIDs.New(), testIDs.New(), testIDs.New()
	if r.seen(a) || r.seen(b) {
		t.Fatal("new ids reported as seen")
	}
	if !r.seen(a) {
		t.Fatal("a not remembered")
	}
	// 容量を超えたら古いものから忘れる。
	if r.seen(c) || r.seen(a) {
		t.Fatal("c should be new and a should have been evicted")
	}
}
