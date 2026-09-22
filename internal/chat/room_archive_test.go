package chat_test

import (
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// チャンネルのアーカイブと削除（ADR 0059）。

// archivedRoom は、member・member2 が参加した public ルームと、そこへの 1 件のメッセージを作ってからアーカイブする。
func archivedRoom(t *testing.T, env *chattest.Env) (roles, chat.Room, chat.Message) {
	t.Helper()
	r, room, msg := reactionRoom(t, env)
	if _, err := env.Service.ArchiveRoom(t.Context(), r.member, room.ID); err != nil {
		t.Fatalf("ArchiveRoom: %v", err)
	}
	return r, room, msg
}

// systemLogs はルームのシステムメッセージの種類を古い順に返す。
func systemLogs(t *testing.T, env *chattest.Env, actor, roomID ulid.ULID) []chat.SystemEventType {
	t.Helper()
	page, err := env.Service.ListMessages(t.Context(), actor, roomID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var types []chat.SystemEventType
	for _, m := range page.Messages {
		if m.System != nil {
			types = append(types, m.System.Type)
		}
	}
	return types
}

func TestArchiveRoom(t *testing.T) {
	env := chattest.New(t)
	r, room, _ := reactionRoom(t, env)
	env.Deliveries.Take()

	got, err := env.Service.ArchiveRoom(t.Context(), r.member, room.ID)
	if err != nil {
		t.Fatalf("ArchiveRoom: %v", err)
	}
	evs := env.Deliveries.Take()

	t.Run("archived_at が入り、一覧にも残る", func(t *testing.T) {
		if got.ArchivedAt == nil || !got.ArchivedAt.Equal(env.Clock.Now()) {
			t.Fatalf("archived_at = %v, want %v", got.ArchivedAt, env.Clock.Now())
		}
		rooms, err := env.Service.ListRooms(t.Context(), r.member2, r.ws.ID)
		if err != nil {
			t.Fatal(err)
		}
		i := slices.IndexFunc(rooms, func(x chat.Room) bool { return x.ID == room.ID })
		if i < 0 || rooms[i].ArchivedAt == nil {
			t.Fatalf("一覧にアーカイブ済みのルームが archived_at 付きで無い（i = %d）", i)
		}
	})

	t.Run("room.updated をルームとワークスペースに配り、購読は外さない", func(t *testing.T) {
		i := slices.IndexFunc(evs, func(e chat.Event) bool { return e.Type == chat.EventRoomUpdated })
		if i < 0 {
			t.Fatalf("events = %+v, want room.updated", evs)
		}
		ev := evs[i]
		if d := ev.Data.(chat.RoomUpdated); d.ArchivedAt == nil || d.RoomID != room.ID {
			t.Errorf("data = %+v", d)
		}
		if !slices.Equal(ev.To.Rooms, []ulid.ULID{room.ID}) || !slices.Equal(ev.To.Workspaces, []ulid.ULID{r.ws.ID}) {
			t.Errorf("to = %+v", ev.To)
		}
		if len(ev.AccessChanges) != 0 || len(ev.ClosedRooms) != 0 {
			t.Errorf("access changes = %v, closed rooms = %v, want none", ev.AccessChanges, ev.ClosedRooms)
		}
	})

	t.Run("アーカイブのログが最後の行になる", func(t *testing.T) {
		logs := systemLogs(t, env, r.member, room.ID)
		if len(logs) == 0 || logs[len(logs)-1] != chat.SystemRoomArchived {
			t.Fatalf("logs = %v, want last room_archived", logs)
		}
	})
}

// アーカイブ中は、ルームの状態を変える操作を 409（ErrRoomArchived）で止め、読むことと本人だけの状態の操作は許す（決定 2）。
func TestArchivedRoomOperations(t *testing.T) {
	env := chattest.New(t)
	r, room, msg := archivedRoom(t, env)
	ctx := t.Context()

	for _, tt := range []struct {
		name string
		do   func() error
	}{
		{"送信", func() error {
			_, _, err := env.Service.SendMessage(ctx, r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "まだ話したい"})
			return err
		}},
		{"スレッドへの返信", func() error {
			_, _, err := env.Service.SendMessage(ctx, r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "返信", ThreadRootID: &msg.ID})
			return err
		}},
		{"編集", func() error { _, err := env.Service.EditMessage(ctx, r.member, room.ID, msg.ID, "直す"); return err }},
		{"削除", func() error { return env.Service.DeleteMessage(ctx, r.member, room.ID, msg.ID) }},
		{"admin による他人の投稿の削除", func() error { return env.Service.DeleteMessage(ctx, r.admin, room.ID, msg.ID) }},
		{"リアクション", func() error { _, err := env.Service.AddReaction(ctx, r.member2, room.ID, msg.ID, "👍"); return err }},
		{"ピン留め", func() error { _, err := env.Service.PinMessage(ctx, r.member2, room.ID, msg.ID); return err }},
		{"添付のアップロード", func() error {
			_, err := env.Service.CreateAttachment(ctx, r.member, room.ID, textInput("a.txt", []byte("x")))
			return err
		}},
		{"参加", func() error { _, err := env.Service.JoinRoom(ctx, r.admin2, room.ID); return err }},
		{"名前の変更", func() error {
			name := "新しい名前"
			_, err := env.Service.UpdateRoom(ctx, r.admin, room.ID, chat.RoomUpdate{Name: &name})
			return err
		}},
		{"メンバーを外す", func() error { return env.Service.RemoveRoomMember(ctx, r.admin, room.ID, r.member2) }},
	} {
		t.Run(tt.name+"は 409", func(t *testing.T) {
			if err := tt.do(); !errors.Is(err, chat.ErrRoomArchived) {
				t.Fatalf("error = %v, want ErrRoomArchived", err)
			}
		})
	}

	t.Run("権限がない操作は、アーカイブ中でも 403 のまま", func(t *testing.T) {
		// member は他人の投稿を消せない。アーカイブの有無にかかわらず Forbidden（409 にして権限の有無を漏らさない）
		if err := env.Service.DeleteMessage(ctx, r.member2, room.ID, msg.ID); !errors.Is(err, chat.ErrForbidden) {
			t.Fatalf("error = %v, want ErrForbidden", err)
		}
	})

	t.Run("読むことと、本人だけの状態の操作はできる", func(t *testing.T) {
		if _, err := env.Service.ListMessages(ctx, r.admin2, room.ID, chat.MessageQuery{}); err != nil {
			t.Errorf("ListMessages: %v", err)
		}
		if _, err := env.Service.MarkRoomRead(ctx, r.member2, room.ID, msg.Seq); err != nil {
			t.Errorf("MarkRoomRead: %v", err)
		}
		if _, err := env.Service.SaveMessage(ctx, r.member2, room.ID, msg.ID); err != nil {
			t.Errorf("SaveMessage: %v", err)
		}
		if _, err := env.Service.SetRoomNotifications(ctx, r.member2, room.ID, chat.RoomNotifications{Muted: true}); err != nil {
			t.Errorf("SetRoomNotifications: %v", err)
		}
		// 自分で抜けるのもできる。退出のログは、アーカイブ中でも採番して残す
		if err := env.Service.RemoveRoomMember(ctx, r.member2, room.ID, r.member2); err != nil {
			t.Fatalf("leave: %v", err)
		}
		if logs := systemLogs(t, env, r.member, room.ID); logs[len(logs)-1] != chat.SystemMemberLeft {
			t.Errorf("logs = %v, want last member_left", logs)
		}
	})
}

func TestUnarchiveRoom(t *testing.T) {
	env := chattest.New(t)
	r, room, _ := archivedRoom(t, env)
	env.Deliveries.Take()

	got, err := env.Service.UnarchiveRoom(t.Context(), r.member2, room.ID)
	if err != nil {
		t.Fatalf("UnarchiveRoom: %v", err)
	}
	if got.ArchivedAt != nil {
		t.Fatalf("archived_at = %v, want nil", got.ArchivedAt)
	}
	evs := env.Deliveries.Take()
	i := slices.IndexFunc(evs, func(e chat.Event) bool { return e.Type == chat.EventRoomUpdated })
	if i < 0 || evs[i].Data.(chat.RoomUpdated).ArchivedAt != nil {
		t.Fatalf("events = %+v, want room.updated with archived_at = nil", evs)
	}
	if logs := systemLogs(t, env, r.member, room.ID); logs[len(logs)-1] != chat.SystemRoomUnarchived {
		t.Errorf("logs = %v, want last room_unarchived", logs)
	}
	// メンバーはそのままで、また投稿できる
	send(t, env, r.member2, room.ID, "戻りました")
}

// できる人と対象外（決定 1）。
func TestArchiveRoomPermissions(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	ctx := t.Context()

	public := createRoom(t, env, r.member, r.ws.ID, "public", "public")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private")
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	defaultRoom := env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{IsDefault: true})
	env.InsertRoomMember(t, defaultRoom, r.member)

	for _, tt := range []struct {
		name   string
		actor  ulid.ULID
		roomID ulid.ULID
		want   error
	}{
		{"参加していない member はアーカイブできない", r.member2, public.ID, chat.ErrForbidden},
		{"読めない private は admin でも見つからない", r.admin, private.ID, chat.ErrNotFound},
		{"DM は対象外", r.member, dm.ID, chat.ErrRoomProtected},
		{"既定のルームは対象外", r.member, defaultRoom, chat.ErrRoomProtected},
		{"参加していない admin は public をアーカイブできる", r.admin, public.ID, nil},
		{"アーカイブ済みはもう一度アーカイブできない", r.member, public.ID, chat.ErrRoomArchived},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := env.Service.ArchiveRoom(ctx, tt.actor, tt.roomID); !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
		})
	}

	t.Run("アーカイブされていないルームは復元できない", func(t *testing.T) {
		if _, err := env.Service.UnarchiveRoom(ctx, r.member, private.ID); !errors.Is(err, chat.ErrRoomNotArchived) {
			t.Fatalf("error = %v, want ErrRoomNotArchived", err)
		}
	})
	t.Run("参加していない member は復元できない", func(t *testing.T) {
		if _, err := env.Service.UnarchiveRoom(ctx, r.member2, public.ID); !errors.Is(err, chat.ErrForbidden) {
			t.Fatalf("error = %v, want ErrForbidden", err)
		}
	})
}

// アーカイブと送信が同時に起きても、アーカイブの後に投稿が紛れ込まない（決定 3）。
// 送信の採番とアーカイブが同じ rooms の行を更新するので、アーカイブのログより後ろの seq には人の発言がない。
func TestArchiveRoomConcurrentWithSends(t *testing.T) {
	env := chattest.New(t)
	r, room, _ := reactionRoom(t, env)
	ctx := t.Context()

	const senders = 20
	var (
		wg    sync.WaitGroup
		start = make(chan struct{})
		mu    sync.Mutex
		sent  []chat.Message
		other []error
	)
	for range senders {
		wg.Go(func() {
			<-start
			msg, _, err := env.Service.SendMessage(ctx, r.member2, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "駆け込み"})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				sent = append(sent, msg)
			case !errors.Is(err, chat.ErrRoomArchived):
				other = append(other, err)
			}
		})
	}
	var archiveErr error
	wg.Go(func() {
		<-start
		_, archiveErr = env.Service.ArchiveRoom(ctx, r.member, room.ID)
	})
	close(start)
	wg.Wait()

	if archiveErr != nil {
		t.Fatalf("ArchiveRoom: %v", archiveErr)
	}
	if len(other) > 0 {
		t.Fatalf("送信のエラー = %v, want ErrRoomArchived だけ", other)
	}
	page, err := env.Service.ListMessages(ctx, r.member, room.ID, chat.MessageQuery{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(page.Messages, func(m chat.Message) bool {
		return m.System != nil && m.System.Type == chat.SystemRoomArchived
	})
	if i < 0 {
		t.Fatal("アーカイブのログが無い")
	}
	archivedSeq := page.Messages[i].Seq
	for _, m := range sent {
		if m.Seq > archivedSeq {
			t.Errorf("seq %d の投稿がアーカイブ（seq %d）の後に入った", m.Seq, archivedSeq)
		}
	}
}

func TestDeleteRoom(t *testing.T) {
	env := chattest.New(t, chattest.WithClockStart(cleanupEpoch))
	r := setupRoles(t, env)
	ctx := t.Context()
	body := []byte("x")

	room := createRoom(t, env, r.member, r.ws.ID, "public", "to-delete")
	attached := uploadAttachment(t, env, r.member, room.ID, textInput("attached.txt", body), body)
	if _, _, err := env.Service.SendMessage(ctx, r.member, room.ID, chat.SendMessageInput{ClientMsgID: env.IDs.New(), AttachmentIDs: []ulid.ULID{attached.ID}}); err != nil {
		t.Fatal(err)
	}
	// URL を発行しただけの添付も対象にする。PUT は削除の後に行う（発行済みの URL が残っている場合）
	pending, err := env.Service.CreateAttachment(ctx, r.member, room.ID, textInput("pending.txt", body))
	if err != nil {
		t.Fatal(err)
	}
	keys := []string{objectKey(t, env, attached.ID), objectKey(t, env, pending.Attachment.ID)}

	t.Run("member は削除できない", func(t *testing.T) {
		if err := env.Service.DeleteRoom(ctx, r.member, room.ID); !errors.Is(err, chat.ErrForbidden) {
			t.Fatalf("error = %v, want ErrForbidden", err)
		}
	})

	env.Deliveries.Take()
	if err := env.Service.DeleteRoom(ctx, r.admin, room.ID); err != nil {
		t.Fatalf("DeleteRoom: %v", err)
	}
	evs := env.Deliveries.Take()

	t.Run("ルームは見つからなくなる", func(t *testing.T) {
		if _, err := env.Service.GetRoom(ctx, r.member, room.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Fatalf("GetRoom error = %v, want ErrNotFound", err)
		}
		if attachmentStatus(t, env, attached.ID) != "" {
			t.Error("添付の行が残っている")
		}
	})

	t.Run("room.deleted を配り、届けたあとでルームの購読を外させる", func(t *testing.T) {
		if len(evs) != 1 || evs[0].Type != chat.EventRoomDeleted {
			t.Fatalf("events = %+v, want 1 件の room.deleted", evs)
		}
		ev := evs[0]
		if !slices.Equal(ev.ClosedRooms, []ulid.ULID{room.ID}) {
			t.Errorf("closed rooms = %v", ev.ClosedRooms)
		}
		if !slices.Equal(ev.To.Rooms, []ulid.ULID{room.ID}) || !slices.Equal(ev.To.Workspaces, []ulid.ULID{r.ws.ID}) || len(ev.To.Users) != 0 {
			t.Errorf("to = %+v, want room と workspace", ev.To)
		}
	})

	// 発行済みの URL で、削除の後にオブジェクトが置かれる
	if status := putUpload(t, pending.Upload, body); status != 200 {
		t.Fatalf("PUT status = %d", status)
	}

	t.Run("猶予（15 分）の前は、オブジェクトを消さない", func(t *testing.T) {
		env.Clock.Advance(15*time.Minute - time.Second)
		if _, err := env.Service.CleanupAttachments(ctx); err != nil {
			t.Fatal(err)
		}
		for _, key := range keys {
			if !objectExists(t, env, key) {
				t.Errorf("object %s was deleted before the delay", key)
			}
		}
	})

	t.Run("猶予を過ぎると、削除の後に置かれたものも含めて消える", func(t *testing.T) {
		env.Clock.Advance(time.Second)
		if _, err := env.Service.CleanupAttachments(ctx); err != nil {
			t.Fatal(err)
		}
		for _, key := range keys {
			if objectExists(t, env, key) {
				t.Errorf("object %s still exists", key)
			}
		}
		var left int
		if err := env.Pool.QueryRow(ctx, `SELECT count(*) FROM storage_deletions WHERE object_key = ANY($1)`, keys).Scan(&left); err != nil {
			t.Fatal(err)
		}
		if left != 0 {
			t.Errorf("storage_deletions に %d 行残っている", left)
		}
	})
}

func TestDeleteRoomTargets(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	ctx := t.Context()

	t.Run("private は、ワークスペースではなく削除した時点のメンバーに届ける", func(t *testing.T) {
		private := createRoom(t, env, r.admin, r.ws.ID, "private", "secret")
		if err := env.Service.AddRoomMember(ctx, r.admin, private.ID, r.member); err != nil {
			t.Fatal(err)
		}
		env.Deliveries.Take()
		if err := env.Service.DeleteRoom(ctx, r.admin, private.ID); err != nil {
			t.Fatal(err)
		}
		evs := env.Deliveries.Take()
		if len(evs) != 1 {
			t.Fatalf("events = %+v", evs)
		}
		to := evs[0].To
		slices.SortFunc(to.Users, ulid.ULID.Compare)
		want := []ulid.ULID{r.admin, r.member}
		slices.SortFunc(want, ulid.ULID.Compare)
		if len(to.Workspaces) != 0 || !slices.Equal(to.Users, want) {
			t.Errorf("to = %+v, want users %v", to, want)
		}
	})

	t.Run("アーカイブ中でも削除できる", func(t *testing.T) {
		room := createRoom(t, env, r.member, r.ws.ID, "public", "archived-then-deleted")
		if _, err := env.Service.ArchiveRoom(ctx, r.member, room.ID); err != nil {
			t.Fatal(err)
		}
		if err := env.Service.DeleteRoom(ctx, r.owner, room.ID); err != nil {
			t.Fatalf("DeleteRoom: %v", err)
		}
	})

	t.Run("DM と既定のルームは対象外", func(t *testing.T) {
		dm, _ := createDM(t, env, r.admin, r.ws.ID, r.member)
		if err := env.Service.DeleteRoom(ctx, r.admin, dm.ID); !errors.Is(err, chat.ErrRoomProtected) {
			t.Errorf("dm: error = %v, want ErrRoomProtected", err)
		}
		defaultRoom := env.InsertRoom(t, r.ws.ID, r.owner, chattest.RoomOptions{IsDefault: true})
		if err := env.Service.DeleteRoom(ctx, r.admin, defaultRoom); !errors.Is(err, chat.ErrRoomProtected) {
			t.Errorf("default: error = %v, want ErrRoomProtected", err)
		}
	})
}
