// Package chattest は、chat.Service を実物の Postgres に対して組み立てるテスト用のヘルパー。
//
// chat と httpx の統合テストで同じ組み立てを繰り返さないために置く。本番のコードからは import しない。
package chattest

import (
	"context"
	"crypto/rand"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/chat/presence"
	"github.com/shun2218-dev/hibari/internal/chat/realtime"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/config"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/redis"
	"github.com/shun2218-dev/hibari/internal/platform/storage"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// Start はテストの時計の初期値。
var Start = time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)

// AttachmentLimits はテストで使う添付の設定値。本番の既定値と同じ。
var AttachmentLimits = chat.AttachmentLimits{MaxBytes: config.DefaultAttachmentMaxBytes, AllowedTypes: config.DefaultAttachmentAllowedTypes}

// Env は組み立て済みの Service とその依存。
type Env struct {
	Pool     *pgxpool.Pool
	Clock    *clock.Fake
	IDs      id.Generator
	Storage  *storage.S3
	Presence *presence.Store
	// Deliveries は Service が配信したイベントを記録する。
	Deliveries *Recorder
	Service    *chat.Service
}

// Recorder は配信されたイベントを記録する chat.Delivery。
type Recorder struct {
	mu     sync.Mutex
	events []chat.Event
}

// Deliver はイベントを記録する。
func (r *Recorder) Deliver(_ context.Context, ev chat.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, ev)
}

// Take は記録したイベントを返し、記録を空にする。
func (r *Recorder) Take() []chat.Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	evs := r.events
	r.events = nil
	return evs
}

// NewPresence はテスト用の Redis に接続した presence.Store を返す。
func NewPresence(t testing.TB) *presence.Store {
	t.Helper()
	rdb, err := redis.Open(t.Context(), testenv.RedisURL(t))
	if err != nil {
		t.Fatalf("open redis: %v", err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	// テストごとに別のインスタンスとして数える。
	return presence.New(rdb, id.NewGenerator(clock.System{}, rand.Reader).New())
}

type options struct {
	start    time.Time
	presence chat.PresenceReader
}

// Option は New の組み立てを変える。
type Option func(*options)

// WithClockStart は時計の初期値を変える。
//
// 添付の掃除ジョブは、テスト用 DB にある「時計で見て古い」添付をすべて消す。テスト用 DB はパッケージをまたいで共有するので、
// 掃除を実行するテストは、ほかのテストの時計（Start 前後）より十分に過去から始めて、ほかのテストの添付を消さないようにする。
func WithClockStart(t time.Time) Option {
	return func(o *options) { o.start = t }
}

// OnlineUsers は「誰が画面を見ているか（active）」を固定する chat.PresenceReader。
// @here の対象（ADR 0041）のように presence の中身が結果を決めるテストで、Redis の TTL に依存させないために使う
// （時刻に依存するテストで Clock を固定するのと同じ考え方。CLAUDE.md「テスト」）。
type OnlineUsers []ulid.ULID

// Presence は chat.PresenceReader を満たす。並んでいない人は offline にする。
func (o OnlineUsers) Presence(_ context.Context, userIDs []ulid.ULID) (map[ulid.ULID]chat.Presence, error) {
	out := make(map[ulid.ULID]chat.Presence, len(userIDs))
	for _, id := range userIDs {
		if slices.Contains(o, id) {
			out[id] = chat.PresenceActive
		} else {
			out[id] = chat.PresenceOffline
		}
	}
	return out, nil
}

// WithPresenceReader は Service が使う presence を差し替える（Env.Presence は実物のままにする）。
func WithPresenceReader(p chat.PresenceReader) Option {
	return func(o *options) { o.presence = p }
}

// New は Env を返す。TEST_DATABASE_URL などがなければテストをスキップする（CI では失敗する）。
func New(t testing.TB, opts ...Option) *Env {
	t.Helper()
	o := options{start: Start}
	for _, opt := range opts {
		opt(&o)
	}
	pool, err := db.Open(t.Context(), testenv.DatabaseURL(t))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(pool.Close)
	clk := clock.NewFake(o.start)
	ids := id.NewGenerator(clk, rand.Reader)
	st := NewStorage(t)
	pr := NewPresence(t)
	rec := &Recorder{}
	var svcPresence chat.PresenceReader = realtime.PresenceStates{Store: pr}
	if o.presence != nil {
		svcPresence = o.presence
	}
	return &Env{
		Pool:       pool,
		Clock:      clk,
		IDs:        ids,
		Storage:    st,
		Presence:   pr,
		Deliveries: rec,
		Service: chat.NewService(chat.Deps{
			DB:               pool,
			Clock:            clk,
			IDs:              ids,
			Random:           rand.Reader,
			Logger:           slog.New(slog.DiscardHandler),
			Storage:          st,
			AttachmentLimits: AttachmentLimits,
			Delivery:         rec,
			Presence:         svcPresence,
		}),
	}
}

// NewStorage はテスト用のバケット（MinIO）に接続した S3 を返す。
// テストはコンテナの中から署名付き URL にも PUT するので、公開エンドポイントは分けない。
func NewStorage(t testing.TB) *storage.S3 {
	t.Helper()
	env := testenv.S3(t)
	st, err := storage.New(storage.Config{
		Endpoint:        env.Endpoint,
		Region:          "us-east-1",
		Bucket:          env.Bucket,
		AccessKeyID:     env.AccessKeyID,
		SecretAccessKey: env.SecretAccessKey,
		UsePathStyle:    true,
	})
	if err != nil {
		t.Fatalf("open storage: %v", err)
	}
	return st
}

// CreateUser はユーザーを作って ID を返す。
//
// chat は auth を import できない（ADR 0001）ので、登録のユースケースを通さずに SQL で直接入れる。
// chat が users に書き込んでよいのはこのテスト用のヘルパーだけ。
// テスト用 DB はパッケージをまたいで共有するので、handle と email は実行ごとに一意にする。
func (e *Env) CreateUser(t testing.TB) ulid.ULID {
	t.Helper()
	userID := e.IDs.New()
	handle := "c" + strings.ToLower(userID.String())
	_, err := e.Pool.Exec(t.Context(),
		`INSERT INTO users (id, handle, display_name, email, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
		userID, handle, "チャット "+handle[len(handle)-4:], handle+"@example.com", e.Clock.Now())
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return userID
}

// VerifyEmail は userID の email を検証済みにする（CreateUser と同じく、auth のユースケースを通さずに SQL で）。
func (e *Env) VerifyEmail(t testing.TB, userID ulid.ULID) {
	t.Helper()
	if _, err := e.Pool.Exec(t.Context(), `UPDATE users SET email_verified_at = $2 WHERE id = $1`, userID, e.Clock.Now()); err != nil {
		t.Fatalf("verify email: %v", err)
	}
}

// CreateUsers は n 人のユーザーを作る。
func (e *Env) CreateUsers(t testing.TB, n int) []ulid.ULID {
	t.Helper()
	ids := make([]ulid.ULID, n)
	for i := range ids {
		ids[i] = e.CreateUser(t)
	}
	return ids
}

// CreateWorkspace は owner のワークスペースを作る。
func (e *Env) CreateWorkspace(t testing.TB, owner ulid.ULID) chat.Workspace {
	t.Helper()
	ws, err := e.Service.CreateWorkspace(t.Context(), owner, "テスト用ワークスペース")
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	return ws
}

// AddMember は userID を role でワークスペースに入れる。
// 招待の受け入れ（Phase 3a の後半）を経由せずに、ロールの組み合わせを直接作るためのもの。
func (e *Env) AddMember(t testing.TB, workspaceID, userID ulid.ULID, role chat.Role) {
	t.Helper()
	_, err := e.Pool.Exec(t.Context(),
		`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)`,
		workspaceID, userID, string(role), e.Clock.Now())
	if err != nil {
		t.Fatalf("add member: %v", err)
	}
}

// Role は userID のロールを DB から読む。メンバーでなければ空文字列。
func (e *Env) Role(t testing.TB, workspaceID, userID ulid.ULID) chat.Role {
	t.Helper()
	var role string
	err := e.Pool.QueryRow(t.Context(),
		`SELECT coalesce((SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2), '')`,
		workspaceID, userID).Scan(&role)
	if err != nil {
		t.Fatalf("get role: %v", err)
	}
	return chat.Role(role)
}

// RoomOptions は InsertRoom で作るルームの属性。
type RoomOptions struct {
	Kind           string // 既定は public
	IsDefault      bool
	LastMessageSeq int64
}

// InsertRoom はルームを SQL で直接作り、ID を返す。ルームの作成のユースケースを通さずに、
// is_default や last_message_seq を持つ状態を作るためのもの。
func (e *Env) InsertRoom(t testing.TB, workspaceID, creator ulid.ULID, opts RoomOptions) ulid.ULID {
	t.Helper()
	if opts.Kind == "" {
		opts.Kind = "public"
	}
	roomID := e.IDs.New()
	_, err := e.Pool.Exec(t.Context(),
		`INSERT INTO rooms (id, workspace_id, kind, name, is_default, created_by, last_message_seq, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		roomID, workspaceID, opts.Kind, "room-"+strings.ToLower(roomID.String()), opts.IsDefault, creator, opts.LastMessageSeq, e.Clock.Now())
	if err != nil {
		t.Fatalf("insert room: %v", err)
	}
	return roomID
}

// InsertRoomMember はルームのメンバーを SQL で直接入れる。すでにメンバーなら何もしない。
func (e *Env) InsertRoomMember(t testing.TB, roomID, userID ulid.ULID) {
	t.Helper()
	_, err := e.Pool.Exec(t.Context(),
		`INSERT INTO room_members (room_id, user_id, last_read_seq, joined_at) VALUES ($1, $2, 0, $3) ON CONFLICT DO NOTHING`,
		roomID, userID, e.Clock.Now())
	if err != nil {
		t.Fatalf("insert room member: %v", err)
	}
}
