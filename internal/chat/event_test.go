package chat_test

import (
	"slices"
	"testing"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// ユースケースがコミットの後に、どのイベントを誰に宛てて配信するか（docs/events.md の「宛先」の列）を確かめる。
// 接続への解決（Hub）は internal/chat/realtime のテストで確かめる。

func idList(v ...ulid.ULID) []ulid.ULID { return v }

// expectEvents は配信されたイベントの種類と宛先が want と一致することを確かめ、イベントを返す。
func expectEvents(t *testing.T, env *chattest.Env, want ...chat.Event) []chat.Event {
	t.Helper()
	got := env.Deliveries.Take()
	if len(got) != len(want) {
		types := make([]chat.EventType, len(got))
		for i, ev := range got {
			types[i] = ev.Type
		}
		t.Fatalf("delivered %d events %v, want %d", len(got), types, len(want))
	}
	for i := range want {
		g, w := got[i], want[i]
		if g.Type != w.Type || !sameIDs(g.To.Rooms, w.To.Rooms) || !sameIDs(g.To.Workspaces, w.To.Workspaces) ||
			!sameIDs(g.To.Users, w.To.Users) || g.To.ExceptUser != w.To.ExceptUser || !slices.Equal(g.AccessChanges, w.AccessChanges) {
			t.Errorf("event[%d] = %s to %+v (access changes %v), want %s to %+v (access changes %v)",
				i, g.Type, g.To, g.AccessChanges, w.Type, w.To, w.AccessChanges)
		}
	}
	return got
}

func sameIDs(a, b []ulid.ULID) bool {
	a, b = slices.Clone(a), slices.Clone(b)
	slices.SortFunc(a, ulid.ULID.Compare)
	slices.SortFunc(b, ulid.ULID.Compare)
	return slices.Equal(a, b)
}

func TestMessageEvents(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	env.Deliveries.Take()
	toRoom := chat.Audience{Rooms: idList(room.ID)}

	msg := send(t, env, r.member, room.ID, "こんにちは")
	evs := expectEvents(t, env, chat.Event{Type: chat.EventMessageCreated, To: toRoom})
	if m := evs[0].Data.(chat.Message); m.ID != msg.ID || m.ChangeSeq != msg.ChangeSeq || m.Body != "こんにちは" {
		t.Errorf("message.created data = %+v", m)
	}
	// 冪等な再送は配信しない（最初の送信で配信済み）。
	if _, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: msg.ClientMsgID, Body: "こんにちは"}); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env)

	if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, "こんばんは"); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env, chat.Event{Type: chat.EventMessageUpdated, To: toRoom})
	if m := evs[0].Data.(chat.Message); m.Body != "こんばんは" || m.ChangeSeq != msg.ChangeSeq+1 {
		t.Errorf("message.updated data = %+v", m)
	}
	// 本文が変わらない編集は配信しない。
	if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, "こんばんは"); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env)

	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env, chat.Event{Type: chat.EventMessageDeleted, To: toRoom})
	if m := evs[0].Data.(chat.Message); m.Body != "" || m.DeletedAt == nil || m.ChangeSeq != msg.ChangeSeq+2 {
		t.Errorf("message.deleted data = %+v, want a tombstone", m)
	}
	// 削除済みへの削除は配信しない。
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env)

	// 拒否された操作は配信しない。
	if _, _, err := env.Service.SendMessage(t.Context(), r.owner, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "未参加"}); err == nil {
		t.Fatal("non-member could post")
	}
	expectEvents(t, env)

	// 既読位置は本人のすべての接続に届ける。
	send(t, env, r.member, room.ID, "2 件目")
	if _, err := env.Service.JoinRoom(t.Context(), r.admin, room.ID); err != nil {
		t.Fatal(err)
	}
	env.Deliveries.Take()
	// 最新はルームの作成・参加のログ（ADR 0033）も含んだ seq。既読にすれば未読は 0 になる。
	latest := roomLastMessageSeq(t, env, room.ID)
	if _, err := env.Service.MarkRoomRead(t.Context(), r.admin, room.ID, latest); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env, chat.Event{Type: chat.EventRoomRead, To: chat.Audience{Users: idList(r.admin)}})
	if d := evs[0].Data.(chat.RoomRead); d.RoomID != room.ID || d.WorkspaceID != r.ws.ID || d.LastReadSeq != latest || d.UnreadCount != 0 {
		t.Errorf("room.read data = %+v", d)
	}
}

// systemMessageEvent は、システムメッセージ（ADR 0033）がルームの購読者に届く message.created の期待値。
// 参加・退出・名前の変更では、元からのイベントに加えてこれが 1 件増える。
func systemMessageEvent(roomID ulid.ULID) chat.Event {
	return chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: idList(roomID)}}
}

func TestRoomEvents(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)

	// 作成者はまだ購読していないので、本人にも member.joined が届く。
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	evs := expectEvents(t, env, chat.Event{Type: chat.EventMemberJoined, To: chat.Audience{Rooms: idList(public.ID), Users: idList(r.member)}})
	if d := evs[0].Data.(chat.MemberJoined); d.RoomID != public.ID || d.WorkspaceID != r.ws.ID || d.User.ID != r.member || d.User.DisplayName == "" {
		t.Errorf("member.joined data = %+v", d)
	}

	// DM は入った 2 人の両方に。既存の DM を開き直しても、誰も新しく入らなければ配信しない。
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	var joined []ulid.ULID
	for _, ev := range env.Deliveries.Take() {
		if ev.Type != chat.EventMemberJoined || !sameIDs(ev.To.Rooms, idList(dm.ID)) || len(ev.To.Users) != 1 || ev.Data.(chat.MemberJoined).User.ID != ev.To.Users[0] {
			t.Errorf("dm event = %+v", ev)
			continue
		}
		joined = append(joined, ev.To.Users[0])
	}
	if !sameIDs(joined, idList(r.member, r.member2)) {
		t.Errorf("dm member.joined users = %v, want both", joined)
	}
	createDM(t, env, r.member2, r.ws.ID, r.member)
	expectEvents(t, env)

	// 参加・追加は冪等で、2 回目は配信しない。
	for range 2 {
		if _, err := env.Service.JoinRoom(t.Context(), r.admin, public.ID); err != nil {
			t.Fatal(err)
		}
	}
	expectEvents(t, env,
		chat.Event{Type: chat.EventMemberJoined, To: chat.Audience{Rooms: idList(public.ID), Users: idList(r.admin)}},
		systemMessageEvent(public.ID))
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	env.Deliveries.Take()
	for range 2 {
		if err := env.Service.AddRoomMember(t.Context(), r.member, private.ID, r.admin2); err != nil {
			t.Fatal(err)
		}
	}
	expectEvents(t, env,
		chat.Event{Type: chat.EventMemberJoined, To: chat.Audience{Rooms: idList(private.ID), Users: idList(r.admin2)}},
		systemMessageEvent(private.ID))

	// 名前の変更は、public ならワークスペースの購読者にも。
	name := "改名"
	if _, err := env.Service.UpdateRoom(t.Context(), r.admin, public.ID, chat.RoomUpdate{Name: &name}); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env,
		chat.Event{Type: chat.EventRoomUpdated, To: chat.Audience{Rooms: idList(public.ID), Workspaces: idList(r.ws.ID)}},
		// 名前を変えたログはルームの購読者だけに届く（サイドバーの更新は room.updated が担う）。
		systemMessageEvent(public.ID))
	if d := evs[0].Data.(chat.RoomUpdated); d.Name != "改名" || d.RoomID != public.ID {
		t.Errorf("room.updated data = %+v", d)
	}
	if m := evs[1].Data.(chat.Message); m.System == nil || m.System.Type != chat.SystemRoomRenamed || m.System.NewName != "改名" {
		t.Errorf("room_renamed data = %+v", m.System)
	}
	privateName := "改名（非公開）"
	if _, err := env.Service.UpdateRoom(t.Context(), r.admin2, private.ID, chat.RoomUpdate{Name: &privateName}); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env,
		chat.Event{Type: chat.EventRoomUpdated, To: chat.Audience{Rooms: idList(private.ID)}},
		systemMessageEvent(private.ID))

	// 外された本人の購読を先に再検証させ、本人には room.member_removed、ルームの購読者には member.left。
	if err := env.Service.RemoveRoomMember(t.Context(), r.admin2, private.ID, r.member); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env,
		chat.Event{
			Type: chat.EventRoomMemberRemoved, To: chat.Audience{Users: idList(r.member)},
			AccessChanges: []chat.AccessChange{{UserID: r.member, WorkspaceID: r.ws.ID}},
		},
		chat.Event{Type: chat.EventMemberLeft, To: chat.Audience{Rooms: idList(private.ID)}},
		systemMessageEvent(private.ID),
	)
	if m := evs[2].Data.(chat.Message); m.System == nil || m.System.Type != chat.SystemMemberRemoved || m.Sender.ID != r.member {
		t.Errorf("member_removed log = %+v (sender %s)", m.System, m.Sender.ID)
	}
	if d := evs[0].Data.(chat.RoomMemberRemoved); d.Reason != chat.RemovalRemoved || d.RoomID != private.ID {
		t.Errorf("room.member_removed data = %+v", d)
	}
	if d := evs[1].Data.(chat.MemberLeft); d.UserID != r.member || d.RoomID != private.ID {
		t.Errorf("member.left data = %+v", d)
	}
	// 自分で抜けたら reason は left。
	if err := env.Service.RemoveRoomMember(t.Context(), r.admin, public.ID, r.admin); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env,
		chat.Event{
			Type: chat.EventRoomMemberRemoved, To: chat.Audience{Users: idList(r.admin)},
			AccessChanges: []chat.AccessChange{{UserID: r.admin, WorkspaceID: r.ws.ID}},
		},
		chat.Event{Type: chat.EventMemberLeft, To: chat.Audience{Rooms: idList(public.ID)}},
		systemMessageEvent(public.ID),
	)
	if d := evs[0].Data.(chat.RoomMemberRemoved); d.Reason != chat.RemovalLeft {
		t.Errorf("reason = %s, want left", d.Reason)
	}
	if m := evs[2].Data.(chat.Message); m.System == nil || m.System.Type != chat.SystemMemberLeft || m.Sender.ID != r.admin {
		t.Errorf("member_left log = %+v (sender %s)", m.System, m.Sender.ID)
	}
}

func TestWorkspaceEvents(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	toWorkspace := chat.Audience{Workspaces: idList(r.ws.ID)}

	name := "新しい名前"
	if _, err := env.Service.UpdateWorkspace(t.Context(), r.admin, r.ws.ID, chat.WorkspaceUpdate{Name: &name}); err != nil {
		t.Fatal(err)
	}
	evs := expectEvents(t, env, chat.Event{Type: chat.EventWorkspaceUpdated, To: toWorkspace})
	if d := evs[0].Data.(chat.WorkspaceUpdated); d.Name != name || d.InvitePolicy != authz.InvitePolicyAdminsOnly {
		t.Errorf("workspace.updated data = %+v", d)
	}

	// ロールの変更はワークスペースの購読者と本人に。変わらなければ配信しない。
	if _, err := env.Service.ChangeMemberRole(t.Context(), r.owner, r.ws.ID, r.member, "admin"); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env, chat.Event{
		Type: chat.EventWorkspaceRoleChanged, To: chat.Audience{Workspaces: idList(r.ws.ID), Users: idList(r.member)},
		AccessChanges: []chat.AccessChange{{UserID: r.member, WorkspaceID: r.ws.ID}},
	})
	if d := evs[0].Data.(chat.WorkspaceRoleChanged); d.UserID != r.member || d.Role != authz.RoleAdmin {
		t.Errorf("workspace.role_changed data = %+v", d)
	}
	if _, err := env.Service.ChangeMemberRole(t.Context(), r.owner, r.ws.ID, r.member, "admin"); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env)

	// 譲渡では 2 人分。
	if err := env.Service.TransferOwnership(t.Context(), r.owner, r.ws.ID, r.admin); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env,
		chat.Event{
			Type: chat.EventWorkspaceRoleChanged, To: chat.Audience{Workspaces: idList(r.ws.ID), Users: idList(r.owner)},
			AccessChanges: []chat.AccessChange{{UserID: r.owner, WorkspaceID: r.ws.ID}},
		},
		chat.Event{
			Type: chat.EventWorkspaceRoleChanged, To: chat.Audience{Workspaces: idList(r.ws.ID), Users: idList(r.admin)},
			AccessChanges: []chat.AccessChange{{UserID: r.admin, WorkspaceID: r.ws.ID}},
		},
	)
	if evs[0].Data.(chat.WorkspaceRoleChanged).Role != authz.RoleAdmin || evs[1].Data.(chat.WorkspaceRoleChanged).Role != authz.RoleOwner {
		t.Errorf("transfer roles = %+v, %+v", evs[0].Data, evs[1].Data)
	}

	// キック: 本人の購読を再検証させてから、ワークスペースと本人に。外れたルームの購読者には member.left。
	public := createRoom(t, env, r.member2, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member2, r.ws.ID, "private", "private")
	env.Deliveries.Take()
	if err := env.Service.RemoveMember(t.Context(), r.admin, r.ws.ID, r.member2); err != nil {
		t.Fatal(err)
	}
	evs = env.Deliveries.Take()
	if len(evs) != 3 {
		t.Fatalf("delivered %d events, want 3", len(evs))
	}
	if ev := evs[0]; ev.Type != chat.EventWorkspaceMemberRemoved || !sameIDs(ev.To.Workspaces, idList(r.ws.ID)) || !sameIDs(ev.To.Users, idList(r.member2)) ||
		!slices.Equal(ev.AccessChanges, []chat.AccessChange{{UserID: r.member2, WorkspaceID: r.ws.ID}}) ||
		ev.Data.(chat.WorkspaceMemberRemoved).Reason != chat.RemovalRemoved {
		t.Errorf("first event = %+v, want workspace.member_removed with access change", ev)
	}
	var leftRooms []ulid.ULID
	for _, ev := range evs[1:] {
		if ev.Type != chat.EventMemberLeft || len(ev.To.Rooms) != 1 || ev.Data.(chat.MemberLeft).UserID != r.member2 {
			t.Errorf("event = %+v, want member.left", ev)
			continue
		}
		leftRooms = append(leftRooms, ev.To.Rooms[0])
	}
	if !sameIDs(leftRooms, idList(public.ID, private.ID)) {
		t.Errorf("member.left rooms = %v, want %v", leftRooms, idList(public.ID, private.ID))
	}

	// 自分で退出したら reason は left。
	if err := env.Service.RemoveMember(t.Context(), r.admin2, r.ws.ID, r.admin2); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env, chat.Event{
		Type: chat.EventWorkspaceMemberRemoved, To: chat.Audience{Workspaces: idList(r.ws.ID), Users: idList(r.admin2)},
		AccessChanges: []chat.AccessChange{{UserID: r.admin2, WorkspaceID: r.ws.ID}},
	})
	if evs[0].Data.(chat.WorkspaceMemberRemoved).Reason != chat.RemovalLeft {
		t.Errorf("reason = %+v, want left", evs[0].Data)
	}
}

func TestAcceptInviteEvents(t *testing.T) {
	env := chattest.New(t)
	owner, guest := env.CreateUser(t), env.CreateUser(t)
	ws := env.CreateWorkspace(t, owner)
	general := env.InsertRoom(t, ws.ID, owner, chattest.RoomOptions{IsDefault: true})
	announce := env.InsertRoom(t, ws.ID, owner, chattest.RoomOptions{IsDefault: true})
	env.InsertRoom(t, ws.ID, owner, chattest.RoomOptions{})
	inv := createInvite(t, env, owner, ws.ID, nil, *week())
	env.Deliveries.Take()

	if _, err := env.Service.AcceptInvite(t.Context(), guest, inv.Code); err != nil {
		t.Fatal(err)
	}
	// default ルームごとに、本人とルームの購読者へ member.joined。加えて「参加しました」のログ（ADR 0033）。
	evs := env.Deliveries.Take()
	var rooms, loggedRooms []ulid.ULID
	for _, ev := range evs {
		if ev.Type == chat.EventMessageCreated {
			m, ok := ev.Data.(chat.Message)
			if !ok || m.Kind != chat.MessageKindSystem || m.System == nil || m.System.Type != chat.SystemMemberJoined ||
				m.Sender.ID != guest || !sameIDs(ev.To.Rooms, idList(m.RoomID)) {
				t.Errorf("system message event = %+v", ev)
				continue
			}
			loggedRooms = append(loggedRooms, m.RoomID)
			continue
		}
		d, ok := ev.Data.(chat.MemberJoined)
		if ev.Type != chat.EventMemberJoined || !ok || d.User.ID != guest || !sameIDs(ev.To.Users, idList(guest)) || !sameIDs(ev.To.Rooms, idList(d.RoomID)) {
			t.Errorf("event = %+v", ev)
			continue
		}
		rooms = append(rooms, d.RoomID)
	}
	if !sameIDs(rooms, idList(general, announce)) {
		t.Errorf("joined rooms = %v, want %v", rooms, idList(general, announce))
	}
	if !sameIDs(loggedRooms, idList(general, announce)) {
		t.Errorf("logged rooms = %v, want %v", loggedRooms, idList(general, announce))
	}
	// すでにメンバーなら何も起きない。
	if _, err := env.Service.AcceptInvite(t.Context(), guest, inv.Code); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env)
}

// スレッド（ADR 0036）: 返信はルームの購読者に message.created、親の返信数は message.updated で届く。
// 参加（thread.followed）と既読（thread.read）は本人に届く。
func TestThreadEvents(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	if _, err := env.Service.JoinRoom(t.Context(), r.member2, room.ID); err != nil {
		t.Fatal(err)
	}
	root := send(t, env, r.member, room.ID, "親")
	env.Deliveries.Take()
	toRoom := chat.Audience{Rooms: idList(room.ID)}

	// 最初の返信: 返信した人と親の投稿者が参加する。
	first := reply(t, env, r.member2, room.ID, root.ID, "返信 1")
	evs := expectEvents(t, env,
		chat.Event{Type: chat.EventMessageCreated, To: toRoom},
		chat.Event{Type: chat.EventMessageUpdated, To: toRoom},
		chat.Event{Type: chat.EventThreadFollowed, To: chat.Audience{Users: idList(r.member2)}},
		chat.Event{Type: chat.EventThreadFollowed, To: chat.Audience{Users: idList(r.member)}},
	)
	if m := evs[0].Data.(chat.Message); m.ID != first.ID || m.ThreadRootID == nil || *m.ThreadRootID != root.ID {
		t.Errorf("message.created data = %+v", m)
	}
	// 親の更新は、返信の次の change_seq を持つ（クライアントはこの順に反映できる）。
	if m := evs[1].Data.(chat.Message); m.ID != root.ID || m.Thread == nil || m.Thread.ReplyCount != 1 || m.ChangeSeq != first.ChangeSeq+1 {
		t.Errorf("message.updated data = %+v", m)
	}
	if d := evs[2].Data.(chat.ThreadFollowed); d.ThreadRootID != root.ID || d.RoomID != room.ID || d.WorkspaceID != r.ws.ID || d.LastReadThreadSeq != 1 {
		t.Errorf("thread.followed (replier) = %+v", d)
	}
	if d := evs[3].Data.(chat.ThreadFollowed); d.LastReadThreadSeq != 0 {
		t.Errorf("thread.followed (root sender) = %+v", d)
	}

	// 参加済みの人の返信では、参加のイベントは出ない。
	second := reply(t, env, r.member, room.ID, root.ID, "返信 2")
	expectEvents(t, env, chat.Event{Type: chat.EventMessageCreated, To: toRoom}, chat.Event{Type: chat.EventMessageUpdated, To: toRoom})
	// 冪等な再送は配信しない。
	if _, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID, chat.SendMessageInput{ClientMsgID: second.ClientMsgID, Body: "返信 2", ThreadRootID: &root.ID}); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env)

	// 返信の削除: tombstone の後に、返信数が減った親。
	if err := env.Service.DeleteMessage(t.Context(), r.member2, room.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env, chat.Event{Type: chat.EventMessageDeleted, To: toRoom}, chat.Event{Type: chat.EventMessageUpdated, To: toRoom})
	if m := evs[1].Data.(chat.Message); m.ID != root.ID || m.Thread.ReplyCount != 1 || m.ChangeSeq != evs[0].Data.(chat.Message).ChangeSeq+1 {
		t.Errorf("message.updated after delete = %+v", m)
	}

	// 既読は本人のすべての接続に届ける。参加していない人の既読は何も起きない。
	if _, err := env.Service.MarkThreadRead(t.Context(), r.member2, room.ID, root.ID, second.Seq); err != nil {
		t.Fatal(err)
	}
	evs = expectEvents(t, env, chat.Event{Type: chat.EventThreadRead, To: chat.Audience{Users: idList(r.member2)}})
	if d := evs[0].Data.(chat.ThreadRead); d.ThreadRootID != root.ID || d.LastReadThreadSeq != 2 || d.UnreadCount != 0 || d.WorkspaceID != r.ws.ID {
		t.Errorf("thread.read data = %+v", d)
	}
	if _, err := env.Service.JoinRoom(t.Context(), r.admin, room.ID); err != nil {
		t.Fatal(err)
	}
	env.Deliveries.Take()
	if _, err := env.Service.MarkThreadRead(t.Context(), r.admin, room.ID, root.ID, second.Seq); err != nil {
		t.Fatal(err)
	}
	expectEvents(t, env)
}
