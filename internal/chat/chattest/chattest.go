// Package chattest は、chat.Service を実物の Postgres に対して組み立てるテスト用のヘルパー。
//
// chat と httpx の統合テストで同じ組み立てを繰り返さないために置く。本番のコードからは import しない。
package chattest

import (
	"crypto/rand"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

// Start はテストの時計の初期値。
var Start = time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)

// Env は組み立て済みの Service とその依存。
type Env struct {
	Pool    *pgxpool.Pool
	Clock   *clock.Fake
	IDs     id.Generator
	Service *chat.Service
}

// New は Env を返す。TEST_DATABASE_URL がなければテストをスキップする（CI では失敗する）。
func New(t testing.TB) *Env {
	t.Helper()
	pool, err := db.Open(t.Context(), testenv.DatabaseURL(t))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(pool.Close)
	clk := clock.NewFake(Start)
	ids := id.NewGenerator(clk, rand.Reader)
	return &Env{
		Pool:  pool,
		Clock: clk,
		IDs:   ids,
		Service: chat.NewService(chat.Deps{
			DB:     pool,
			Clock:  clk,
			IDs:    ids,
			Random: rand.Reader,
			Logger: slog.New(slog.DiscardHandler),
		}),
	}
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
