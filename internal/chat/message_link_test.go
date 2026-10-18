package chat_test

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/authz"
	"github.com/shun2218-dev/hibari/internal/chat/chattest"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// 本文に貼られたパーマリンクのカード（ADR 0040）。
//
// この機能の肝は「見る人ごとに authz を通す」ことなので、テストは
// 「誰が読めて誰が読めないか」と「読めないときに何も漏れないか」を中心に確かめる。

func link(roomID, messageID ulid.ULID) chat.MessageLink {
	return chat.MessageLink{RoomID: roomID, MessageID: messageID}
}

func resolve(t *testing.T, env *chattest.Env, actor ulid.ULID, links ...chat.MessageLink) []chat.MessageLinkResult {
	t.Helper()
	res, err := env.Service.ResolveMessageLinks(t.Context(), actor, links)
	if err != nil {
		t.Fatalf("ResolveMessageLinks() error = %v", err)
	}
	if len(res) != len(links) {
		t.Fatalf("results = %d, want %d（リクエストと同じ件数を同じ順序で返す）", len(res), len(links))
	}
	return res
}

// wantUnavailable は、結果が unavailable で、かつ中身が何も入っていないことを確かめる。
// status だけを見ると、ルーム名や送信者が付いたままの unavailable を見逃す。
func wantUnavailable(t *testing.T, res chat.MessageLinkResult, what string) {
	t.Helper()
	if res.Status != chat.MessageLinkUnavailable {
		t.Errorf("%s: status = %q, want %q", what, res.Status, chat.MessageLinkUnavailable)
	}
	if res.Workspace != nil || res.Room != nil || res.Message != nil {
		t.Errorf("%s: unavailable なのに中身が入っている: workspace=%+v room=%+v message=%+v", what, res.Workspace, res.Room, res.Message)
	}
}

func wantOK(t *testing.T, res chat.MessageLinkResult, what string) chat.MessageLinkResult {
	t.Helper()
	if res.Status != chat.MessageLinkOK {
		t.Fatalf("%s: status = %q, want %q", what, res.Status, chat.MessageLinkOK)
	}
	if res.Workspace == nil || res.Room == nil || res.Message == nil {
		t.Fatalf("%s: ok なのに中身が欠けている: workspace=%+v room=%+v message=%+v", what, res.Workspace, res.Room, res.Message)
	}
	return res
}

// TestResolveMessageLinksVisibility は、リンクの中身が見る人の権限で決まることを確かめる。
func TestResolveMessageLinksVisibility(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public-link")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private-link")

	pub := send(t, env, r.member, public.ID, "公開の発言")
	priv := send(t, env, r.member, private.ID, "非公開の発言")

	tests := []struct {
		name  string
		actor ulid.ULID
		link  chat.MessageLink
		ok    bool
	}{
		// public はワークスペースのメンバーなら参加していなくても読める（CLAUDE.md「閲覧権限」）。
		{"public を貼った本人", r.member, link(public.ID, pub.ID), true},
		{"public を参加していないメンバー", r.admin, link(public.ID, pub.ID), true},
		{"public をワークスペースの外の人", r.outsider, link(public.ID, pub.ID), false},
		// private はメンバーだけ。「貼った人は読めても見る人は読めない」がこの機能の要。
		{"private のメンバー", r.member, link(private.ID, priv.ID), true},
		{"private に入っていないメンバー", r.member2, link(private.ID, priv.ID), false},
		{"private に入っていない admin", r.admin, link(private.ID, priv.ID), false},
		{"private をワークスペースの外の人", r.outsider, link(private.ID, priv.ID), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := resolve(t, env, tt.actor, tt.link)[0]
			if !tt.ok {
				wantUnavailable(t, res, tt.name)
				return
			}
			got := wantOK(t, res, tt.name)
			if got.Message.ID != tt.link.MessageID {
				t.Errorf("message id = %v, want %v", got.Message.ID, tt.link.MessageID)
			}
			if got.Room.ID != tt.link.RoomID {
				t.Errorf("room id = %v, want %v", got.Room.ID, tt.link.RoomID)
			}
			if got.Workspace.ID != r.ws.ID || got.Workspace.Name == "" {
				t.Errorf("workspace = %+v, want %v with a name", got.Workspace, r.ws.ID)
			}
			if got.Message.Sender.ID != r.member || got.Message.Sender.DisplayName == "" {
				t.Errorf("sender = %+v, want %v with a display name", got.Message.Sender, r.member)
			}
		})
	}
}

// TestResolveMessageLinksIndistinguishable は、読めない・存在しない・システムメッセージが
// すべて同じ unavailable になることを確かめる（ADR 0040）。
// 区別できると、リンクを貼るだけで「その ID のメッセージが実在するか」を当てられる。
func TestResolveMessageLinksIndistinguishable(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	public := createRoom(t, env, r.member, r.ws.ID, "public", "public-indist")
	private := createRoom(t, env, r.member, r.ws.ID, "private", "private-indist")
	pub := send(t, env, r.member, public.ID, "公開の発言")
	priv := send(t, env, r.member, private.ID, "非公開の発言")

	// ルームの作成のログ（ADR 0033）はシステムメッセージ。本文がないのでカードにできない。
	page, err := env.Service.ListMessages(t.Context(), r.member, public.ID, chat.MessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var system chat.Message
	for _, m := range page.Messages {
		if m.Kind == chat.MessageKindSystem {
			system = m
			break
		}
	}
	if system.ID.Compare(ulid.ULID{}) == 0 {
		t.Fatal("システムメッセージが見つからない（ルームの作成のログを期待している）")
	}

	links := []chat.MessageLink{
		link(public.ID, pub.ID),            // 読める（対照）
		link(private.ID, priv.ID),          // 読めないルーム
		link(public.ID, env.IDs.New()),     // 読めるルームの、存在しないメッセージ
		link(env.IDs.New(), env.IDs.New()), // 存在しないルーム
		link(ulid.ULID{}, ulid.ULID{}),     // ULID として読めなかった ID（httpx がゼロ値で渡す）
		link(public.ID, system.ID),         // システムメッセージ
		link(private.ID, pub.ID),           // ルームとメッセージの組み合わせが違う
	}
	// member2 は private に入っていない。
	res := resolve(t, env, r.member2, links...)

	wantOK(t, res[0], "読める public")
	for i, what := range []string{"読めない private", "存在しないメッセージ", "存在しないルーム", "ゼロ値の ID", "システムメッセージ", "ルームとメッセージの不一致"} {
		wantUnavailable(t, res[i+1], what)
	}
}

// TestResolveMessageLinksDeleted は、削除済みのメッセージが tombstone として返ることを確かめる。
// 「削除されました」と出すか「表示できません」と出すかはクライアントの判断なので、API は本文だけを空にする（ADR 0038 / 0040）。
func TestResolveMessageLinksDeleted(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public-deleted")
	msg := send(t, env, r.member, room.ID, "消す発言")
	if err := env.Service.DeleteMessage(t.Context(), r.member, room.ID, msg.ID); err != nil {
		t.Fatal(err)
	}

	got := wantOK(t, resolve(t, env, r.member, link(room.ID, msg.ID))[0], "削除済み")
	if got.Message.DeletedAt == nil {
		t.Error("deleted_at = nil, want 削除の時刻")
	}
	if got.Message.Body != "" {
		t.Errorf("body = %q, want 空（削除で本文を消す）", got.Message.Body)
	}
	if got.Message.Sender.ID != r.member {
		t.Errorf("sender = %v, want %v（tombstone でも送信者は返す）", got.Message.Sender.ID, r.member)
	}
}

// TestResolveMessageLinksEdited は、編集済みのメッセージが編集後の本文で返ることを確かめる。
// カードは「表示するときに取るだけ」なので、開き直せば最新になる（ADR 0040）。
func TestResolveMessageLinksEdited(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public-edited")
	msg := send(t, env, r.member, room.ID, "編集前")
	if _, err := env.Service.EditMessage(t.Context(), r.member, room.ID, msg.ID, "編集後"); err != nil {
		t.Fatal(err)
	}

	got := wantOK(t, resolve(t, env, r.member, link(room.ID, msg.ID))[0], "編集済み")
	if got.Message.Body != "編集後" {
		t.Errorf("body = %q, want %q", got.Message.Body, "編集後")
	}
	if got.Message.EditedAt == nil {
		t.Error("edited_at = nil, want 編集の時刻")
	}
}

// TestResolveMessageLinksThreadReply は、スレッドの返信のリンクが親の ID を返すことを確かめる。
// カードを押したときにどのパネルを開くかを、クライアントがこれで決める（ADR 0040）。
func TestResolveMessageLinksThreadReply(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public-thread")
	root := send(t, env, r.member, room.ID, "親")
	reply, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID,
		chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "返信", ThreadRootID: &root.ID})
	if err != nil {
		t.Fatal(err)
	}

	got := wantOK(t, resolve(t, env, r.member, link(room.ID, reply.ID))[0], "スレッドの返信")
	if got.Message.ThreadRootID == nil || *got.Message.ThreadRootID != root.ID {
		t.Errorf("thread_root_id = %v, want %v", got.Message.ThreadRootID, root.ID)
	}
	// チャンネルの投稿には親がない。
	parent := wantOK(t, resolve(t, env, r.member, link(room.ID, root.ID))[0], "親")
	if parent.Message.ThreadRootID != nil {
		t.Errorf("親の thread_root_id = %v, want nil", parent.Message.ThreadRootID)
	}
}

// TestResolveMessageLinksDM は、dm のリンクが相手のプロフィールを返すことを確かめる。
// dm にはルーム名がないので、カードは相手の名前を出す。
func TestResolveMessageLinksDM(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	dm, _ := createDM(t, env, r.member, r.ws.ID, r.member2)
	msg := send(t, env, r.member, dm.ID, "2 人だけの話")

	got := wantOK(t, resolve(t, env, r.member, link(dm.ID, msg.ID))[0], "dm")
	if got.Room.Kind != authz.RoomDM {
		t.Errorf("kind = %q, want %q", got.Room.Kind, authz.RoomDM)
	}
	if got.Room.Name != "" {
		t.Errorf("name = %q, want 空（dm にルーム名はない）", got.Room.Name)
	}
	if got.Room.DMPeer == nil || got.Room.DMPeer.ID != r.member2 {
		t.Errorf("dm_peer = %+v, want %v", got.Room.DMPeer, r.member2)
	}
	// 相手から見ると、相手の dm_peer は自分ではなく貼った人になる。
	peer := wantOK(t, resolve(t, env, r.member2, link(dm.ID, msg.ID))[0], "dm（相手から）")
	if peer.Room.DMPeer == nil || peer.Room.DMPeer.ID != r.member {
		t.Errorf("相手から見た dm_peer = %+v, want %v", peer.Room.DMPeer, r.member)
	}
	// dm の外の人には見えない。
	wantUnavailable(t, resolve(t, env, r.admin, link(dm.ID, msg.ID))[0], "dm を第三者が")
}

// TestResolveMessageLinksCrossWorkspace は、別のワークスペースのリンクも、読めるなら出すことを確かめる（ADR 0040）。
// 認可はルームの単位なので、ワークスペースが違うことそのものは理由にしない。
func TestResolveMessageLinksCrossWorkspace(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	// member は ws1 と ws2 の両方に、admin は ws1 だけにいる。
	other := env.CreateWorkspace(t, r.member)
	room1 := createRoom(t, env, r.member, r.ws.ID, "public", "public-cross-1")
	room2 := createRoom(t, env, r.member, other.ID, "public", "public-cross-2")
	msg1 := send(t, env, r.member, room1.ID, "ws1 の発言")
	msg2 := send(t, env, r.member, room2.ID, "ws2 の発言")

	both := resolve(t, env, r.member, link(room1.ID, msg1.ID), link(room2.ID, msg2.ID))
	first := wantOK(t, both[0], "同じワークスペース")
	second := wantOK(t, both[1], "別のワークスペース")
	if first.Workspace.ID != r.ws.ID || second.Workspace.ID != other.ID {
		t.Errorf("workspaces = %v, %v; want %v, %v", first.Workspace.ID, second.Workspace.ID, r.ws.ID, other.ID)
	}
	if second.Workspace.Name != other.Name {
		t.Errorf("別のワークスペースの名前 = %q, want %q", second.Workspace.Name, other.Name)
	}
	// admin は ws2 にいないので、そこのリンクは読めない。
	res := resolve(t, env, r.admin, link(room1.ID, msg1.ID), link(room2.ID, msg2.ID))
	wantOK(t, res[0], "admin から見た ws1")
	wantUnavailable(t, res[1], "admin から見た ws2")
}

// TestResolveMessageLinksOrderAndDuplicates は、結果が「リクエストと同じ順序・同じ件数」で、
// 同じメッセージを 2 回貼っても両方に中身が入ることを確かめる。
func TestResolveMessageLinksOrderAndDuplicates(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public-order")
	a := send(t, env, r.member, room.ID, "1 つ目")
	b := send(t, env, r.member, room.ID, "2 つ目")

	res := resolve(t, env, r.member,
		link(room.ID, b.ID),
		link(env.IDs.New(), env.IDs.New()),
		link(room.ID, a.ID),
		link(room.ID, b.ID),
	)
	if got := wantOK(t, res[0], "1 番目").Message.Body; got != "2 つ目" {
		t.Errorf("res[0].body = %q, want %q", got, "2 つ目")
	}
	wantUnavailable(t, res[1], "2 番目")
	if got := wantOK(t, res[2], "3 番目").Message.Body; got != "1 つ目" {
		t.Errorf("res[2].body = %q, want %q", got, "1 つ目")
	}
	// 同じメッセージへの 2 つ目のリンクにも、独立した中身が入る。
	if got := wantOK(t, res[3], "4 番目").Message.Body; got != "2 つ目" {
		t.Errorf("res[3].body = %q, want %q", got, "2 つ目")
	}
	if res[0].Message == res[3].Message {
		t.Error("同じメッセージへの 2 つのリンクが同じポインタを指している（片方を書き換えると両方変わる）")
	}
}

// TestResolveMessageLinksLimit は、上限を超えたら 422 になり、空のリクエストは空で返ることを確かめる。
func TestResolveMessageLinksLimit(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public-limit")
	msg := send(t, env, r.member, room.ID, "発言")

	empty, err := env.Service.ResolveMessageLinks(t.Context(), r.member, nil)
	if err != nil || len(empty) != 0 {
		t.Errorf("空のリクエスト = %v, %v; want 空, nil", empty, err)
	}

	atLimit := make([]chat.MessageLink, chat.MaxMessageLinks)
	for i := range atLimit {
		atLimit[i] = link(room.ID, msg.ID)
	}
	if res := resolve(t, env, r.member, atLimit...); len(res) != chat.MaxMessageLinks {
		t.Errorf("上限ちょうど = %d 件, want %d", len(res), chat.MaxMessageLinks)
	}

	tooMany := append(atLimit, link(room.ID, msg.ID)) //nolint:gocritic // 上限 + 1 を作る
	_, err = env.Service.ResolveMessageLinks(t.Context(), r.member, tooMany)
	var ve *chat.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("上限 + 1 の error = %v, want *chat.ValidationError", err)
	}
	if len(ve.Fields) != 1 || ve.Fields[0].Field != "links" || ve.Fields[0].Reason != chat.ReasonTooLong {
		t.Errorf("fields = %+v, want links: %s", ve.Fields, chat.ReasonTooLong)
	}
}

// TestResolveMessageLinksAttachmentCount は、添付の件数が入ることを確かめる。
// カードに画像は出さないので、件数だけを返す（ADR 0040）。
func TestResolveMessageLinksAttachmentCount(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room := createRoom(t, env, r.member, r.ws.ID, "public", "public-attach-link")

	body := []byte("hello")
	a1 := uploadAttachment(t, env, r.member, room.ID, textInput("a.txt", body), body)
	a2 := uploadAttachment(t, env, r.member, room.ID, textInput("b.txt", body), body)
	withFiles, _, err := env.Service.SendMessage(t.Context(), r.member, room.ID,
		chat.SendMessageInput{ClientMsgID: env.IDs.New(), Body: "添付つき", AttachmentIDs: []ulid.ULID{a1.ID, a2.ID}})
	if err != nil {
		t.Fatal(err)
	}
	plain := send(t, env, r.member, room.ID, "添付なし")

	res := resolve(t, env, r.member, link(room.ID, withFiles.ID), link(room.ID, plain.ID))
	if got := wantOK(t, res[0], "添付つき").Message.AttachmentCount; got != 2 {
		t.Errorf("attachment_count = %d, want 2", got)
	}
	if got := wantOK(t, res[1], "添付なし").Message.AttachmentCount; got != 0 {
		t.Errorf("attachment_count = %d, want 0", got)
	}
}

// queryCounter は実行したクエリを SQL ごとに数える pgx.QueryTracer。
type queryCounter struct {
	counts map[string]*atomic.Int64
}

func (c *queryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	for name, n := range c.counts {
		// sqlc は SQL の先頭に `-- name: X :many` のコメントを残すので、それで見分ける。
		if len(data.SQL) >= len(name) && data.SQL[:len(name)] == name {
			n.Add(1)
		}
	}
	return ctx
}

func (c *queryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// TestResolveMessageLinksNoNPlusOne は、リンクが何件あっても、ルームの認可がルームごとに 1 回で済むことを確かめる
// （CLAUDE.md「一覧 API は N+1 クエリにならない形で書く」）。
//
// カードは 1 画面に何枚も出るので、ここが N+1 だとリンクを貼るほど遅くなる。
func TestResolveMessageLinksNoNPlusOne(t *testing.T) {
	env := chattest.New(t)
	r := setupRoles(t, env)
	room1 := createRoom(t, env, r.member, r.ws.ID, "public", "public-n1-1")
	room2 := createRoom(t, env, r.member, r.ws.ID, "public", "public-n1-2")
	m1 := send(t, env, r.member, room1.ID, "1")
	m2 := send(t, env, r.member, room2.ID, "2")

	// 数えるために、同じテスト用 DB につないだ別のプールでサービスを組み立てる。
	counter := &queryCounter{counts: map[string]*atomic.Int64{
		"-- name: GetRoom :one":                     {},
		"-- name: GetWorkspaceMemberRoles :many":    {},
		"-- name: GetRoomMemberships :many":         {},
		"-- name: GetWorkspaceNames :many":          {},
		"-- name: ListAttachmentsForMessages :many": {},
	}}
	svc := tracedService(t, env, counter)

	// 10 件のリンクを 2 つのルームに散らす。
	links := make([]chat.MessageLink, 0, 10)
	for range 5 {
		links = append(links, link(room1.ID, m1.ID), link(room2.ID, m2.ID))
	}
	res, err := svc.ResolveMessageLinks(t.Context(), r.member, links)
	if err != nil {
		t.Fatalf("ResolveMessageLinks() error = %v", err)
	}
	for i := range res {
		wantOK(t, res[i], "N+1 のテスト")
	}

	// ルームは 2 つなので、ルームごとの問い合わせは 2 回ずつ。リンクの数（10）には比例しない。
	for _, name := range []string{"-- name: GetRoom :one", "-- name: GetWorkspaceMemberRoles :many", "-- name: GetRoomMemberships :many"} {
		if got := counter.counts[name].Load(); got != 2 {
			t.Errorf("%s = %d 回, want 2（ルームの数）", name, got)
		}
	}
	// ワークスペースの名前と添付は、まとめて引く。
	if got := counter.counts["-- name: GetWorkspaceNames :many"].Load(); got != 1 {
		t.Errorf("GetWorkspaceNames = %d 回, want 1", got)
	}
	if got := counter.counts["-- name: ListAttachmentsForMessages :many"].Load(); got != 2 {
		t.Errorf("ListAttachmentsForMessages = %d 回, want 2（ルームの数）", got)
	}
}

// tracedService は、クエリを数えるトレーサを付けた別のプールで chat.Service を組み立てる。
// chattest.New のプールはトレーサを差せないので、ここだけ自前でプールを作る（つなぎ先は同じテスト用 DB）。
func tracedService(t *testing.T, env *chattest.Env, tracer pgx.QueryTracer) *chat.Service {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(testenv.DatabaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Tracer = tracer
	cfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		db.RegisterTypes(conn.TypeMap())
		return nil
	}
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return chat.NewService(chat.Deps{
		DB:               pool,
		Clock:            env.Clock,
		IDs:              env.IDs,
		Random:           rand.Reader,
		Logger:           slog.New(slog.DiscardHandler),
		Storage:          env.Storage,
		AttachmentLimits: chattest.AttachmentLimits,
		Delivery:         env.Deliveries,
		Presence:         realtime.PresenceStates{Store: env.Presence},
	})
}
