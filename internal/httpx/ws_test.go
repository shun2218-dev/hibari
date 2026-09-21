package httpx_test

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/httpx"
	"github.com/shun2218-dev/hibari/internal/platform/authn"
)

// WebSocket の統合テスト（ロードマップ Phase 4 の DoD）。実物の Postgres / Redis と、ルーター全体を通す。

// wsFrame はサーバーからのフレーム。
type wsFrame struct {
	Type  string         `json:"type"`
	ID    *string        `json:"id"`
	Error string         `json:"error"`
	Data  jsontext.Value `json:"data"`
}

// wsClient はテスト用の WebSocket クライアント。読み取りは goroutine で続け（pong を返すため）、フレームを channel に流す。
type wsClient struct {
	t      *testing.T
	conn   *websocket.Conn
	frames chan wsFrame
	// closed は読み取りが終わったときのエラー（close コードを含む）を 1 回だけ流す。
	closed chan error
	seq    int
	// broker は接続先のインスタンスの Broker。sync で Redis からの受け渡しを待つのに使う。
	broker *realtime.Broker
}

func (c *apiClient) issueTicket(u apiUser) string {
	c.t.Helper()
	r := c.as(u, http.MethodPost, "/api/v1/ws/ticket", nil)
	expectStatus(c.t, r, http.StatusOK)
	return decode[struct {
		Ticket string `json:"ticket"`
	}](c.t, r).Ticket
}

// dial は WebSocket で接続する。失敗したらステータスコードを返す（接続できなければ 0）。
func dial(ctx context.Context, url string, opts *websocket.DialOptions) (*websocket.Conn, int, error) {
	conn, resp, err := websocket.Dial(ctx, url, opts)
	status := 0
	if resp != nil {
		status = resp.StatusCode
		if resp.Body != nil {
			_ = resp.Body.Close()
		}
	}
	return conn, status, err
}

func (c *apiClient) wsURL(ticket string) string {
	return "ws" + strings.TrimPrefix(c.srv.URL, "http") + "/api/v1/ws?ticket=" + ticket
}

// dialWS は u として接続する。
func (c *apiClient) dialWS(u apiUser) *wsClient {
	c.t.Helper()
	conn, status, err := dial(c.t.Context(), c.wsURL(c.issueTicket(u)), nil)
	if err != nil {
		c.t.Fatalf("dial: %v (status %d)", err, status)
	}
	w := startWSClient(c.t, conn)
	w.broker = c.broker
	return w
}

func startWSClient(t *testing.T, conn *websocket.Conn) *wsClient {
	w := &wsClient{t: t, conn: conn, frames: make(chan wsFrame, 256), closed: make(chan error, 1)}
	go func() {
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				w.closed <- err
				close(w.frames)
				return
			}
			var f wsFrame
			if err := json.Unmarshal(data, &f); err != nil {
				t.Errorf("frame is not JSON: %s", data)
				continue
			}
			w.frames <- f
		}
	}()
	t.Cleanup(func() { _ = conn.CloseNow() })
	return w
}

func (w *wsClient) send(v any) {
	w.t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		w.t.Fatal(err)
	}
	if err := w.conn.Write(w.t.Context(), websocket.MessageText, b); err != nil {
		w.t.Fatalf("write: %v", err)
	}
}

// next は次のフレームを返す。
func (w *wsClient) next() wsFrame {
	w.t.Helper()
	select {
	case f, ok := <-w.frames:
		if !ok {
			w.t.Fatalf("connection closed: %v", <-w.closed)
		}
		return f
	case <-time.After(10 * time.Second):
		w.t.Fatal("no frame within 10s")
		return wsFrame{}
	}
}

// request は id 付きのメッセージを送り、同じ id の ack を待つ。それまでに届いたイベントは返す。
func (w *wsClient) request(msg map[string]any) (ack wsFrame, events []wsFrame) {
	w.t.Helper()
	w.seq++
	id := "c" + strconv.Itoa(w.seq)
	msg["id"] = id
	w.send(msg)
	for {
		f := w.next()
		if f.Type == "ack" && f.ID != nil && *f.ID == id {
			return f, events
		}
		events = append(events, f)
	}
}

func (w *wsClient) subscribe(field, id string) {
	w.t.Helper()
	ack, _ := w.request(map[string]any{"type": "subscribe", field: id})
	if ack.Error != "" {
		w.t.Fatalf("subscribe %s %s: %s", field, id, ack.Error)
	}
}

// sync は、それまでに publish されたイベントがすべて届くのを待ち、届いたイベントを返す。
//
// イベントは Redis Pub/Sub を通るので、REST のレスポンスより後に接続先のインスタンスに届く（ADR 0016）。
// まず Broker.Sync で、Redis が受け付けた publish を Hub が送信キューに入れ終えるまで待つ。
// その後の ping の ack は、サーバーの 1 本の書き込みの goroutine が送信キューの順に書くので、キューにあるイベントより後に届く。
func (w *wsClient) sync() []wsFrame {
	w.t.Helper()
	if w.broker != nil {
		if err := w.broker.Sync(w.t.Context()); err != nil {
			w.t.Fatalf("broker sync: %v", err)
		}
	}
	_, events := w.request(map[string]any{"type": "ping"})
	return events
}

// eventsOfType は events のうち typ のものを返す。
func eventsOfType(events []wsFrame, typ string) []wsFrame {
	var out []wsFrame
	for _, f := range events {
		if f.Type == typ {
			out = append(out, f)
		}
	}
	return out
}

// waitClosed は接続が閉じるまで待ち、close コードを返す。
func (w *wsClient) waitClosed() websocket.StatusCode {
	w.t.Helper()
	for {
		select {
		case _, ok := <-w.frames:
			if ok {
				continue
			}
			return websocket.CloseStatus(<-w.closed)
		case <-time.After(10 * time.Second):
			w.t.Fatal("connection not closed within 10s")
			return 0
		}
	}
}

// chatFixture はワークスペースに public / private ルームがあり、owner・alice・bob がメンバーの状態。
type chatFixture struct {
	owner, alice, bob apiUser
	ws                workspaceBody
	public, private   roomBody
}

func newChatFixture(c *apiClient) chatFixture {
	c.t.Helper()
	f := chatFixture{owner: c.registerUser(), alice: c.registerUser(), bob: c.registerUser()}
	r := c.as(f.owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "山と印刷"})
	expectStatus(c.t, r, http.StatusCreated)
	f.ws = decode[workspaceBody](c.t, r)
	c.joinViaInvite(f.owner, f.ws.ID, f.alice)
	c.joinViaInvite(f.owner, f.ws.ID, f.bob)
	r = c.as(f.alice, http.MethodPost, "/api/v1/workspaces/"+f.ws.ID+"/rooms", map[string]string{"kind": "public", "name": "雑談-" + ulid.Make().String()})
	expectStatus(c.t, r, http.StatusCreated)
	f.public = decode[roomBody](c.t, r)
	r = c.as(f.alice, http.MethodPost, "/api/v1/workspaces/"+f.ws.ID+"/rooms", map[string]string{"kind": "private", "name": "非公開-" + ulid.Make().String()})
	expectStatus(c.t, r, http.StatusCreated)
	f.private = decode[roomBody](c.t, r)
	expectStatus(c.t, c.as(f.bob, http.MethodPost, "/api/v1/rooms/"+f.public.ID+"/join", nil), http.StatusOK)
	expectStatus(c.t, c.as(f.alice, http.MethodPost, "/api/v1/rooms/"+f.private.ID+"/members", map[string]string{"user_id": f.bob.id}), http.StatusNoContent)
	return f
}

func (c *apiClient) sendMessage(u apiUser, roomID, body string) response {
	c.t.Helper()
	r := c.as(u, http.MethodPost, "/api/v1/rooms/"+roomID+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": body})
	expectStatus(c.t, r, http.StatusCreated)
	return r
}

func TestWSTicket(t *testing.T) {
	c := newAPI(t)
	u := c.registerUser()

	r := c.do(request{method: http.MethodPost, path: "/api/v1/ws/ticket"})
	expectStatus(t, r, http.StatusUnauthorized)

	r = c.as(u, http.MethodPost, "/api/v1/ws/ticket", nil)
	expectStatus(t, r, http.StatusOK)
	body := decode[struct {
		Ticket    string `json:"ticket"`
		ExpiresIn int    `json:"expires_in"`
	}](t, r)
	if len(body.Ticket) != 43 || body.ExpiresIn != 30 || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("ticket response = %+v, Cache-Control %q", body, r.header.Get("Cache-Control"))
	}
}

func TestWSConnectRejects(t *testing.T) {
	c := newAPI(t, withWSConfig(httpx.DefaultWSConfig([]string{"app.hibari.test"})))
	u := c.registerUser()

	dialStatus := func(url string, header http.Header) int {
		t.Helper()
		conn, status, err := dial(t.Context(), url, &websocket.DialOptions{HTTPHeader: header})
		if err == nil {
			_ = conn.CloseNow()
			return http.StatusSwitchingProtocols
		}
		if status == 0 {
			t.Fatalf("dial: %v", err)
		}
		return status
	}

	for name, url := range map[string]string{
		"no ticket":      c.wsURL(""),
		"unknown ticket": c.wsURL("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
		// Access Token は ticket の代わりにならない。
		"access token as ticket": c.wsURL(u.token),
	} {
		if got := dialStatus(url, nil); got != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", name, got)
		}
	}

	// ticket は使い捨て。
	ticket := c.issueTicket(u)
	if got := dialStatus(c.wsURL(ticket), nil); got != http.StatusSwitchingProtocols {
		t.Fatalf("first use: status = %d", got)
	}
	if got := dialStatus(c.wsURL(ticket), nil); got != http.StatusUnauthorized {
		t.Errorf("reused ticket: status = %d, want 401", got)
	}

	// 許していない Origin のブラウザからは接続できない。Origin のないクライアント（ネイティブアプリ）は上で接続できている。
	if got := dialStatus(c.wsURL(c.issueTicket(u)), http.Header{"Origin": {"https://evil.example"}}); got != http.StatusForbidden {
		t.Errorf("foreign origin: status = %d, want 403", got)
	}
	if got := dialStatus(c.wsURL(c.issueTicket(u)), http.Header{"Origin": {"https://app.hibari.test"}}); got != http.StatusSwitchingProtocols {
		t.Errorf("app origin: status = %d, want 101", got)
	}

	// ticket を発行した後にログアウトしたら、その ticket では接続できない（ADR 0007）。
	ticket = c.issueTicket(u)
	expectStatus(t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/logout", body: map[string]string{"refresh_token": u.refresh}}), http.StatusNoContent)
	r := c.do(request{method: http.MethodGet, path: "/api/v1/ws?ticket=" + ticket})
	expectStatus(t, r, http.StatusUnauthorized)
	if p := decode[problemBody](t, r); !strings.HasSuffix(p.Type, ":ws-ticket-invalid") {
		t.Errorf("problem type = %s", p.Type)
	}
}

// DoD: 2 つの接続で同じルームを開き、片方の送信が即座に他方へ届く。
func TestWSDeliversMessages(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	alice, bob := c.dialWS(f.alice), c.dialWS(f.bob)
	alice.subscribe("room_id", f.public.ID)
	bob.subscribe("room_id", f.public.ID)
	bob.subscribe("workspace_id", f.ws.ID)

	sent := c.sendMessage(f.alice, f.public.ID, "こんにちは")
	var ev wsFrame
	for ev = bob.next(); ev.Type != "message.created"; ev = bob.next() {
	}
	// WebSocket のメッセージは REST のレスポンスと同じ形。
	var restMsg, wsMsg map[string]any
	if err := json.Unmarshal(sent.body, &restMsg); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(ev.Data, &wsMsg); err != nil {
		t.Fatal(err)
	}
	restJSON, _ := json.Marshal(restMsg, json.Deterministic(true))
	wsJSON, _ := json.Marshal(wsMsg, json.Deterministic(true))
	if string(restJSON) != string(wsJSON) {
		t.Errorf("websocket message differs from REST:\n ws:   %s\n rest: %s", wsJSON, restJSON)
	}
	// seq 1 はルームの作成のログ、2 は bob の参加のログ（ADR 0033）。人の発言はその次から。
	if wsMsg["change_seq"] != float64(3) || wsMsg["seq"] != float64(3) {
		t.Errorf("seq / change_seq = %v / %v", wsMsg["seq"], wsMsg["change_seq"])
	}
	// 送信者も購読していれば受け取る（REST のレスポンスと client_msg_id で重複を除く。ADR 0004）。
	if got := eventsOfType(alice.sync(), "message.created"); len(got) != 1 {
		t.Errorf("alice received %d message.created, want 1", len(got))
	}

	// 編集・削除も届く。
	msgID := wsMsg["id"].(string)
	expectStatus(t, c.as(f.alice, http.MethodPatch, "/api/v1/rooms/"+f.public.ID+"/messages/"+msgID, map[string]string{"body": "こんばんは"}), http.StatusOK)
	expectStatus(t, c.as(f.alice, http.MethodDelete, "/api/v1/rooms/"+f.public.ID+"/messages/"+msgID, nil), http.StatusNoContent)
	events := bob.sync()
	if got := eventsOfType(events, "message.updated"); len(got) != 1 || !strings.Contains(string(got[0].Data), `"change_seq":4`) {
		t.Errorf("message.updated = %v", got)
	}
	if got := eventsOfType(events, "message.deleted"); len(got) != 1 || !strings.Contains(string(got[0].Data), `"change_seq":5`) || !strings.Contains(string(got[0].Data), `"body":""`) {
		t.Errorf("message.deleted = %v", got)
	}

	// 購読をやめたら届かない。
	ack, _ := bob.request(map[string]any{"type": "unsubscribe", "room_id": f.public.ID})
	if ack.Error != "" {
		t.Fatal(ack.Error)
	}
	c.sendMessage(f.alice, f.public.ID, "もう届かない")
	if got := eventsOfType(bob.sync(), "message.created"); len(got) != 0 {
		t.Errorf("bob received %v after unsubscribe", got)
	}
}

func TestWSProtocol(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	stranger := c.registerUser()
	owner, bob, outsider := c.dialWS(f.owner), c.dialWS(f.bob), c.dialWS(stranger)

	for _, tt := range []struct {
		name    string
		client  *wsClient
		msg     map[string]any
		wantErr string
	}{
		{"subscribe room", bob, map[string]any{"type": "subscribe", "room_id": f.private.ID}, ""},
		{"subscribe twice", bob, map[string]any{"type": "subscribe", "room_id": f.private.ID}, ""},
		{"subscribe workspace", bob, map[string]any{"type": "subscribe", "workspace_id": f.ws.ID}, ""},
		// public は参加していなくても購読できる。
		{"public without joining", owner, map[string]any{"type": "subscribe", "room_id": f.public.ID}, ""},
		// 読めないルーム・ワークスペースは、存在の有無を明かさない。
		{"private as non-member", owner, map[string]any{"type": "subscribe", "room_id": f.private.ID}, "not_found"},
		{"workspace as outsider", outsider, map[string]any{"type": "subscribe", "workspace_id": f.ws.ID}, "not_found"},
		{"unknown room", bob, map[string]any{"type": "subscribe", "room_id": ulid.Make().String()}, "not_found"},
		{"both ids", bob, map[string]any{"type": "subscribe", "room_id": f.public.ID, "workspace_id": f.ws.ID}, "invalid_message"},
		{"no id", bob, map[string]any{"type": "subscribe"}, "invalid_message"},
		{"malformed id", bob, map[string]any{"type": "subscribe", "room_id": "nope"}, "invalid_message"},
		{"unknown type", bob, map[string]any{"type": "shout"}, "invalid_message"},
		{"unsubscribe not subscribed", bob, map[string]any{"type": "unsubscribe", "room_id": ulid.Make().String()}, ""},
		{"typing without subscription", owner, map[string]any{"type": "typing", "room_id": f.private.ID}, "not_subscribed"},
		// 読めるだけ（参加していない public）の人は入力中を出せない。
		{"typing read-only", owner, map[string]any{"type": "typing", "room_id": f.public.ID}, "forbidden"},
		{"ping", bob, map[string]any{"type": "ping"}, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ack, _ := tt.client.request(tt.msg)
			if ack.Error != tt.wantErr {
				t.Errorf("ack error = %q, want %q", ack.Error, tt.wantErr)
			}
		})
	}

	t.Run("id is echoed only when given", func(t *testing.T) {
		// 成功して id がなければ ack を返さない。失敗は id なしの ack で返す。
		bob.send(map[string]any{"type": "subscribe", "room_id": f.public.ID})
		bob.send(map[string]any{"type": "subscribe", "room_id": "nope"})
		if f := bob.next(); f.Type != "ack" || f.ID != nil || f.Error != "invalid_message" {
			t.Errorf("frame = %+v, want an ack without id", f)
		}
		if err := bob.conn.Write(t.Context(), websocket.MessageText, []byte("not json")); err != nil {
			t.Fatal(err)
		}
		if f := bob.next(); f.Type != "ack" || f.Error != "invalid_message" {
			t.Errorf("frame = %+v, want invalid_message", f)
		}
		bob.send(map[string]any{"type": "ping", "id": strings.Repeat("x", 65)})
		if f := bob.next(); f.Type != "ack" || f.ID != nil || f.Error != "invalid_message" {
			t.Errorf("frame = %+v, want invalid_message for a long id", f)
		}
	})

	t.Run("typing", func(t *testing.T) {
		alice := c.dialWS(f.alice)
		alice.subscribe("room_id", f.private.ID)
		bob.sync()
		ack, _ := alice.request(map[string]any{"type": "typing", "room_id": f.private.ID})
		if ack.Error != "" {
			t.Fatal(ack.Error)
		}
		got := eventsOfType(bob.sync(), "typing.started")
		if len(got) != 1 || !strings.Contains(string(got[0].Data), f.alice.id) || !strings.Contains(string(got[0].Data), `"display_name"`) {
			t.Fatalf("typing.started = %v", got)
		}
		// 5 秒の間は配信し直さない。入力した本人には返さない。
		alice.request(map[string]any{"type": "typing", "room_id": f.private.ID})
		if got := eventsOfType(bob.sync(), "typing.started"); len(got) != 0 {
			t.Errorf("bob received typing.started again: %v", got)
		}
		if got := eventsOfType(alice.sync(), "typing.started"); len(got) != 0 {
			t.Errorf("alice received her own typing.started: %v", got)
		}

		// スレッドでの入力はチャンネルと別に間引き、thread_root_id を付けて届ける（ADR 0036）。
		r := c.as(f.alice, http.MethodPost, "/api/v1/rooms/"+f.private.ID+"/messages", map[string]string{"client_msg_id": ulid.Make().String(), "body": "親"})
		expectStatus(t, r, http.StatusCreated)
		root := decode[messageBody](t, r)
		bob.sync()
		if ack, _ := alice.request(map[string]any{"type": "typing", "room_id": f.private.ID, "thread_root_id": root.ID}); ack.Error != "" {
			t.Fatal(ack.Error)
		}
		got = eventsOfType(bob.sync(), "typing.started")
		if len(got) != 1 || !strings.Contains(string(got[0].Data), `"thread_root_id":"`+root.ID+`"`) {
			t.Fatalf("thread typing.started = %v", got)
		}
		if ack, _ := alice.request(map[string]any{"type": "typing", "room_id": f.private.ID, "thread_root_id": "nope"}); ack.Error != "invalid_message" {
			t.Errorf("malformed thread_root_id = %q, want invalid_message", ack.Error)
		}
		if ack, _ := alice.request(map[string]any{"type": "typing", "room_id": f.private.ID, "thread_root_id": ulid.Make().String()}); ack.Error != "not_found" {
			t.Errorf("unknown thread_root_id = %q, want not_found", ack.Error)
		}
	})

	t.Run("binary frame closes the connection", func(t *testing.T) {
		w := c.dialWS(f.bob)
		if err := w.conn.Write(t.Context(), websocket.MessageBinary, []byte{1}); err != nil {
			t.Fatal(err)
		}
		if code := w.waitClosed(); code != websocket.StatusPolicyViolation {
			t.Errorf("close code = %d, want 1008", code)
		}
	})

	t.Run("too large frame closes the connection", func(t *testing.T) {
		w := c.dialWS(f.bob)
		w.send(map[string]any{"type": "ping", "pad": strings.Repeat("x", 5000)})
		if code := w.waitClosed(); code != websocket.StatusMessageTooBig {
			t.Errorf("close code = %d, want 1009", code)
		}
	})
}

// スレッドの返信も、切断中に起きたものを再接続の同期（after_change_seq）で取り戻せる（Phase 6.5 の DoD。ADR 0036 / 0037）。
// 返信と、返信数の変わった親は、ルームの差分に入る。参加しているスレッドの未読も、一覧を取り直せば揃う。
// 再接続した後の返信は、message.created（返信）と message.updated（親）の順に届く。
func TestWSReconnectSyncThread(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	messages := "/api/v1/rooms/" + f.public.ID + "/messages"
	reply := func(u apiUser, rootID, body string) messageBody {
		t.Helper()
		r := c.as(u, http.MethodPost, messages, map[string]string{"client_msg_id": ulid.Make().String(), "body": body, "thread_root_id": rootID})
		expectStatus(t, r, http.StatusCreated)
		return decode[messageBody](t, r)
	}
	threads := func() threadListBody {
		t.Helper()
		r := c.as(f.bob, http.MethodGet, "/api/v1/workspaces/"+f.ws.ID+"/threads", nil)
		expectStatus(t, r, http.StatusOK)
		return decode[threadListBody](t, r)
	}

	root := decode[messageBody](t, c.sendMessage(f.alice, f.public.ID, "親"))
	// bob が返信してスレッドに参加する（自分の返信までは既読）
	reply(f.bob, root.ID, "bob の返信")
	bob := c.dialWS(f.bob)
	bob.subscribe("room_id", f.public.ID)
	bob.sync()
	// 手元のカーソル: 履歴の last_change_seq（ここまでは反映済み）
	cursor := decode[messagesBody](t, c.as(f.bob, http.MethodGet, messages, nil)).LastChangeSeq

	// 切断中に、スレッドへの返信が 2 件と、そのうち 1 件の削除が起きる。
	if err := bob.conn.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	first := reply(f.alice, root.ID, "切断中の返信 1")
	second := reply(f.alice, root.ID, "切断中の返信 2")
	expectStatus(t, c.as(f.alice, http.MethodDelete, messages+"/"+first.ID, nil), http.StatusNoContent)

	// 再接続: 購読してから差分を取る（docs/events.md の同期の手順）。
	bob = c.dialWS(f.bob)
	bob.subscribe("room_id", f.public.ID)
	local := map[string]messageBody{}
	for {
		r := c.as(f.bob, http.MethodGet, messages+"?limit=2&after_change_seq="+strconv.FormatInt(cursor, 10), nil)
		expectStatus(t, r, http.StatusOK)
		page := decode[messagesBody](t, r)
		for _, m := range page.Messages {
			if m.ChangeSeq <= cursor {
				t.Fatalf("change_seq %d after cursor %d", m.ChangeSeq, cursor)
			}
			cursor = m.ChangeSeq
			local[m.ID] = m
		}
		if !page.HasMore {
			// 同期の後に返信が届けば、カーソルの続き（last_change_seq + 1）から番号が振られている
			if next := max(cursor, page.LastChangeSeq); next != cursor {
				t.Errorf("cursor %d behind last_change_seq %d after a full sync", cursor, next)
			}
			break
		}
	}
	if m, ok := local[second.ID]; !ok || m.ThreadRootID == nil || *m.ThreadRootID != root.ID || m.Body != "切断中の返信 2" {
		t.Errorf("second reply after sync = %+v (found %v)", m, ok)
	}
	if m, ok := local[first.ID]; !ok || m.DeletedAt == nil {
		t.Errorf("deleted reply after sync = %+v (found %v), want a tombstone", m, ok)
	}
	// 親は最後の状態（返信 2 件のうち 1 件が削除されて、残りは bob の返信と 2 件目）で届く
	if m, ok := local[root.ID]; !ok || m.Thread == nil || m.Thread.ReplyCount != 2 || m.Thread.LastThreadSeq != 3 {
		t.Errorf("root after sync = %+v (found %v)", m, ok)
	}
	// 参加しているスレッドの未読: bob は自分の返信（1 件目）まで読んでいて、その後に 2 件届いた
	if got := threads(); len(got.Threads) != 1 || got.Threads[0].Root.ID != root.ID || got.Threads[0].UnreadCount != 2 {
		t.Errorf("bob's threads = %+v", got)
	}

	// 再接続した後の返信は、WebSocket で返信・親の順に届く。
	third := reply(f.alice, root.ID, "再接続の後の返信")
	var types []string
	for _, ev := range bob.sync() {
		if ev.Type != "message.created" && ev.Type != "message.updated" {
			continue
		}
		var m messageBody
		if err := json.Unmarshal(ev.Data, &m); err != nil {
			t.Fatal(err)
		}
		types = append(types, ev.Type+" "+m.ID)
	}
	if want := []string{"message.created " + third.ID, "message.updated " + root.ID}; strings.Join(types, ",") != strings.Join(want, ",") {
		t.Errorf("events after reconnect = %v, want %v", types, want)
	}
}

// DoD: 切断 → 送信 → 再接続 → 差分を取得し、取りこぼしがない。切断中の編集・削除も取れる（ADR 0014）。
func TestWSReconnectSync(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	messages := "/api/v1/rooms/" + f.public.ID + "/messages"

	bob := c.dialWS(f.bob)
	bob.subscribe("room_id", f.public.ID)
	first := decode[messageBody](t, c.sendMessage(f.alice, f.public.ID, "接続中"))
	var cursor int64
	for _, ev := range eventsOfType(bob.sync(), "message.created") {
		var m struct {
			ChangeSeq int64 `json:"change_seq"`
		}
		_ = json.Unmarshal(ev.Data, &m)
		cursor = m.ChangeSeq
	}
	// ルームの作成と bob の参加のログ（ADR 0033）が先に change_seq を使っているので、first は 3。
	if cursor != first.ChangeSeq {
		t.Fatalf("cursor = %d, want %d", cursor, first.ChangeSeq)
	}

	// 切断中に、新規・既存の編集・削除が起きる。
	if err := bob.conn.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	var wantBodies []string
	for i := range 5 {
		body := "切断中 " + strconv.Itoa(i)
		c.sendMessage(f.alice, f.public.ID, body)
		wantBodies = append(wantBodies, body)
	}
	expectStatus(t, c.as(f.alice, http.MethodPatch, messages+"/"+first.ID, map[string]string{"body": "編集した"}), http.StatusOK)
	second := decode[messagesBody](t, c.as(f.bob, http.MethodGet, messages+"?after_seq="+strconv.FormatInt(first.Seq, 10)+"&limit=1", nil)).Messages[0]
	expectStatus(t, c.as(f.alice, http.MethodDelete, messages+"/"+second.ID, nil), http.StatusNoContent)

	// 再接続: 先に購読し、その後に REST で差分を取る（docs/events.md の同期の手順）。
	bob = c.dialWS(f.bob)
	bob.subscribe("room_id", f.public.ID)
	c.sendMessage(f.alice, f.public.ID, "再接続の直後")

	type syncedMessage struct {
		ID        string  `json:"id"`
		Seq       int64   `json:"seq"`
		ChangeSeq int64   `json:"change_seq"`
		Body      string  `json:"body"`
		DeletedAt *string `json:"deleted_at"`
	}
	local := map[string]syncedMessage{}
	for {
		r := c.as(f.bob, http.MethodGet, messages+"?limit=2&after_change_seq="+strconv.FormatInt(cursor, 10), nil)
		expectStatus(t, r, http.StatusOK)
		page := decode[struct {
			Messages      []syncedMessage `json:"messages"`
			HasMore       bool            `json:"has_more"`
			LastChangeSeq int64           `json:"last_change_seq"`
		}](t, r)
		for _, m := range page.Messages {
			if m.ChangeSeq <= cursor {
				t.Fatalf("change_seq %d after cursor %d", m.ChangeSeq, cursor)
			}
			cursor = m.ChangeSeq
			local[m.ID] = m
		}
		if !page.HasMore {
			cursor = max(cursor, page.LastChangeSeq)
			break
		}
	}
	// 再接続の直後のメッセージは、REST と WebSocket の両方で届きうる（id で重複を除く）。
	for _, ev := range eventsOfType(bob.sync(), "message.created") {
		var m syncedMessage
		_ = json.Unmarshal(ev.Data, &m)
		if m.ChangeSeq > cursor {
			cursor = m.ChangeSeq
		}
		local[m.ID] = m
	}

	if got := local[first.ID]; got.Body != "編集した" {
		t.Errorf("edited message = %+v", got)
	}
	if got := local[second.ID]; got.DeletedAt == nil || got.Body != "" {
		t.Errorf("deleted message = %+v", got)
	}
	// first の次の 6 件（切断中の 5 件と再接続の直後の 1 件）が欠けずに揃う。
	bySeq := map[int64]syncedMessage{}
	for _, m := range local {
		bySeq[m.Seq] = m
	}
	for seq := first.Seq + 1; seq <= first.Seq+6; seq++ {
		if _, ok := bySeq[seq]; !ok {
			t.Errorf("seq %d is missing after sync", seq)
		}
	}
	if bySeq[first.Seq+2].Body != wantBodies[1] {
		t.Errorf("seq %d body = %q, want %q", first.Seq+2, bySeq[first.Seq+2].Body, wantBodies[1])
	}
	// first の後に、切断中の 5 件・編集・削除、再接続の直後の 1 件で 8 つ進む。
	if cursor != first.ChangeSeq+8 {
		t.Errorf("cursor = %d, want %d", cursor, first.ChangeSeq+8)
	}
}

// DoD: private ルームから外されたユーザーには、以降のイベントが届かない。
func TestWSRemovedFromRoomAndWorkspace(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	bob, bobTab2 := c.dialWS(f.bob), c.dialWS(f.bob)
	for _, w := range []*wsClient{bob, bobTab2} {
		w.subscribe("room_id", f.private.ID)
		w.subscribe("room_id", f.public.ID)
		w.subscribe("workspace_id", f.ws.ID)
	}
	alice := c.dialWS(f.alice)
	alice.subscribe("room_id", f.private.ID)

	// 他人を外せるのは、ロールが上でルームを読める人（ADR 0011）。owner を private ルームに入れてから外させる。
	expectStatus(t, c.as(f.alice, http.MethodPost, "/api/v1/rooms/"+f.private.ID+"/members", map[string]string{"user_id": f.owner.id}), http.StatusNoContent)
	expectStatus(t, c.as(f.owner, http.MethodDelete, "/api/v1/rooms/"+f.private.ID+"/members/"+f.bob.id, nil), http.StatusNoContent)
	for name, w := range map[string]*wsClient{"bob": bob, "bob tab2": bobTab2} {
		got := eventsOfType(w.sync(), "room.member_removed")
		if len(got) != 1 || !strings.Contains(string(got[0].Data), `"reason":"removed"`) || !strings.Contains(string(got[0].Data), f.private.ID) {
			t.Errorf("%s room.member_removed = %v", name, got)
		}
	}
	if got := eventsOfType(alice.sync(), "member.left"); len(got) != 1 || !strings.Contains(string(got[0].Data), f.bob.id) {
		t.Errorf("alice member.left = %v", got)
	}

	c.sendMessage(f.alice, f.private.ID, "bob には届かない")
	c.sendMessage(f.alice, f.public.ID, "bob に届く")
	events := bob.sync()
	if got := eventsOfType(events, "message.created"); len(got) != 1 || !strings.Contains(string(got[0].Data), "bob に届く") {
		t.Errorf("bob received %v, want only the public message", got)
	}
	// 外された後に購読し直そうとしても、存在を明かさずに拒否される。
	if ack, _ := bob.request(map[string]any{"type": "subscribe", "room_id": f.private.ID}); ack.Error != "not_found" {
		t.Errorf("resubscribe ack = %+v, want not_found", ack)
	}

	// ワークスペースからキックされたら、そのワークスペースの購読がすべて外れる。
	expectStatus(t, c.as(f.owner, http.MethodDelete, "/api/v1/workspaces/"+f.ws.ID+"/members/"+f.bob.id, nil), http.StatusNoContent)
	if got := eventsOfType(bob.sync(), "workspace.member_removed"); len(got) != 1 || !strings.Contains(string(got[0].Data), f.bob.id) {
		t.Errorf("bob workspace.member_removed = %v", got)
	}
	c.sendMessage(f.alice, f.public.ID, "キックの後")
	name := "改名"
	expectStatus(t, c.as(f.owner, http.MethodPatch, "/api/v1/workspaces/"+f.ws.ID, map[string]*string{"name": &name}), http.StatusOK)
	if got := bob.sync(); len(got) != 0 {
		t.Errorf("bob received %v after being kicked", got)
	}
}

func TestWSMemberJoinedReachesTheNewMember(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	carol := c.registerUser()
	carolWS := c.dialWS(carol)

	// 招待を受け入れて default ルームに入ったら、まだ何も購読していない本人に member.joined が届く。
	name := "default-" + ulid.Make().String()
	r := c.as(f.owner, http.MethodPost, "/api/v1/workspaces/"+f.ws.ID+"/rooms", map[string]string{"kind": "public", "name": name})
	expectStatus(t, r, http.StatusCreated)
	general := decode[roomBody](t, r)
	isDefault := true
	expectStatus(t, c.as(f.owner, http.MethodPatch, "/api/v1/rooms/"+general.ID, map[string]*bool{"is_default": &isDefault}), http.StatusOK)
	c.joinViaInvite(f.owner, f.ws.ID, carol)
	if got := eventsOfType(carolWS.sync(), "member.joined"); len(got) != 1 || !strings.Contains(string(got[0].Data), general.ID) {
		t.Errorf("carol member.joined = %v", got)
	}

	// 相手が DM を作ったら、本人のサイドバーに出せる。
	r = c.as(f.alice, http.MethodPost, "/api/v1/workspaces/"+f.ws.ID+"/rooms", map[string]string{"kind": "dm", "user_id": carol.id})
	expectStatus(t, r, http.StatusCreated)
	dm := decode[roomBody](t, r)
	// alice の分は DM の購読者と alice に届くので、まだ購読していない carol には carol 自身の分だけが届く。
	if got := eventsOfType(carolWS.sync(), "member.joined"); len(got) != 1 || !strings.Contains(string(got[0].Data), dm.ID) || !strings.Contains(string(got[0].Data), carol.id) {
		t.Errorf("carol member.joined for dm = %v, want 1 for carol", got)
	}
}

func TestWSPresence(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	owner := c.dialWS(f.owner)
	owner.subscribe("workspace_id", f.ws.ID)

	online := func(userID string) bool {
		t.Helper()
		r := c.as(f.owner, http.MethodGet, "/api/v1/rooms/"+f.public.ID+"/members", nil)
		expectStatus(t, r, http.StatusOK)
		for _, m := range decode[struct {
			Members []struct {
				User struct {
					ID string `json:"id"`
				} `json:"user"`
				Presence string `json:"presence"`
			} `json:"members"`
		}](t, r).Members {
			if m.User.ID == userID {
				return m.Presence == "active"
			}
		}
		t.Fatalf("%s is not a member", userID)
		return false
	}
	if online(f.bob.id) {
		t.Fatal("bob is online before connecting")
	}

	bob := c.dialWS(f.bob)
	bob.sync() // 登録が終わったことを待つ
	if got := eventsOfType(owner.sync(), "presence.changed"); len(got) != 1 || string(got[0].Data) != `{"user_id":"`+f.bob.id+`","presence":"active"}` {
		t.Errorf("presence.changed = %v", got)
	}
	if !online(f.bob.id) {
		t.Error("bob is not online in REST")
	}
	// DM の相手の presence も REST で返す。
	r := c.as(f.owner, http.MethodPost, "/api/v1/workspaces/"+f.ws.ID+"/rooms", map[string]string{"kind": "dm", "user_id": f.bob.id})
	expectStatus(t, r, http.StatusCreated)
	if !strings.Contains(string(r.body), `"presence":"active"`) {
		t.Errorf("dm_peer = %s, want online", r.body)
	}

	if err := bob.conn.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Fatal(err)
	}
	var got []wsFrame
	for len(got) == 0 {
		got = eventsOfType([]wsFrame{owner.next()}, "presence.changed")
	}
	if string(got[0].Data) != `{"user_id":"`+f.bob.id+`","presence":"offline"}` {
		t.Errorf("presence.changed after disconnect = %s", got[0].Data)
	}
	if online(f.bob.id) {
		t.Error("bob is still online in REST after disconnecting")
	}
}

// ログアウトしたセッションの接続だけが 4001 で切れる（ADR 0007）。
func TestWSSessionRevocation(t *testing.T) {
	c := newAPI(t)
	u := c.registerUser()
	// 同じユーザーの別のセッション（別の端末）。
	r := c.do(request{method: http.MethodPost, path: "/api/v1/auth/login", body: map[string]string{
		"email": emailOf(t, c, u), "password": "correct horse battery staple",
	}})
	expectStatus(t, r, http.StatusOK)
	otherDevice := apiUser{id: u.id, token: decode[tokenBody](t, r).AccessToken}

	mine, other := c.dialWS(u), c.dialWS(otherDevice)
	expectStatus(t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/logout", body: map[string]string{"refresh_token": u.refresh}}), http.StatusNoContent)
	// auth:revoked の購読（Redis）は authn のテストで確かめているので、ここでは記録された失効を Hub に渡す。
	for _, sid := range c.env.Revocations.Sessions() {
		c.hub.CloseSessions(t.Context(), authn.Revocation{SessionID: sid})
	}
	if code := mine.waitClosed(); code != 4001 {
		t.Errorf("logged-out session close code = %d, want 4001", code)
	}
	other.sync() // 別の端末の接続は生きている

	// 失効イベントを取りこぼしても、定期の再検証で切れる。
	third := c.dialWS(otherDevice)
	expectStatus(t, c.do(request{method: http.MethodPost, path: "/api/v1/auth/logout", body: map[string]string{"refresh_token": *decode[tokenBody](t, r).RefreshToken}}), http.StatusNoContent)
	c.hub.Revalidate(t.Context())
	for name, w := range map[string]*wsClient{"other": other, "third": third} {
		if code := w.waitClosed(); code != 4001 {
			t.Errorf("%s close code = %d, want 4001", name, code)
		}
	}
}

func emailOf(t *testing.T, c *apiClient, u apiUser) string {
	t.Helper()
	var email string
	if err := c.env.Pool.QueryRow(t.Context(), `SELECT email FROM users WHERE id = $1`, ulid.MustParse(u.id)).Scan(&email); err != nil {
		t.Fatal(err)
	}
	return email
}

// pong を返さないクライアントは切れる。
func TestWSPingTimeout(t *testing.T) {
	cfg := testWSConfig()
	cfg.PingInterval, cfg.PongTimeout = 20*time.Millisecond, 20*time.Millisecond
	c := newAPI(t, withWSConfig(cfg))
	u := c.registerUser()

	// 読み取らないクライアントは pong を返さない（coder/websocket は Read の中で ping に応答する）。
	conn, _, err := dial(t.Context(), c.wsURL(c.issueTicket(u)), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	// アップグレードの応答はサーバーが接続を Hub に登録する前に返るので、オンラインになるのを待つ。
	waitUntil(t, func() bool { return c.online(u.id) })
	// ping に応答しないので、サーバーが切って登録を外す（presence がオフラインになる）。
	waitUntil(t, func() bool { return !c.online(u.id) })
}

func TestWSShutdownClosesConnections(t *testing.T) {
	c := newAPI(t)
	u := c.registerUser()
	w := c.dialWS(u)
	w.sync()
	done := make(chan error, 1)
	go func() { done <- c.hub.Shutdown(t.Context()) }()
	if code := w.waitClosed(); code != websocket.StatusGoingAway {
		t.Errorf("close code = %d, want 1001", code)
	}
	if err := <-done; err != nil {
		t.Fatalf("Shutdown() = %v", err)
	}
	// 停止した後は接続できない。
	conn, _, err := dial(t.Context(), c.wsURL(c.issueTicket(u)), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.Read(t.Context()); websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Errorf("read after shutdown = %v, want 1001", err)
	}
}

// DoD: 接続を 100 本張って切る、を繰り返しても goroutine がリークしない。
func TestWSNoGoroutineLeak(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	users := []apiUser{f.owner, f.alice, f.bob}

	cycle := func() {
		clients := make([]*wsClient, 100)
		var wg sync.WaitGroup
		for i := range clients {
			wg.Go(func() {
				u := users[i%len(users)]
				ticket := c.issueTicket(u)
				conn, _, err := dial(context.Background(), c.wsURL(ticket), nil)
				if err != nil {
					t.Error(err)
					return
				}
				clients[i] = startWSClient(t, conn)
			})
		}
		wg.Wait()
		for i, w := range clients {
			if w == nil {
				continue
			}
			w.subscribe("room_id", f.public.ID)
			if i%2 == 0 {
				w.subscribe("workspace_id", f.ws.ID)
			}
		}
		c.sendMessage(f.alice, f.public.ID, "全員に届く")
		for _, w := range clients {
			if w != nil {
				// 半分は正常に閉じ、半分は close フレームなしで切る。
				if w.seq%2 == 0 {
					_ = w.conn.Close(websocket.StatusNormalClosure, "")
				} else {
					_ = w.conn.CloseNow()
				}
			}
		}
		waitUntil(t, func() bool { return !c.online(f.owner.id) && !c.online(f.alice.id) && !c.online(f.bob.id) })
	}

	cycle() // 1 回目で、プールやキャッシュなど一度だけ作られる goroutine を起動させる
	baseline := runtime.NumGoroutine()
	for range 3 {
		cycle()
	}
	// サーバー側の goroutine が終わるのを待つ。クライアント側の読み取りの goroutine も、接続を閉じれば終わる。
	waitUntil(t, func() bool { return runtime.NumGoroutine() <= baseline+5 })
}

// online は userID が presence でオンラインか（すべての接続の登録が外れたかを待つのに使う）。
func (c *apiClient) online(userID string) bool {
	c.t.Helper()
	id := ulid.MustParse(userID)
	got, err := c.presence.Online(context.Background(), []ulid.ULID{id})
	if err != nil {
		c.t.Fatal(err)
	}
	return got[id]
}

func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.After(15 * time.Second)
	for !cond() {
		select {
		case <-ticker.C:
		case <-timeout:
			t.Fatal("condition not met within 15s")
		}
	}
}

// TestWSDeliversReactions は、リアクションの付け外しが message.updated として届き、
// 受け取る人ごとの値（me）だけが落ちていることを確かめる（ロードマップ Phase 6.7 の DoD / ADR 0044）。
func TestWSDeliversReactions(t *testing.T) {
	c := newAPI(t)
	f := newChatFixture(c)
	bob := c.dialWS(f.bob)
	bob.subscribe("room_id", f.public.ID)

	msg := decode[messageWithReactionsBody](t, c.sendMessage(f.alice, f.public.ID, "これどうでしょう"))
	path := reactionPath(f.public.ID, msg.ID, "👍")
	bob.sync()

	// 付ける。専用のイベントは作らず、既存の message.updated に乗る（ADR 0044 決定 2）。
	r := c.as(f.alice, http.MethodPut, path, nil)
	expectStatus(t, r, http.StatusOK)
	rest := decode[messageWithReactionsBody](t, r)
	events := eventsOfType(bob.sync(), "message.updated")
	if len(events) != 1 {
		t.Fatalf("message.updated = %d 件, want 1", len(events))
	}
	var got messageWithReactionsBody
	if err := json.Unmarshal(events[0].Data, &got); err != nil {
		t.Fatal(err)
	}
	re, ok := reactionOf(got, "👍")
	if !ok || re.Count != 1 || !slices.Equal(re.Users, []string{f.alice.id}) {
		t.Errorf("配信された reactions = %s", events[0].Data)
	}
	// me は「受け取る人ごとの値」なので配信には載せない。REST の応答には載る（ADR 0044）。
	if re.Me != nil {
		t.Errorf("配信の me = %v, want 省略", *re.Me)
	}
	if reRest, _ := reactionOf(rest, "👍"); reRest.Me == nil || !*reRest.Me {
		t.Errorf("REST の me = %v, want true", reRest.Me)
	}
	// change_seq は進むが seq は進まないので、未読もサイドバーの並びも動かない。
	if got.ChangeSeq <= msg.ChangeSeq || got.Seq != msg.Seq {
		t.Errorf("seq / change_seq = %d / %d, want seq %d のまま", got.Seq, got.ChangeSeq, msg.Seq)
	}

	// 外すのも同じ経路。二重の PUT は行が増えないので配らない。
	expectStatus(t, c.as(f.alice, http.MethodPut, path, nil), http.StatusOK)
	expectStatus(t, c.as(f.alice, http.MethodDelete, path, nil), http.StatusOK)
	events = eventsOfType(bob.sync(), "message.updated")
	if len(events) != 1 {
		t.Fatalf("message.updated = %d 件, want 1（二重の PUT では配らない）", len(events))
	}
	var after messageWithReactionsBody
	if err := json.Unmarshal(events[0].Data, &after); err != nil {
		t.Fatal(err)
	}
	if len(after.Reactions) != 0 {
		t.Errorf("外した後の reactions = %s", events[0].Data)
	}
}
