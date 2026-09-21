package httpx_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/coder/websocket"
)

// 複数のインスタンスでの WebSocket の統合テスト（ロードマップ Phase 5 の DoD、ADR 0016）。
// 同じ DB と Redis を使う 2 台のサーバーを立て、インスタンスの間の配信が Redis Pub/Sub だけで成り立つことを確かめる。

// どちらのインスタンスに接続していても、どちらのインスタンスで起きた変更も届く。
func TestWSDeliversAcrossInstances(t *testing.T) {
	a := newAPI(t)
	b := a.newInstance()
	f := newChatFixture(a)
	alice, bob := a.dialWS(f.alice), b.dialWS(f.bob)
	for _, w := range []*wsClient{alice, bob} {
		w.subscribe("room_id", f.public.ID)
	}

	a.sendMessage(f.alice, f.public.ID, "A に送った")
	b.sendMessage(f.bob, f.public.ID, "B に送った")
	for name, w := range map[string]*wsClient{"alice on A": alice, "bob on B": bob} {
		got := eventsOfType(w.sync(), "message.created")
		if len(got) != 2 || !strings.Contains(string(got[0].Data), "A に送った") || !strings.Contains(string(got[1].Data), "B に送った") {
			t.Errorf("%s received %v, want both messages in order", name, got)
		}
	}

	// 本人宛てのイベント（別の端末での既読）も、別のインスタンスの接続に届く。
	bobOnA := a.dialWS(f.bob)
	bobOnA.sync()
	expectStatus(t, b.as(f.bob, http.MethodPost, "/api/v1/rooms/"+f.public.ID+"/read", map[string]int64{"seq": 2}), http.StatusOK)
	if got := eventsOfType(bobOnA.sync(), "room.read"); len(got) != 1 {
		t.Errorf("bob on A room.read = %v", got)
	}
}

// 別のインスタンスに接続しているユーザーをキックしても、その場で購読が外れ、以降のイベントが届かない。
func TestWSKickAcrossInstances(t *testing.T) {
	a := newAPI(t)
	b := a.newInstance()
	f := newChatFixture(a)
	bob := b.dialWS(f.bob)
	bob.subscribe("workspace_id", f.ws.ID)
	bob.subscribe("room_id", f.public.ID)
	bob.subscribe("room_id", f.private.ID)

	// キックの API はインスタンス A が処理する。
	expectStatus(t, a.as(f.owner, http.MethodDelete, "/api/v1/workspaces/"+f.ws.ID+"/members/"+f.bob.id, nil), http.StatusNoContent)
	if got := eventsOfType(bob.sync(), "workspace.member_removed"); len(got) != 1 || !strings.Contains(string(got[0].Data), f.bob.id) {
		t.Fatalf("bob workspace.member_removed = %v", got)
	}

	a.sendMessage(f.alice, f.public.ID, "キックの後")
	a.sendMessage(f.alice, f.private.ID, "キックの後")
	name := "改名"
	expectStatus(t, a.as(f.owner, http.MethodPatch, "/api/v1/workspaces/"+f.ws.ID, map[string]*string{"name": &name}), http.StatusOK)
	if got := bob.sync(); len(got) != 0 {
		t.Errorf("bob received %v after being kicked on another instance", got)
	}
}

// 同じユーザーが複数のインスタンスに接続していても、presence はすべての接続が切れるまでオンラインのまま。
func TestWSPresenceAcrossInstances(t *testing.T) {
	a := newAPI(t)
	b := a.newInstance()
	f := newChatFixture(a)
	owner := a.dialWS(f.owner)
	owner.subscribe("workspace_id", f.ws.ID)

	presenceEvents := func() []string {
		t.Helper()
		// presence.changed はほかのインスタンスの Lua スクリプトが publish するので、両方の Broker を待ってから読む。
		if err := b.broker.Sync(t.Context()); err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, ev := range eventsOfType(owner.sync(), "presence.changed") {
			out = append(out, string(ev.Data))
		}
		return out
	}
	// 接続は「見ていない」から始まるので、最初の接続では idle（ADR 0049 決定 3）
	onlineEvent := `{"user_id":"` + f.bob.id + `","presence":"idle"}`
	offlineEvent := `{"user_id":"` + f.bob.id + `","presence":"offline"}`

	bobOnA, bobOnB := a.dialWS(f.bob), b.dialWS(f.bob)
	bobOnA.sync()
	bobOnB.sync()
	if got := presenceEvents(); len(got) != 1 || got[0] != onlineEvent {
		t.Fatalf("after connecting to both instances: %v, want one online", got)
	}

	// A の接続を切っても B に残っているので、オフラインにならない。
	if err := bobOnA.conn.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !a.presenceField(f.bob.id) })
	if got := presenceEvents(); len(got) != 0 {
		t.Fatalf("after disconnecting from A: %v, want none", got)
	}
	if !a.online(f.bob.id) {
		t.Fatal("bob is offline while connected to B")
	}

	if err := bobOnB.conn.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !a.online(f.bob.id) })
	if got := presenceEvents(); len(got) != 1 || got[0] != offlineEvent {
		t.Fatalf("after disconnecting from both: %v, want one offline", got)
	}
}

// presenceField は、このインスタンスが userID の接続を presence に記録しているか。
func (c *apiClient) presenceField(userID string) bool {
	c.t.Helper()
	ok, err := c.redis.HExists(c.t.Context(), "presence:"+userID, c.instanceID.String()).Result()
	if err != nil {
		c.t.Fatal(err)
	}
	return ok
}
