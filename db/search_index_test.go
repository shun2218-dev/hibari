// 検索の索引（ADR 0061 決定 2）が意図どおりに働くことを、実物の Postgres で確かめる。
//
// 索引の式（`lower(normalize(body, NFKC))`）と検索の条件は、完全に同じ形で書かないと索引が使われない。
// ここが片方だけ変わると、機能としては動いたまま seq scan に落ちて、件数が増えてから気づくことになる。
// そうならないよう、「索引が使われること」自体をテストで固定する。
package db_test

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"
)

// searchCond は検索の WHERE。マイグレーション 00019 の部分索引の式・述語と同じものを書く。
// $1 には `%語%` の形で、エスケープ済みの検索語を渡す。
const searchCond = `lower(normalize(body, NFKC)) LIKE lower(normalize($1, NFKC))
	AND deleted_at IS NULL AND kind = 'user'`

// insertBody は本文を指定してメッセージを入れる（schema_test.go の insertMessage は本文を固定している）。
func insertBody(t *testing.T, tx pgx.Tx, roomID, sender ulid.ULID, seq int64, body string) ulid.ULID {
	t.Helper()
	mid := ids.New()
	mustExec(t, tx, `INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, in_channel, created_at)
		VALUES ($1, $2, $3::bigint, $3::bigint, $3::bigint, $4, $5, $6, true, $7)`,
		mid, roomID, seq, sender, ids.New(), body, now)
	return mid
}

// searchIDs は検索の条件に当たるメッセージの ID を返す。
func searchIDs(t *testing.T, tx pgx.Tx, term string) []ulid.ULID {
	t.Helper()
	rows, err := tx.Query(t.Context(), `SELECT id FROM messages WHERE `+searchCond+` ORDER BY seq`, "%"+term+"%")
	if err != nil {
		t.Fatalf("search %q: %v", term, err)
	}
	defer rows.Close()
	var got []ulid.ULID
	for rows.Next() {
		var id ulid.ULID
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got = append(got, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return got
}

func TestMessageSearchExtension(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		var installed bool
		if err := tx.QueryRow(t.Context(),
			`SELECT exists(SELECT 1 FROM pg_extension WHERE extname = 'pg_bigm')`).Scan(&installed); err != nil {
			t.Fatalf("query pg_extension: %v", err)
		}
		if !installed {
			t.Fatal("pg_bigm が入っていない。db/postgres/Dockerfile でビルドしたイメージを使っているか確かめる（ADR 0061 決定 1）")
		}
	})
}

// TestMessageSearchUsesIndex は、2 文字の日本語の検索で索引が使われることを確かめる。
// pg_trgm（3-gram）に戻すと、この検索では索引が使えず seq scan になる（ADR 0061 の「検証の結果」）。
func TestMessageSearchUsesIndex(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		// テストのデータは数件しかなく、そのままでは計画が seq scan を選ぶ。
		// 「索引を使えるか」を見たいので、seq scan に大きなコストを付けて索引の道を選ばせる。
		mustExec(t, tx, `SET LOCAL enable_seqscan = off`)

		rows, err := tx.Query(t.Context(),
			`EXPLAIN (COSTS OFF) SELECT id FROM messages WHERE `+searchCond, "%面談%")
		if err != nil {
			t.Fatalf("explain: %v", err)
		}
		defer rows.Close()
		var plan strings.Builder
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatalf("scan: %v", err)
			}
			plan.WriteString(line)
			plan.WriteByte('\n')
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("rows: %v", err)
		}
		if !strings.Contains(plan.String(), "messages_body_search_idx") {
			t.Fatalf("2 文字の日本語の検索で messages_body_search_idx が使われていない:\n%s", plan.String())
		}
	})
}

// TestMessageSearchNormalization は、索引の式の正規化が効くことを確かめる。
// 大文字小文字と全角半角の違いは、検索する側も同じ式を通すことで吸収する（ADR 0061 決定 2）。
func TestMessageSearchNormalization(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		owner := insertUser(t, tx, "owner")
		ws := insertWorkspace(t, tx, owner)
		room := insertRoom(t, tx, ws, owner, "general")
		target := insertBody(t, tx, room, owner, 1, "deploy が終わりました。明日の面談の資料も置きました。")
		insertBody(t, tx, room, owner, 2, "関係のない発言")

		tests := []struct {
			name string
			term string
			want bool
		}{
			{"そのまま", "deploy", true},
			{"大文字で探す", "Deploy", true},
			{"本文が小文字でも大文字でも当たる", "DEPLOY", true},
			{"全角で探す", "ｄｅｐｌｏｙ", true},
			{"2 文字の日本語", "面談", true},
			{"含まれない語", "リリース", false},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				got := searchIDs(t, tx, tt.term)
				if tt.want {
					if len(got) != 1 || got[0] != target {
						t.Fatalf("search %q: got %v, want [%v]", tt.term, got, target)
					}
					return
				}
				if len(got) != 0 {
					t.Fatalf("search %q: got %v, want []", tt.term, got)
				}
			})
		}
	})
}

// TestMessageSearchExcludesDeletedAndSystem は、削除済みとシステムメッセージが結果に出ないことを確かめる。
// この 2 つは部分索引からも外してある（ADR 0061 決定 2）ので、条件を落とすと索引ごと使えなくなる。
func TestMessageSearchExcludesDeletedAndSystem(t *testing.T) {
	pool := openPool(t)
	inTx(t, pool, func(tx pgx.Tx) {
		owner := insertUser(t, tx, "owner")
		ws := insertWorkspace(t, tx, owner)
		room := insertRoom(t, tx, ws, owner, "general")

		alive := insertBody(t, tx, room, owner, 1, "面談の日程を決めました")

		// 論理削除は本文を空にするが（ADR 0038）、本文が残ったまま消えた行も結果に出ないことを確かめたいので、
		// 本文はそのままにして deleted_at だけを立てる。
		deleted := insertBody(t, tx, room, owner, 2, "面談の日程を決めました")
		mustExec(t, tx, `UPDATE messages SET deleted_at = $2 WHERE id = $1`, deleted, now)

		// 参加のログ（ADR 0033）。人の発言ではないので検索の対象にしない。
		system := insertBody(t, tx, room, owner, 3, "面談さんがチャンネルに参加しました")
		mustExec(t, tx, `UPDATE messages SET kind = 'system', system_type = 'member_joined' WHERE id = $1`, system)

		got := searchIDs(t, tx, "面談")
		if len(got) != 1 || got[0] != alive {
			t.Fatalf("search: got %v, want [%v]（削除済みとシステムメッセージは出さない）", got, alive)
		}
	})
}
