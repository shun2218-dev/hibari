// スキーマの制約が意図どおりに効くことを、実物の Postgres で確かめる。
//
// アプリのチェックをすり抜けた（または並行して競合した）ときの最後の砦が DB の制約なので、
// 「どの操作が、どの制約名で拒否されるか」をテストとして固定しておく。
// 前提: テスト用 DB に `make migrate-up` 済みであること（CI も同じ順で実行する）。
package db_test

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/store"
	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

const (
	sqlstateNotNull    = "23502"
	sqlstateForeignKey = "23503"
	sqlstateUnique     = "23505"
	sqlstateCheck      = "23514"
)

var (
	now = time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	ids = id.NewGenerator(clock.NewFake(now), rand.Reader)
)

func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := db.Open(t.Context(), testenv.DatabaseURL(t))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// inTx は fn をトランザクションの中で実行し、最後に必ずロールバックする。
// テスト同士がデータを残さないので、何度実行しても結果が変わらない。
func inTx(t *testing.T, pool *pgxpool.Pool, fn func(tx pgx.Tx)) {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
	fn(tx)
}

func mustExec(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(t.Context(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// expectViolation は sql が、指定した SQLSTATE と制約名で失敗することを確かめる。
// 失敗した文の後もトランザクションを使い続けられるよう、SAVEPOINT の中で実行する。
func expectViolation(t *testing.T, tx pgx.Tx, code, constraint, sql string, args ...any) {
	t.Helper()
	sp, err := tx.Begin(t.Context())
	if err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	defer func() { _ = sp.Rollback(context.WithoutCancel(t.Context())) }()

	_, err = sp.Exec(t.Context(), sql, args...)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("exec %q: got %v, want SQLSTATE %s (%s)", sql, err, code, constraint)
	}
	if pgErr.Code != code || (constraint != "" && pgErr.ConstraintName != constraint) {
		t.Fatalf("exec %q: got SQLSTATE %s constraint %q (%s), want %s %q",
			sql, pgErr.Code, pgErr.ConstraintName, pgErr.Message, code, constraint)
	}
}

func hash(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

// ---- フィクスチャ ----

func insertUser(t *testing.T, tx pgx.Tx, handle string) ulid.ULID {
	t.Helper()
	uid := ids.New()
	mustExec(t, tx, `INSERT INTO users (id, handle, display_name, email, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $5)`, uid, handle, handle, handle+"@example.com", now)
	return uid
}

func insertWorkspace(t *testing.T, tx pgx.Tx, owner ulid.ULID) ulid.ULID {
	t.Helper()
	wid := ids.New()
	mustExec(t, tx, `INSERT INTO workspaces (id, slug, name, created_by, created_at, updated_at)
		VALUES ($1, $2, 'ws', $3, $4, $4)`, wid, "ws-"+wid.String(), owner, now)
	mustExec(t, tx, `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
		VALUES ($1, $2, 'owner', $3)`, wid, owner, now)
	return wid
}

func insertRoom(t *testing.T, tx pgx.Tx, workspaceID, creator ulid.ULID, name string) ulid.ULID {
	t.Helper()
	rid := ids.New()
	mustExec(t, tx, `INSERT INTO rooms (id, workspace_id, kind, name, created_by, created_at)
		VALUES ($1, $2, 'public', $3, $4, $5)`, rid, workspaceID, name, creator, now)
	return rid
}

// insertMessage はメッセージを入れる。threadRoot を渡すとスレッドの返信にする（thread_seq は seq と同じ値。ADR 0036）。
func insertMessage(t *testing.T, tx pgx.Tx, roomID, sender ulid.ULID, seq int64, threadRoot *ulid.ULID) ulid.ULID {
	t.Helper()
	mid := ids.New()
	mustExec(t, tx, `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, thread_root_id, thread_seq, in_channel, created_at)
		VALUES ($1, $2, $3::bigint, $3::bigint, $3::bigint, $4, $5, 'hi', $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE $3::bigint END, $6::uuid IS NULL, $7)`,
		mid, roomID, seq, sender, ids.New(), threadRoot, now)
	return mid
}

// ---- 認証 ----

func TestUsersConstraints(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		insertUser(t, tx, "alice")

		// citext なので大文字小文字だけが違う handle / email は重複扱い。
		expectViolation(t, tx, sqlstateUnique, "users_handle_key",
			`INSERT INTO users (id, handle, display_name, email, created_at, updated_at) VALUES ($1, 'ALICE', 'x', 'other@example.com', $2, $2)`,
			ids.New(), now)
		expectViolation(t, tx, sqlstateUnique, "users_email_key",
			`INSERT INTO users (id, handle, display_name, email, created_at, updated_at) VALUES ($1, 'bob', 'x', 'Alice@Example.com', $2, $2)`,
			ids.New(), now)
	})
}

func TestRefreshTokensConstraints(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		uid := insertUser(t, tx, "alice")
		const insert = `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, revoked_at, revoked_reason, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $5)`

		mustExec(t, tx, insert, ids.New(), uid, ids.New(), hash("t1"), now, nil, nil)

		// 生のトークン（32 バイトでない値）を入れてしまうミスを止める。
		expectViolation(t, tx, sqlstateCheck, "refresh_tokens_token_hash_check",
			insert, ids.New(), uid, ids.New(), []byte("raw-refresh-token"), now, nil, nil)
		expectViolation(t, tx, sqlstateUnique, "refresh_tokens_token_hash_key",
			insert, ids.New(), uid, ids.New(), hash("t1"), now, nil, nil)
		// 失効日時と理由は揃える。
		expectViolation(t, tx, sqlstateCheck, "refresh_tokens_revoked_consistent",
			insert, ids.New(), uid, ids.New(), hash("t2"), now, now, nil)
		expectViolation(t, tx, sqlstateCheck, "refresh_tokens_revoked_consistent",
			insert, ids.New(), uid, ids.New(), hash("t3"), now, nil, "logout")
		expectViolation(t, tx, sqlstateCheck, "refresh_tokens_revoked_reason_check",
			insert, ids.New(), uid, ids.New(), hash("t4"), now, now, "expired")
	})
}

// ---- ワークスペース ----

func TestWorkspaceOwnerIsUnique(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		owner := insertUser(t, tx, "owner")
		admin := insertUser(t, tx, "admin")
		wid := insertWorkspace(t, tx, owner)
		mustExec(t, tx, `INSERT INTO workspace_members VALUES ($1, $2, 'admin', $3)`, wid, admin, now)

		// 2 人目の owner は作れない。
		expectViolation(t, tx, sqlstateUnique, "workspace_members_one_owner_idx",
			`UPDATE workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, wid, admin)

		// 譲渡は「旧 owner を降格 → 新 owner を昇格」の順なら通る（部分 UNIQUE インデックスは文ごとに検査される）。
		mustExec(t, tx, `UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, wid, owner)
		mustExec(t, tx, `UPDATE workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, wid, admin)

		// 別のワークスペースには別の owner がいてよい。
		insertWorkspace(t, tx, owner)
	})
}

func TestWorkspaceInviteUseCount(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		owner := insertUser(t, tx, "owner")
		wid := insertWorkspace(t, tx, owner)
		inv := ids.New()
		mustExec(t, tx, `INSERT INTO workspace_invites (id, workspace_id, code_hash, created_by, max_uses, expires_at, created_at)
			VALUES ($1, $2, $3, $4, 2, $5, $5)`, inv, wid, hash("code"), owner, now.Add(time.Hour))

		// 条件を付けずに加算しても、上限を超える加算は CHECK で拒否される。
		mustExec(t, tx, `UPDATE workspace_invites SET use_count = use_count + 1 WHERE id = $1`, inv)
		mustExec(t, tx, `UPDATE workspace_invites SET use_count = use_count + 1 WHERE id = $1`, inv)
		expectViolation(t, tx, sqlstateCheck, "workspace_invites_use_count_range",
			`UPDATE workspace_invites SET use_count = use_count + 1 WHERE id = $1`, inv)

		expectViolation(t, tx, sqlstateCheck, "workspace_invites_max_uses_check",
			`INSERT INTO workspace_invites (id, workspace_id, code_hash, created_by, max_uses, expires_at, created_at)
			VALUES ($1, $2, $3, $4, 0, $5, $5)`, ids.New(), wid, hash("code2"), owner, now)
	})
}

// ---- ルーム ----

func TestRoomsConstraints(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		u := insertUser(t, tx, "alice")
		w1 := insertWorkspace(t, tx, u)
		w2 := insertWorkspace(t, tx, u)
		const insert = `INSERT INTO rooms (id, workspace_id, kind, name, dm_key, is_default, created_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

		insertRoom(t, tx, w1, u, "general")
		// 名前はワークスペース内で一意。別のワークスペースなら同じ名前でよい。
		expectViolation(t, tx, sqlstateUnique, "rooms_workspace_id_name_idx",
			insert, ids.New(), w1, "private", "general", nil, false, u, now)
		insertRoom(t, tx, w2, u, "general")

		// kind ごとに持つべき列。
		expectViolation(t, tx, sqlstateCheck, "rooms_kind_columns",
			insert, ids.New(), w1, "dm", "named-dm", "a:b", false, u, now)
		expectViolation(t, tx, sqlstateCheck, "rooms_kind_columns",
			insert, ids.New(), w1, "dm", nil, nil, false, u, now)
		expectViolation(t, tx, sqlstateCheck, "rooms_kind_columns",
			insert, ids.New(), w1, "dm", nil, "a:b", true, u, now)
		expectViolation(t, tx, sqlstateCheck, "rooms_kind_columns",
			insert, ids.New(), w1, "public", nil, nil, false, u, now)
		expectViolation(t, tx, sqlstateCheck, "rooms_kind_columns",
			insert, ids.New(), w1, "public", "random", "a:b", false, u, now)

		// 同じ 2 人の DM はワークスペース内に 1 つ。
		mustExec(t, tx, insert, ids.New(), w1, "dm", nil, "a:b", false, u, now)
		expectViolation(t, tx, sqlstateUnique, "rooms_workspace_id_dm_key_idx",
			insert, ids.New(), w1, "dm", nil, "a:b", false, u, now)
		mustExec(t, tx, insert, ids.New(), w2, "dm", nil, "a:b", false, u, now)
	})
}

func TestRoomMembersRequiresLastReadSeq(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		u := insertUser(t, tx, "alice")
		rid := insertRoom(t, tx, insertWorkspace(t, tx, u), u, "general")

		// 初期化の書き忘れを INSERT のエラーにする（DEFAULT 0 だと過去のメッセージがすべて未読になる）。
		expectViolation(t, tx, sqlstateNotNull, "",
			`INSERT INTO room_members (room_id, user_id, joined_at) VALUES ($1, $2, $3)`, rid, u, now)
	})
}

// ---- メッセージ ----

func TestMessagesConstraints(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		alice := insertUser(t, tx, "alice")
		bob := insertUser(t, tx, "bob")
		w := insertWorkspace(t, tx, alice)
		r1 := insertRoom(t, tx, w, alice, "general")
		r2 := insertRoom(t, tx, w, alice, "random")
		const insert = `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, thread_root_id, thread_seq, in_channel, created_at)
			VALUES ($1, $2, $3::bigint, $3::bigint + 1000, $3::bigint, $4, $5, 'hi', $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE $3::bigint END, $6::uuid IS NULL, $7)`

		clientMsgID := ids.New()
		m1 := ids.New()
		mustExec(t, tx, insert, m1, r1, 1, alice, clientMsgID, nil, now)

		t.Run("seq is unique per room", func(t *testing.T) {
			expectViolation(t, tx, sqlstateUnique, "messages_room_id_seq_idx",
				insert, ids.New(), r1, 1, bob, ids.New(), nil, now)
			expectViolation(t, tx, sqlstateCheck, "messages_seq_check",
				insert, ids.New(), r1, 0, bob, ids.New(), nil, now)
			insertMessage(t, tx, r2, alice, 1, nil) // 別のルームなら同じ seq でよい
		})

		t.Run("change_seq is unique per room and required", func(t *testing.T) {
			const withChangeSeq = `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, in_channel, created_at)
				VALUES ($1, $2, $3, $4, $3, $5, $6, 'hi', true, $7)`
			// m1 の change_seq（1001）を別の seq で使い回せない（ADR 0014）。
			expectViolation(t, tx, sqlstateUnique, "messages_room_id_change_seq_idx",
				withChangeSeq, ids.New(), r1, 500, 1001, bob, ids.New(), now)
			expectViolation(t, tx, sqlstateCheck, "messages_change_seq_check",
				withChangeSeq, ids.New(), r1, 501, 0, bob, ids.New(), now)
			expectViolation(t, tx, sqlstateNotNull, "",
				`INSERT INTO messages (id, room_id, seq, user_seq, sender_id, client_msg_id, body, in_channel, created_at) VALUES ($1, $2, 502, 502, $3, $4, 'hi', true, $5)`,
				ids.New(), r1, bob, ids.New(), now)
		})

		t.Run("client_msg_id is unique per room and sender", func(t *testing.T) {
			expectViolation(t, tx, sqlstateUnique, "messages_room_id_sender_id_client_msg_id_key",
				insert, ids.New(), r1, 2, alice, clientMsgID, nil, now)
			// 他人が同じ client_msg_id を使っても衝突しない（他人のメッセージを引き出せない）。
			mustExec(t, tx, insert, ids.New(), r1, 3, bob, clientMsgID, nil, now)
		})

		t.Run("thread root must be in the same room", func(t *testing.T) {
			insertMessage(t, tx, r1, bob, 4, &m1)
			expectViolation(t, tx, sqlstateForeignKey, "messages_thread_root_fkey",
				insert, ids.New(), r2, 2, bob, ids.New(), m1, now)
		})

		t.Run("thread fields go together and a message is not its own root", func(t *testing.T) {
			const raw = `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, thread_root_id, thread_seq, in_channel, created_at)
				VALUES ($1, $2, $3, $3, $3, $4, $5, 'hi', $6, $7, true, $8)`
			expectViolation(t, tx, sqlstateCheck, "messages_thread_fields_check",
				raw, ids.New(), r1, 20, bob, ids.New(), nil, 1, now)
			expectViolation(t, tx, sqlstateCheck, "messages_thread_fields_check",
				raw, ids.New(), r1, 21, bob, ids.New(), m1, nil, now)
			self := ids.New()
			expectViolation(t, tx, sqlstateCheck, "messages_thread_fields_check",
				raw, self, r1, 22, bob, ids.New(), self, 1, now)
			// システムメッセージはスレッドの返信にならない（ADR 0033 / 0036）。
			expectViolation(t, tx, sqlstateCheck, "messages_thread_fields_check",
				`INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, kind, system_type, thread_root_id, thread_seq, in_channel, created_at)
				 VALUES ($1, $2, 23, 23, 23, $3, $4, '', 'system', 'member_joined', $5, 1, true, $6)`,
				ids.New(), r1, bob, ids.New(), m1, now)
		})

		t.Run("channel posts are always in the channel, replies may be (ADR 0039)", func(t *testing.T) {
			const raw = `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, thread_root_id, thread_seq, in_channel, created_at)
				VALUES ($1, $2, $3, $3, $3, $4, $5, 'hi', $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE 1 END, $7, $8)`
			// Go のゼロ値（false）のままチャンネルの投稿を入れると、チャンネルから消える。CHECK で拒む。
			expectViolation(t, tx, sqlstateCheck, "messages_in_channel_check",
				raw, ids.New(), r1, 40, bob, ids.New(), nil, false, now)
			expectViolation(t, tx, sqlstateNotNull, "",
				raw, ids.New(), r1, 41, bob, ids.New(), nil, nil, now)
			root := insertMessage(t, tx, r1, alice, 42, nil)
			mustExec(t, tx, raw, ids.New(), r1, 43, bob, ids.New(), root, true, now)
		})

		t.Run("thread_seq is unique per thread", func(t *testing.T) {
			const raw = `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, thread_root_id, thread_seq, in_channel, created_at)
				VALUES ($1, $2, $3, $3, $3, $4, $5, 'hi', $6, 1, false, $7)`
			root := insertMessage(t, tx, r1, alice, 30, nil)
			mustExec(t, tx, raw, ids.New(), r1, 31, bob, ids.New(), root, now)
			expectViolation(t, tx, sqlstateUnique, "messages_thread_root_id_thread_seq_idx",
				raw, ids.New(), r1, 32, bob, ids.New(), root, now)
		})
	})
}

// ---- スレッド（ADR 0036）----

func TestThreadMembersConstraints(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		alice := insertUser(t, tx, "alice")
		bob := insertUser(t, tx, "bob")
		w := insertWorkspace(t, tx, alice)
		r1 := insertRoom(t, tx, w, alice, "general")
		r2 := insertRoom(t, tx, w, alice, "random")
		root := insertMessage(t, tx, r1, alice, 1, nil)
		mustExec(t, tx, `INSERT INTO room_members (room_id, user_id, last_read_seq, last_read_user_seq, joined_at) VALUES ($1, $2, 0, 0, $3)`, r1, alice, now)
		const insert = `INSERT INTO thread_members (room_id, thread_root_id, user_id, last_read_thread_seq, created_at) VALUES ($1, $2, $3, 0, $4)`

		// ルームのメンバーでない人は、スレッドに参加できない。
		expectViolation(t, tx, sqlstateForeignKey, "thread_members_room_member_fkey", insert, r1, root, bob, now)
		// 親は同じルームのメッセージ。
		expectViolation(t, tx, sqlstateForeignKey, "thread_members_thread_root_fkey", insert, r2, root, alice, now)

		// ルームから抜けると、参加も消える。
		mustExec(t, tx, insert, r1, root, alice, now)
		mustExec(t, tx, `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, r1, alice)
		var n int
		if err := tx.QueryRow(t.Context(), `SELECT count(*) FROM thread_members WHERE thread_root_id = $1`, root).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("thread_members after leaving the room = %d, want 0", n)
		}
	})
}

// ---- 添付 ----

func TestAttachmentsConstraints(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		u := insertUser(t, tx, "alice")
		w := insertWorkspace(t, tx, u)
		r1 := insertRoom(t, tx, w, u, "general")
		r2 := insertRoom(t, tx, w, u, "random")
		m1 := insertMessage(t, tx, r1, u, 1, nil)
		const insert = `INSERT INTO attachments (id, room_id, uploader_id, message_id, status, object_key, file_name, mime_type, size_bytes, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, 'a.png', 'image/png', 10, $7)`

		mustExec(t, tx, insert, ids.New(), r1, u, nil, "pending", "k/pending", now)
		mustExec(t, tx, insert, ids.New(), r1, u, nil, "uploaded", "k/uploaded", now)

		// message_id を持つのは attached と deleted だけ（ADR 0013）。
		expectViolation(t, tx, sqlstateCheck, "attachments_status_message",
			insert, ids.New(), r1, u, nil, "attached", "k/a", now)
		expectViolation(t, tx, sqlstateCheck, "attachments_status_message",
			insert, ids.New(), r1, u, nil, "deleted", "k/a2", now)
		expectViolation(t, tx, sqlstateCheck, "attachments_status_message",
			insert, ids.New(), r1, u, m1, "pending", "k/b", now)
		expectViolation(t, tx, sqlstateCheck, "attachments_status_message",
			insert, ids.New(), r1, u, m1, "uploaded", "k/b2", now)
		expectViolation(t, tx, sqlstateCheck, "attachments_status_check",
			insert, ids.New(), r1, u, nil, "orphaned", "k/b3", now)
		// 寸法は両方あるか、両方ないか。
		expectViolation(t, tx, sqlstateCheck, "attachments_dimensions",
			`INSERT INTO attachments (id, room_id, uploader_id, status, object_key, file_name, mime_type, size_bytes, width, created_at)
			 VALUES ($1, $2, $3, 'pending', 'k/w', 'a.png', 'image/png', 10, 640, $4)`, ids.New(), r1, u, now)
		mustExec(t, tx, `INSERT INTO attachments (id, room_id, uploader_id, status, object_key, file_name, mime_type, size_bytes, width, height, created_at)
			 VALUES ($1, $2, $3, 'pending', 'k/wh', 'a.png', 'image/png', 10, 640, 480, $4)`, ids.New(), r1, u, now)
		// 別のルームでアップロードした添付を、このルームのメッセージに付けられない。
		expectViolation(t, tx, sqlstateForeignKey, "attachments_message_fkey",
			insert, ids.New(), r2, u, m1, "attached", "k/c", now)

		mustExec(t, tx, insert, ids.New(), r1, u, m1, "attached", "k/attached", now)
		mustExec(t, tx, insert, ids.New(), r1, u, m1, "deleted", "k/deleted", now)
		expectViolation(t, tx, sqlstateUnique, "attachments_object_key_key",
			insert, ids.New(), r1, u, nil, "pending", "k/attached", now)

		// 添付の行を残したままメッセージだけを物理削除できない（オブジェクトを消す手がかりを失わない）。
		expectViolation(t, tx, sqlstateForeignKey, "attachments_message_fkey",
			`DELETE FROM messages WHERE id = $1`, m1)

		// ルームの削除では messages と attachments がまとめて CASCADE される。
		mustExec(t, tx, `DELETE FROM rooms WHERE id = $1`, r1)
		var n int
		if err := tx.QueryRow(t.Context(), `SELECT count(*) FROM attachments WHERE room_id = $1`, r1).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("attachments left after room delete: %d", n)
		}
	})
}

// ---- seq の採番（ADR 0002 の追記の根拠） ----

// allocateAndInsert は ADR 0002 で確定した方式（sqlc の AllocateMessageSeq）で 1 件を送信する。
// rooms の行を UPDATE すると、その行ロックでルームへの送信が直列化される。
func allocateAndInsert(ctx context.Context, pool *pgxpool.Pool, roomID, sender ulid.ULID, commit bool) (int64, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	allocated, err := store.New(tx).AllocateMessageSeq(ctx, store.AllocateMessageSeqParams{RoomID: roomID, Now: now})
	if err != nil {
		return 0, fmt.Errorf("allocate: %w", err)
	}
	seq := allocated.LastMessageSeq
	if _, err := tx.Exec(ctx, `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, in_channel, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'hi', true, $8)`, ids.New(), roomID, seq, allocated.LastChangeSeq, allocated.LastUserSeq, sender, ids.New(), now); err != nil {
		return 0, fmt.Errorf("insert: %w", err)
	}
	if !commit {
		return seq, nil // defer の Rollback で採番ごと取り消す
	}
	return seq, tx.Commit(ctx)
}

func TestSeqAllocationConcurrent(t *testing.T) {
	pool := openPool(t)
	ctx := t.Context()

	// 並行するトランザクションから見えるよう、フィクスチャはコミットして最後に消す。
	setup, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// フィクスチャの途中で失敗しても接続を返す（返さないと pool.Close が待ち続ける）。コミット後は何もしない。
	defer func() { _ = setup.Rollback(context.WithoutCancel(ctx)) }()
	u := insertUser(t, setup, "seq-"+ids.New().String())
	w := insertWorkspace(t, setup, u)
	rid := insertRoom(t, setup, w, u, "general")
	if err := setup.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cctx := context.WithoutCancel(ctx)
		// workspaces → rooms → messages は CASCADE。users は RESTRICT なので最後に消す。
		_, _ = pool.Exec(cctx, `DELETE FROM workspaces WHERE id = $1`, w)
		_, _ = pool.Exec(cctx, `DELETE FROM users WHERE id = $1`, u)
	})

	const senders = 50
	var wg sync.WaitGroup
	errs := make(chan error, senders)
	for i := range senders {
		wg.Go(func() {
			// 3 件に 1 件はロールバックする。採番ごと取り消されて欠番にならないこと
			// （全ルーム共通の SEQUENCE ではロールバックで欠番が出る）を同時に確かめる。
			if _, err := allocateAndInsert(ctx, pool, rid, u, i%3 != 0); err != nil {
				errs <- err
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("send: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT seq FROM messages WHERE room_id = $1 ORDER BY seq`, rid)
	if err != nil {
		t.Fatal(err)
	}
	seqs, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		t.Fatal(err)
	}

	committed := 0
	for i := range senders {
		if i%3 != 0 {
			committed++
		}
	}
	if len(seqs) != committed {
		t.Fatalf("messages = %d, want %d", len(seqs), committed)
	}
	for i, s := range seqs {
		if s != int64(i+1) {
			t.Fatalf("seq[%d] = %d, want %d (欠番または重複): %v", i, s, i+1, seqs)
		}
	}

	var last int64
	if err := pool.QueryRow(ctx, `SELECT last_message_seq FROM rooms WHERE id = $1`, rid).Scan(&last); err != nil {
		t.Fatal(err)
	}
	if last != int64(committed) {
		t.Fatalf("rooms.last_message_seq = %d, want %d", last, committed)
	}
}
