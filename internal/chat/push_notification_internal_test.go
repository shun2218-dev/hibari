package chat

import (
	"encoding/json/v2"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/mention"
	"github.com/shun2218-dev/hibari/internal/chat/plaintext"
	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/webpush"
)

// pushRuleCase は testdata/notification-rules.json の 1 行のうち、プッシュ通知の判定に使う列。
// 同じ表を Vitest（shouldNotify）と TestActivityRules（アクティビティ）も読む。
type pushRuleCase struct {
	Name         string  `json:"name"`
	Room         string  `json:"room"`
	Global       *string `json:"global"`
	RoomLevel    *string `json:"room_level"`
	Muted        string  `json:"muted"`
	FromSelf     bool    `json:"from_self"`
	Mention      *string `json:"mention"`
	Message      string  `json:"message"`
	ThreadMember *bool   `json:"thread_member"`
	Notify       bool    `json:"notify"`
}

// TestPushReasonsRules は、送るかどうかがクライアントの shouldNotify と同じになることを、同じ表で確かめる（ADR 0069 決定 5）。
// 「どのタブも見えていない」の代わりの presence は、ここでは見ない（TestPushNotificationsPresence が確かめる）。
func TestPushReasonsRules(t *testing.T) {
	b, err := os.ReadFile("../../testdata/notification-rules.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Cases []pushRuleCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Cases) == 0 {
		t.Fatal("no cases")
	}
	now := time.Date(2026, 9, 22, 9, 0, 0, 0, time.UTC)
	me, other := ulid.Make(), ulid.Make()
	for _, c := range doc.Cases {
		t.Run(c.Name, func(t *testing.T) {
			msg := Message{Kind: MessageKindUser, Sender: UserProfile{ID: other}}
			if c.FromSelf {
				msg.Sender.ID = me
			}
			if c.Mention != nil {
				m := Mention{Kind: mention.Kind(*c.Mention)}
				if m.Kind == mention.KindUser {
					m.User = &UserProfile{ID: me}
				}
				msg.Mentions = []Mention{m}
			}
			if c.Message != "channel" {
				root := ulid.Make()
				msg.ThreadRootID = &root
				msg.AlsoInChannel = c.Message == "broadcast"
			}
			var until *time.Time
			switch c.Muted {
			case "expired":
				past := now.Add(-time.Hour)
				until = &past
			}
			st := pushSettingsOf(store.ListPushCandidatesRow{
				UserID: me, WorkspaceLevel: c.Global, RoomLevel: c.RoomLevel,
				Muted: c.Muted != "none", MutedUntil: until, ThreadNotifyReplies: c.ThreadMember,
			}, now)
			got := pushReasons(msg, RoomKind(c.Room), st)
			if (len(got) > 0) != c.Notify {
				t.Errorf("pushReasons = %v, want notify %v", got, c.Notify)
			}
		})
	}
}

// 表にない境界: ログ・削除済み・参加者でない（設定の行がない）は送らない。
func TestPushReasonsSkips(t *testing.T) {
	me, other := ulid.Make(), ulid.Make()
	all := string(NotifyAll)
	st := pushSettings{UserID: me, Global: &all, Room: &RoomNotifications{}}
	deleted := time.Date(2026, 9, 22, 9, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		name string
		msg  Message
		st   pushSettings
	}{
		{"ログ", Message{Kind: MessageKindSystem, Sender: UserProfile{ID: other}}, st},
		{"削除済み", Message{Kind: MessageKindUser, Sender: UserProfile{ID: other}, DeletedAt: &deleted}, st},
		{"設定の行がない", Message{Kind: MessageKindUser, Sender: UserProfile{ID: other}}, pushSettings{UserID: me, Global: &all}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := pushReasons(tt.msg, authz.RoomPublic, tt.st); len(got) != 0 {
				t.Errorf("pushReasons = %v, want none", got)
			}
		})
	}
}

func TestMessagePayload(t *testing.T) {
	ws, roomID, msgID, root := ulid.Make(), ulid.Make(), ulid.Make(), ulid.Make()
	name := "デザインレビュー"
	channel := store.Room{ID: roomID, WorkspaceID: ws, Kind: string(authz.RoomPublic), Name: &name}
	dm := store.Room{ID: roomID, WorkspaceID: ws, Kind: string(authz.RoomDM)}
	sender := UserProfile{ID: ulid.Make(), DisplayName: "高橋 みゆき"}
	base := Message{ID: msgID, RoomID: roomID, Kind: MessageKindUser, Sender: sender, Body: "*確認* お願いします"}
	reply := base
	reply.ThreadRootID = &root
	fileOnly := base
	fileOnly.Body = ""
	fileOnly.Attachments = []MessageAttachment{{FileName: "hibari-type-scale.pdf"}}
	files := fileOnly
	files.Attachments = []MessageAttachment{{FileName: "a.png"}, {FileName: "b.png"}}
	long := base
	long.Body = strings.Repeat("あ", 120)

	tests := []struct {
		name string
		msg  Message
		room store.Room
		want PushPayload
	}{
		{"チャンネル", base, channel, PushPayload{
			Type: PushPayloadMessage, Title: "高橋 みゆき（#デザインレビュー）", Body: "確認 お願いします",
			Tag: roomID.String(), GroupTitle: "#デザインレビュー", URL: "/w/" + ws.String() + "/r/" + roomID.String() + "?m=" + msgID.String(),
		}},
		{"DM は送信者だけ", base, dm, PushPayload{
			Type: PushPayloadMessage, Title: "高橋 みゆき", Body: "確認 お願いします",
			Tag: roomID.String(), GroupTitle: "高橋 みゆき", URL: "/w/" + ws.String() + "/r/" + roomID.String() + "?m=" + msgID.String(),
		}},
		{"スレッドの返信はスレッドごとにまとめる", reply, channel, PushPayload{
			Type: PushPayloadMessage, Title: "高橋 みゆき（#デザインレビュー のスレッド）", Body: "確認 お願いします",
			Tag: root.String(), GroupTitle: "#デザインレビュー のスレッド",
			URL: "/w/" + ws.String() + "/r/" + roomID.String() + "?m=" + msgID.String() + "&t=" + root.String(),
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := messagePayload(tt.msg, tt.room, plaintext.Names{}); got != tt.want {
				t.Errorf("messagePayload =\n %+v\nwant\n %+v", got, tt.want)
			}
		})
	}

	for _, tt := range []struct {
		name string
		msg  Message
		want string
	}{
		{"添付だけ（docs/ui の文言）", fileOnly, "ファイルを 1 件送りました: hibari-type-scale.pdf"},
		{"添付が 2 件", files, "ファイルを 2 件送りました: a.png、b.png"},
		{"100 文字で切る", long, strings.Repeat("あ", 100) + "…"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := messagePayload(tt.msg, channel, plaintext.Names{}).Body; got != tt.want {
				t.Errorf("body = %q, want %q", got, tt.want)
			}
		})
	}
}

// 名前が長すぎても、上限に収めて送る（暗号化の段で通知ごと落とさない）。
func TestEncodePushPayloadFits(t *testing.T) {
	for _, tt := range []struct {
		name string
		p    PushPayload
	}{
		{"ふつう", PushPayload{Type: PushPayloadMessage, Title: "高橋 みゆき", Body: "こんにちは", Tag: "t", URL: "/w/a/r/b"}},
		{"本文が長い", PushPayload{Type: PushPayloadMessage, Title: "t", Body: strings.Repeat("あ", 3000)}},
		{"エスケープで膨らむ", PushPayload{Type: PushPayloadMessage, Title: "t", Body: strings.Repeat("\x01", 2000)}},
		{"タイトルも長い", PushPayload{Type: PushPayloadMessage, Title: strings.Repeat("名", 2000), Body: strings.Repeat("あ", 2000), GroupTitle: strings.Repeat("前", 2000)}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			b, err := encodePushPayload(tt.p)
			if err != nil {
				t.Fatal(err)
			}
			if len(b) > webpush.MaxPayload {
				t.Fatalf("len = %d, want <= %d", len(b), webpush.MaxPayload)
			}
			var got PushPayload
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatal(err)
			}
			if !utf8.ValidString(got.Body) || !utf8.ValidString(got.Title) {
				t.Errorf("cut in the middle of a character: %q / %q", got.Title, got.Body)
			}
			if got.Type != tt.p.Type || got.Tag != tt.p.Tag || got.URL != tt.p.URL {
				t.Errorf("fixed fields changed: %+v", got)
			}
			if len(tt.p.Body)+len(tt.p.Title) < 1000 && got != tt.p {
				t.Errorf("small payload changed: %+v", got)
			}
		})
	}
}
