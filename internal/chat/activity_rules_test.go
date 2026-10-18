package chat_test

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// ruleCase は testdata/notification-rules.json の 1 行。Vitest（web/lib/chat/notifications/notification-rules.test.ts）も同じ表を読む。
type ruleCase struct {
	Name         string   `json:"name"`
	Room         string   `json:"room"`
	Global       *string  `json:"global"`
	RoomLevel    *string  `json:"room_level"`
	Muted        string   `json:"muted"`
	FromSelf     bool     `json:"from_self"`
	Mention      *string  `json:"mention"`
	Message      string   `json:"message"`
	ThreadMember *bool    `json:"thread_member"`
	Notify       bool     `json:"notify"`
	Activity     []string `json:"activity"`
}

func loadRuleCases(t *testing.T) []ruleCase {
	t.Helper()
	b, err := os.ReadFile("../../testdata/notification-rules.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Cases []ruleCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("no cases")
	}
	return doc.Cases
}

// everyoneOnline は全員を active にする（@here の対象に自分を入れるため。chattest.OnlineUsers と同じ考え方）。
type everyoneOnline struct{}

func (everyoneOnline) Presence(_ context.Context, userIDs []ulid.ULID) (map[ulid.ULID]chat.Presence, error) {
	out := make(map[ulid.ULID]chat.Presence, len(userIDs))
	for _, id := range userIDs {
		out[id] = chat.PresenceActive
	}
	return out, nil
}

// activityOf は actor のアクティビティから、messageID のメッセージの 1 件を探す。なければ nil。
func activityOf(t *testing.T, env *chattest.Env, actor, workspaceID, messageID ulid.ULID) *chat.ActivityItem {
	t.Helper()
	page, err := env.Service.ListActivity(t.Context(), actor, workspaceID, chat.ActivityQuery{Limit: chat.MaxActivityLimit})
	if err != nil {
		t.Fatalf("ListActivity: %v", err)
	}
	for i := range page.Items {
		if page.Items[i].Type == chat.ActivityItemMessage && page.Items[i].Message.ID == messageID {
			return &page.Items[i]
		}
	}
	return nil
}

// TestActivityRules は、規則の表のとおりにアクティビティに並ぶことを、実物の DB で確かめる（ADR 0058 決定 2・6）。
// 表はクライアントの shouldNotify のテストと共有していて、違うのは @here だけ（表の notify と activity）。
func TestActivityRules(t *testing.T) {
	env := chattest.New(t, chattest.WithPresenceReader(everyoneOnline{}))
	for i, c := range loadRuleCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			u := env.CreateUsers(t, 2)
			me, other := u[0], u[1]
			ws := env.CreateWorkspace(t, other)
			env.AddMember(t, ws.ID, me, authz.RoleMember)

			var room chat.Room
			if c.Room == "dm" {
				room, _ = createDM(t, env, other, ws.ID, me)
			} else {
				room = createRoom(t, env, other, ws.ID, "public", fmt.Sprintf("rules-%d", i))
				if _, err := env.Service.JoinRoom(t.Context(), me, room.ID); err != nil {
					t.Fatal(err)
				}
			}

			// 設定はサービスの API を通さずに書く（ミュートの期限切れのように、API では作れない状態があるため）
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
					// 自分で返信して参加してから、返信の通知を表のとおりにする（DM は最初から 2 人とも参加している）
					reply(t, env, me, room.ID, root.ID, "参加します")
					if _, err := env.Service.SetThreadNotifications(t.Context(), me, room.ID, root.ID, *c.ThreadMember); err != nil {
						t.Fatal(err)
					}
				}
				input.ThreadRootID = &root.ID
				input.AlsoInChannel = c.Message == "broadcast"
			}
			target, _, err := env.Service.SendMessage(t.Context(), sender, room.ID, input)
			if err != nil {
				t.Fatal(err)
			}

			item := activityOf(t, env, me, ws.ID, target.ID)
			if len(c.Activity) == 0 {
				if item != nil {
					t.Fatalf("activity has %+v, want nothing", item.Reasons)
				}
				return
			}
			if item == nil {
				t.Fatalf("activity has nothing, want %v", c.Activity)
			}
			got := make([]string, len(item.Reasons))
			for i, r := range item.Reasons {
				got[i] = string(r)
			}
			slices.Sort(got)
			if !slices.Equal(got, c.Activity) {
				t.Errorf("reasons = %v, want %v", got, c.Activity)
			}
		})
	}
}
