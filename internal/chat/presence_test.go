package chat_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
)

// 離席とカスタムステータス（ADR 0049）。自動で決まる presence は Redis、本人が選んだ設定は Postgres。

// memberOf はワークスペースのメンバー一覧から 1 人を取る。
func memberOf(t *testing.T, env *chattest.Env, actor, workspaceID, target ulid.ULID) chat.Member {
	t.Helper()
	page, err := env.Service.ListMembers(t.Context(), actor, workspaceID, chat.PageRequest{})
	if err != nil {
		t.Fatalf("ListMembers: %v", err)
	}
	for _, m := range page.Items {
		if m.User.ID == target {
			return m
		}
	}
	t.Fatalf("%s はメンバーに居ない", target)
	return chat.Member{}
}

func TestSetManualAway(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	env.Deliveries.Take()

	if _, err := env.Service.SetManualAway(t.Context(), r.member, true); err != nil {
		t.Fatalf("SetManualAway: %v", err)
	}

	t.Run("メンバー一覧に away として出る", func(t *testing.T) {
		if m := memberOf(t, env, r.owner, r.ws.ID, r.member); !m.Away {
			t.Errorf("away = false, want true")
		}
		// 自動の presence は別の事実のまま（接続がないので offline）。合わせるのは読む側（ADR 0049 決定 1）
		if m := memberOf(t, env, r.owner, r.ws.ID, r.member); m.Presence != chat.PresenceOffline {
			t.Errorf("presence = %v, want offline", m.Presence)
		}
	})

	t.Run("所属するワークスペースごとに member.status_changed を配る", func(t *testing.T) {
		evs := env.Deliveries.Take()
		if len(evs) != 1 || evs[0].Type != chat.EventMemberStatusChanged {
			t.Fatalf("events = %+v, want 1 件の member.status_changed", evs)
		}
		data, ok := evs[0].Data.(chat.MemberStatusChanged)
		if !ok || !data.Away || data.Status != nil {
			t.Errorf("data = %+v, want away true / status nil", evs[0].Data)
		}
		// そのワークスペースの購読者と、本人のすべての接続（別のタブ）に届ける
		if len(evs[0].To.Workspaces) != 1 || evs[0].To.Workspaces[0] != r.ws.ID {
			t.Errorf("宛先のワークスペース = %v, want %s", evs[0].To.Workspaces, r.ws.ID)
		}
		if len(evs[0].To.Users) != 1 || evs[0].To.Users[0] != r.member {
			t.Errorf("宛先のユーザー = %v, want %s", evs[0].To.Users, r.member)
		}
	})

	t.Run("2 つ目のワークスペースにも同じ値が飛ぶ（ユーザーごとの設定なので）", func(t *testing.T) {
		second := env.CreateWorkspace(t, r.member)
		env.Deliveries.Take()

		if _, err := env.Service.SetManualAway(t.Context(), r.member, false); err != nil {
			t.Fatalf("SetManualAway: %v", err)
		}

		evs := env.Deliveries.Take()
		if len(evs) != 2 {
			t.Fatalf("events = %d 件, want 2（所属するワークスペースの数）", len(evs))
		}
		for _, ev := range evs {
			if data := ev.Data.(chat.MemberStatusChanged); data.Away {
				t.Errorf("away = true, want false（解除したので）")
			}
		}
		if m := memberOf(t, env, r.member, second.ID, r.member); m.Away {
			t.Errorf("2 つ目のワークスペースでも away = true, want false")
		}
	})

	t.Run("同じ値をもう一度設定しても壊れない（冪等）", func(t *testing.T) {
		if _, err := env.Service.SetManualAway(t.Context(), r.member, false); err != nil {
			t.Fatalf("SetManualAway(2 回目): %v", err)
		}
		if m := memberOf(t, env, r.owner, r.ws.ID, r.member); m.Away {
			t.Errorf("away = true, want false")
		}
	})
}

func TestSetAndClearStatus(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	env.Deliveries.Take()
	expires := env.Clock.Now().Add(time.Hour)

	got, err := env.Service.SetStatus(t.Context(), r.member, r.ws.ID, chat.UserStatus{Emoji: "🍵", Text: "休憩中", ExpiresAt: &expires})
	if err != nil {
		t.Fatalf("SetStatus: %v", err)
	}
	if got == nil || got.Emoji != "🍵" || got.Text != "休憩中" || got.ExpiresAt == nil {
		t.Fatalf("status = %+v, want 🍵 休憩中（期限つき）", got)
	}

	t.Run("メンバー一覧に出る", func(t *testing.T) {
		m := memberOf(t, env, r.owner, r.ws.ID, r.member)
		if m.Status == nil || m.Status.Emoji != "🍵" || m.Status.Text != "休憩中" {
			t.Errorf("status = %+v, want 🍵 休憩中", m.Status)
		}
	})

	t.Run("ルームのメンバー一覧にも出る", func(t *testing.T) {
		room := createRoom(t, env, r.member, r.ws.ID, "public", "status")
		page, err := env.Service.ListRoomMembers(t.Context(), r.member, room.ID, chat.PageRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 || page.Items[0].Status == nil || page.Items[0].Status.Emoji != "🍵" {
			t.Errorf("room members = %+v, want 🍵 付きの 1 人", page.Items)
		}
	})

	t.Run("member.status_changed を配る", func(t *testing.T) {
		// ほかの副テスト（ルームの作成）のイベントも混ざるので、種類で選んでから中身を見る
		var changed []chat.MemberStatusChanged
		for _, ev := range env.Deliveries.Take() {
			if ev.Type == chat.EventMemberStatusChanged {
				changed = append(changed, ev.Data.(chat.MemberStatusChanged))
			}
		}
		if len(changed) != 1 {
			t.Fatalf("member.status_changed = %d 件, want 1", len(changed))
		}
		if changed[0].Status == nil || changed[0].Status.Emoji != "🍵" || changed[0].WorkspaceID != r.ws.ID {
			t.Errorf("data = %+v, want 🍵（このワークスペース）", changed[0])
		}
	})

	t.Run("期限が過ぎたら出なくなる（掃除のジョブは無い）", func(t *testing.T) {
		env.Clock.Advance(2 * time.Hour)
		defer env.Clock.Advance(-2 * time.Hour)

		if m := memberOf(t, env, r.owner, r.ws.ID, r.member); m.Status != nil {
			t.Errorf("status = %+v, want nil（期限切れ）", m.Status)
		}
	})

	t.Run("ワークスペースごとに別（Slack と同じ）", func(t *testing.T) {
		second := env.CreateWorkspace(t, r.member)
		if m := memberOf(t, env, r.member, second.ID, r.member); m.Status != nil {
			t.Errorf("2 つ目のワークスペースの status = %+v, want nil", m.Status)
		}
	})

	t.Run("解除できる。設定していなくても成功（冪等）", func(t *testing.T) {
		if err := env.Service.ClearStatus(t.Context(), r.member, r.ws.ID); err != nil {
			t.Fatalf("ClearStatus: %v", err)
		}
		if m := memberOf(t, env, r.owner, r.ws.ID, r.member); m.Status != nil {
			t.Errorf("status = %+v, want nil", m.Status)
		}
		if err := env.Service.ClearStatus(t.Context(), r.member, r.ws.ID); err != nil {
			t.Errorf("ClearStatus(2 回目): %v", err)
		}
	})
}

func TestStatusValidation(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	past := env.Clock.Now().Add(-time.Minute)
	future := env.Clock.Now().Add(time.Hour)

	tests := []struct {
		name   string
		status chat.UserStatus
		field  string
	}{
		{"絵文字が要る", chat.UserStatus{Text: "休憩中"}, "emoji"},
		{"絵文字でない文字列は拒む", chat.UserStatus{Emoji: "a"}, "emoji"},
		{"書記素クラスタ 2 つは拒む", chat.UserStatus{Emoji: "👍👍"}, "emoji"},
		{"文言は 100 文字まで", chat.UserStatus{Emoji: "🍵", Text: strings.Repeat("あ", 101)}, "text"},
		{"過ぎた期限は拒む", chat.UserStatus{Emoji: "🍵", ExpiresAt: &past}, "expires_at"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := env.Service.SetStatus(t.Context(), r.member, r.ws.ID, tt.status)
			var ve *chat.ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want ValidationError", err)
			}
			if len(ve.Fields) != 1 || ve.Fields[0].Field != tt.field {
				t.Errorf("fields = %+v, want %s", ve.Fields, tt.field)
			}
		})
	}

	t.Run("ちょうど 100 文字と絵文字だけは通る", func(t *testing.T) {
		if _, err := env.Service.SetStatus(t.Context(), r.member, r.ws.ID, chat.UserStatus{Emoji: "🍵", Text: strings.Repeat("あ", 100)}); err != nil {
			t.Errorf("100 文字: %v", err)
		}
		if _, err := env.Service.SetStatus(t.Context(), r.member, r.ws.ID, chat.UserStatus{Emoji: "🍵", ExpiresAt: &future}); err != nil {
			t.Errorf("文言なし: %v", err)
		}
	})

	t.Run("ワークスペースのメンバーでなければ ErrNotFound", func(t *testing.T) {
		_, err := env.Service.SetStatus(t.Context(), r.outsider, r.ws.ID, chat.UserStatus{Emoji: "🍵"})
		if !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("SetStatus(outsider) = %v, want ErrNotFound", err)
		}
		if err := env.Service.ClearStatus(t.Context(), r.outsider, r.ws.ID); !errors.Is(err, chat.ErrNotFound) {
			t.Errorf("ClearStatus(outsider) = %v, want ErrNotFound", err)
		}
	})
}

// ワークスペースを抜けたら、その行ごとステータスも消える（後始末のコードを持たない）。
func TestStatusGoneWhenLeavingWorkspace(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	if _, err := env.Service.SetStatus(t.Context(), r.member, r.ws.ID, chat.UserStatus{Emoji: "🌴", Text: "休暇中"}); err != nil {
		t.Fatal(err)
	}

	if err := env.Service.RemoveMember(t.Context(), r.owner, r.ws.ID, r.member); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}

	// 入り直しても、前のステータスは残っていない
	env.AddMember(t, r.ws.ID, r.member, "member")
	if m := memberOf(t, env, r.owner, r.ws.ID, r.member); m.Status != nil {
		t.Errorf("status = %+v, want nil（抜けたときに消えている）", m.Status)
	}
}
