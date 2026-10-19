package chat_test

import (
	"encoding/json/v2"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// プッシュ通知を送る相手と中身（ADR 0069 決定 5・6・7）。送る処理そのもの（PushDelivery）は構築順 5。

// subscribePush は user に購読を 1 つ登録する（どのセッションでもよい）。
func subscribePush(t *testing.T, env *chattest.Env, user ulid.ULID) {
	t.Helper()
	if _, err := env.Service.RegisterPushSubscription(t.Context(), user, env.IDs.New(), newPushInput(t)); err != nil {
		t.Fatal(err)
	}
}

func messageCreated(m chat.Message) chat.Event {
	return chat.Event{Type: chat.EventMessageCreated, To: chat.Audience{Rooms: []ulid.ULID{m.RoomID}}, Data: m}
}

// pushesFor は ev から決まる通知のうち、user 宛てのもの。
func pushesFor(t *testing.T, env *chattest.Env, ev chat.Event, user ulid.ULID) []chat.PushNotification {
	t.Helper()
	all, err := env.Service.PushNotifications(t.Context(), ev)
	if err != nil {
		t.Fatalf("PushNotifications: %v", err)
	}
	return slices.DeleteFunc(all, func(n chat.PushNotification) bool { return n.UserID != user })
}

func decodePayload(t *testing.T, n chat.PushNotification) chat.PushPayload {
	t.Helper()
	var p chat.PushPayload
	if err := json.Unmarshal(n.Message.Payload, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// TestPushNotificationRules は、規則の表（testdata/notification-rules.json）の notify のとおりに送ることを、
// 実物の DB の設定と参加者で確かめる。表はクライアントの shouldNotify のテストと共有している（決定 5）。
// presence は実物（誰も接続していないので全員 offline）。
func TestPushNotificationRules(t *testing.T) {
	env := chattest.New(t)
	for i, c := range loadRuleCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			u := env.CreateUsers(t, 2)
			me, other := u[0], u[1]
			ws := env.CreateWorkspace(t, other)
			env.AddMember(t, ws.ID, me, authz.RoleMember)
			subscribePush(t, env, me)
			subscribePush(t, env, other)

			var room chat.Room
			if c.Room == "dm" {
				room, _ = createDM(t, env, other, ws.ID, me)
			} else {
				room = createRoom(t, env, other, ws.ID, "public", fmt.Sprintf("push-rules-%d", i))
				if _, err := env.Service.JoinRoom(t.Context(), me, room.ID); err != nil {
					t.Fatal(err)
				}
			}
			exec := func(sql string, args ...any) {
				t.Helper()
				if _, err := env.Pool.Exec(t.Context(), sql, args...); err != nil {
					t.Fatal(err)
				}
			}
			exec(`UPDATE workspace_members SET notify_level = $1 WHERE workspace_id = $2 AND user_id = $3`, c.Global, ws.ID, me)
			exec(`UPDATE room_members SET notify_level = $1 WHERE room_id = $2 AND user_id = $3`, c.RoomLevel, room.ID, me)
			switch c.Muted {
			case "forever":
				exec(`UPDATE room_members SET muted = true, muted_until = NULL WHERE room_id = $1 AND user_id = $2`, room.ID, me)
			case "expired":
				exec(`UPDATE room_members SET muted = true, muted_until = $1 WHERE room_id = $2 AND user_id = $3`,
					env.Clock.Now().Add(-time.Hour), room.ID, me)
			}

			body := "本文"
			if c.Mention != nil {
				switch *c.Mention {
				case "user":
					body = at(me) + " 見てください"
				case "channel":
					body = "<!channel> 見てください"
				case "here":
					body = "<!here> 見てください"
				}
			}
			sender := other
			if c.FromSelf {
				sender = me
			}
			input := chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: body}
			if c.Message != "channel" {
				root := send(t, env, other, room.ID, "親")
				if c.ThreadMember != nil {
					reply(t, env, me, room.ID, root.ID, "参加します")
					if _, err := env.Service.SetThreadNotifications(t.Context(), me, room.ID, root.ID, *c.ThreadMember); err != nil {
						t.Fatal(err)
					}
				}
				input.ThreadRootID = &root.ID
				input.AlsoInChannel = c.Message == "broadcast"
			}
			msg, _, err := env.Service.SendMessage(t.Context(), sender, room.ID, input)
			if err != nil {
				t.Fatal(err)
			}

			got := pushesFor(t, env, messageCreated(msg), me)
			if (len(got) > 0) != c.Notify {
				t.Fatalf("pushes = %+v, want notify %v", got, c.Notify)
			}
			if c.Notify && got[0].Message.TTL != chat.PushMessageTTL {
				t.Errorf("TTL = %v", got[0].Message.TTL)
			}
		})
	}
}

// どこかで画面を見ていれば送らない。購読がなければ送らない（決定 5）。
func TestPushNotificationsPresenceAndSubscription(t *testing.T) {
	u := chattest.OnlineUsers{}
	env := chattest.New(t, chattest.WithPresenceReader(&u))
	users := env.CreateUsers(t, 4)
	sender, viewing, away, unsubscribed := users[0], users[1], users[2], users[3]
	ws := env.CreateWorkspace(t, sender)
	room := createRoom(t, env, sender, ws.ID, "public", "presence")
	for _, m := range users[1:] {
		env.AddMember(t, ws.ID, m, authz.RoleMember)
		if _, err := env.Service.JoinRoom(t.Context(), m, room.ID); err != nil {
			t.Fatal(err)
		}
	}
	subscribePush(t, env, sender)
	subscribePush(t, env, viewing)
	subscribePush(t, env, away)
	u = chattest.OnlineUsers{viewing}

	msg := send(t, env, sender, room.ID, "<!channel> 集合")
	all, err := env.Service.PushNotifications(t.Context(), messageCreated(msg))
	if err != nil {
		t.Fatal(err)
	}
	var got []ulid.ULID
	for _, n := range all {
		got = append(got, n.UserID)
	}
	// 送信者・画面を見ている人・購読のない人には送らない
	if !slices.Equal(got, []ulid.ULID{away}) {
		t.Errorf("recipients = %v, want only %v (viewing %v, unsubscribed %v)", got, away, viewing, unsubscribed)
	}
	if len(all) == 1 && !slices.Equal(all[0].Reasons, []chat.ActivityReason{chat.ReasonMention}) {
		t.Errorf("reasons = %v", all[0].Reasons)
	}
}

// 非公開ルームから外された人には、外された後に読み直した時点で送らない（ルール 8）。編集・削除・ログでも送らない。
func TestPushNotificationsReadsMembersAfterward(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.owner, r.ws.ID, "private", "secret")
	if err := env.Service.AddRoomMember(t.Context(), r.owner, room.ID, r.member); err != nil {
		t.Fatal(err)
	}
	subscribePush(t, env, r.member)
	all := chat.NotifyAll
	if _, err := env.Service.SetRoomNotifications(t.Context(), r.member, room.ID, chat.RoomNotifications{Level: &all}); err != nil {
		t.Fatal(err)
	}
	msg := send(t, env, r.owner, room.ID, "全部に通知")
	if got := pushesFor(t, env, messageCreated(msg), r.member); len(got) != 1 {
		t.Fatalf("before removal: %d pushes, want 1", len(got))
	}
	for _, typ := range []chat.EventType{chat.EventMessageUpdated, chat.EventMessageDeleted} {
		if got := pushesFor(t, env, chat.Event{Type: typ, Data: msg}, r.member); len(got) != 0 {
			t.Errorf("%s: %d pushes", typ, len(got))
		}
	}
	if err := env.Service.RemoveRoomMember(t.Context(), r.owner, room.ID, r.member); err != nil {
		t.Fatal(err)
	}
	if got := pushesFor(t, env, messageCreated(msg), r.member); len(got) != 0 {
		t.Errorf("after removal: %d pushes, want 0", len(got))
	}
}

func displayName(t *testing.T, env *chattest.Env, user ulid.ULID) string {
	t.Helper()
	var name string
	if err := env.Pool.QueryRow(t.Context(), `SELECT display_name FROM users WHERE id = $1`, user).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

// 本文のメンションは名前に、チャンネルへのリンクは受け取る人が読める名前だけにする（ADR 0062。読めない private の名前を漏らさない）。
func TestPushNotificationsContent(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.owner, r.ws.ID, "public", "デザインレビュー")
	open := createRoom(t, env, r.owner, r.ws.ID, "public", "雑談")
	secret := createRoom(t, env, r.owner, r.ws.ID, "private", "人事")
	if err := env.Service.AddRoomMember(t.Context(), r.owner, secret.ID, r.member); err != nil {
		t.Fatal(err)
	}
	// 別のワークスペースのルームは、そのワークスペースのルーム一覧にないので Web でも引けない
	elsewhere := createRoom(t, env, r.owner, env.CreateWorkspace(t, r.owner).ID, "public", "よそ")
	for _, m := range []ulid.ULID{r.member, r.member2} {
		if _, err := env.Service.JoinRoom(t.Context(), m, room.ID); err != nil {
			t.Fatal(err)
		}
		subscribePush(t, env, m)
	}
	ch := func(id ulid.ULID) string { return "<#" + id.String() + ">" }
	body := fmt.Sprintf("<!channel> *確認* %s %s %s %s", at(r.member), ch(open.ID), ch(secret.ID), ch(elsewhere.ID))
	msg := send(t, env, r.owner, room.ID, body)

	mentioned := "@" + displayName(t, env, r.member)
	for _, tt := range []struct {
		name string
		user ulid.ULID
		body string
	}{
		{"private の参加者には名前を出す", r.member, "@channel 確認 " + mentioned + " #雑談 #人事 #アクセスできないチャンネル"},
		{"private の参加者でなければ出さない", r.member2, "@channel 確認 " + mentioned + " #雑談 #アクセスできないチャンネル #アクセスできないチャンネル"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := pushesFor(t, env, messageCreated(msg), tt.user)
			if len(got) != 1 {
				t.Fatalf("%d pushes, want 1", len(got))
			}
			want := chat.PushPayload{
				Type:       chat.PushPayloadMessage,
				Title:      displayName(t, env, r.owner) + "（#デザインレビュー）",
				Body:       tt.body,
				Tag:        room.ID.String(),
				GroupTitle: "#デザインレビュー",
				URL:        "/w/" + r.ws.ID.String() + "/r/" + room.ID.String() + "?m=" + msg.ID.String(),
			}
			if p := decodePayload(t, got[0]); p != want {
				t.Errorf("payload =\n %+v\nwant\n %+v", p, want)
			}
		})
	}
}

// DM のハドルの呼び出しは相手に送り、ミュートした DM では送らない（決定 6）。
func TestPushNotificationsHuddleRinging(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	subscribePush(t, env, r.member)
	subscribePush(t, env, r.member2)
	env.Deliveries.Take()

	joined := joinHuddle(t, env, r.member, dm.ID)
	ringing := eventsOfType(env.Deliveries.Take(), chat.EventHuddleRinging)
	if len(ringing) != 1 {
		t.Fatalf("huddle.ringing = %+v", ringing)
	}
	all, err := env.Service.PushNotifications(t.Context(), ringing[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].UserID != r.member2 {
		t.Fatalf("pushes = %+v, want one to the peer", all)
	}
	if all[0].Message.TTL != chat.PushHuddleTTL {
		t.Errorf("TTL = %v, want %v", all[0].Message.TTL, chat.PushHuddleTTL)
	}
	caller := displayName(t, env, r.member)
	want := chat.PushPayload{
		Type: chat.PushPayloadHuddle, Title: caller, Body: "ハドルを始めました", Tag: joined.Huddle.ID.String(),
		GroupTitle: caller, URL: "/w/" + r.ws.ID.String() + "/r/" + dm.ID.String(),
	}
	if p := decodePayload(t, all[0]); p != want {
		t.Errorf("payload =\n %+v\nwant\n %+v", p, want)
	}

	if _, err := env.Service.SetRoomNotifications(t.Context(), r.member2, dm.ID, chat.RoomNotifications{Muted: true}); err != nil {
		t.Fatal(err)
	}
	if all, err := env.Service.PushNotifications(t.Context(), ringing[0]); err != nil || len(all) != 0 {
		t.Errorf("muted: pushes = %+v, err %v", all, err)
	}
}
