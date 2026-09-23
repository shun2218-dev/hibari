-- メッセージの検索（ADR 0061）。

-- name: SearchMessages :many
-- 読める範囲のメッセージを、新しい順に 1 ページ返す。
--
-- **本文の条件の書き方に決まりがある（ADR 0061 決定 6 / 2026-09-23 に実測）。**
--
--   - `term` は**必ず 1 つの `LIKE` として書く**。これが `messages_body_search_idx`（pg_bigm の 2-gram GIN）の
--     `Index Cond` になり、索引がこのクエリを引く。
--   - 2 つ目以降の語は `more_terms` にまとめ、`LIKE ALL(配列)` で再チェックする。
--     配列の形では 2-gram のキーが使われない（計画の `Index Cond` に入らず、部分索引の述語しか効かない）ので、
--     索引を引く語は 1 つに絞り、残りは絞り込みに回す。
--   - **同じ語を並べて固定のスロットを埋めない。** 同じ条件を 8 個並べると索引は引けるが、
--     選択率が掛け合わされて見積もりが壊れる（実測: 実際 939 行に対して `rows=1`）。計画の選び方を誤らせる。
--   - どの語を `term` にするかは呼ぶ側が決める（長い語ほど 2-gram のキーが多く、絞り込みが効く）。
--
-- 認可は `readable_rooms` の 1 か所に集める（決定 3）。`authz.CanReadRoom` と同じ条件で、
-- public はワークスペースのメンバーなら参加していなくても読め、private / dm はメンバーだけ。
-- アーカイブしたルームは外さない（アーカイブは「書けない」であって「読めない」ではない。ADR 0059 決定 2）。
-- **`authz.CanReadRoom` を変えたらここも直すこと**（`search_test.go` が同じ組み合わせを検査する）。
--
-- 並びは新しい順だけ（決定 4）。ルームをまたぐので `seq` は使えず、同じ時刻は `id`（ULID）で決める。
WITH readable_rooms AS (
    SELECT r.id, r.kind, r.name, r.dm_key
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = sqlc.arg(user_id)
     WHERE r.workspace_id = sqlc.arg(workspace_id)
       AND (r.kind = 'public' OR rm.user_id IS NOT NULL)
)
SELECT m.id, m.room_id, m.seq, m.thread_root_id, m.in_channel, m.body, m.created_at, m.edited_at,
       m.sender_id, u.handle AS sender_handle, u.display_name AS sender_display_name,
       rr.kind AS room_kind, rr.name AS room_name, rr.dm_key AS room_dm_key,
       -- 添付の件数（画面の「添付 N 件」）。1 文の中の相関サブクエリなので N+1 にはならない。
       (SELECT count(*) FROM attachments a WHERE a.message_id = m.id AND a.status = 'attached')::bigint AS attachment_count
  FROM messages m
  JOIN readable_rooms rr ON rr.id = m.room_id
  JOIN users u ON u.id = m.sender_id
 -- 部分索引 messages_body_search_idx の述語と同じ形で書く。ここを緩めると索引が使えなくなる
 WHERE m.deleted_at IS NULL
   AND m.kind = 'user'
   AND lower(normalize(m.body, NFKC)) LIKE sqlc.arg(term)
   AND (sqlc.narg(more_terms)::text[] IS NULL OR lower(normalize(m.body, NFKC)) LIKE ALL (sqlc.narg(more_terms)::text[]))
   -- 除外（`-語`）。NOT LIKE は索引を引けないが、肯定の語が索引を引いたあとの絞り込みとして効く
   AND (sqlc.narg(exclude_terms)::text[] IS NULL OR lower(normalize(m.body, NFKC)) NOT LIKE ALL (sqlc.narg(exclude_terms)::text[]))
   AND (sqlc.narg(room_ids)::uuid[] IS NULL OR m.room_id = ANY (sqlc.narg(room_ids)::uuid[]))
   AND (sqlc.narg(exclude_room_ids)::uuid[] IS NULL OR m.room_id <> ALL (sqlc.narg(exclude_room_ids)::uuid[]))
   AND (sqlc.narg(sender_ids)::uuid[] IS NULL OR m.sender_id = ANY (sqlc.narg(sender_ids)::uuid[]))
   AND (sqlc.narg(exclude_sender_ids)::uuid[] IS NULL OR m.sender_id <> ALL (sqlc.narg(exclude_sender_ids)::uuid[]))
   AND (sqlc.narg(after)::timestamptz IS NULL OR m.created_at >= sqlc.narg(after)::timestamptz)
   AND (sqlc.narg(before)::timestamptz IS NULL OR m.created_at < sqlc.narg(before)::timestamptz)
   -- カーソル（決定 4）。最初のページは「どの行より新しい」も持たない値を渡す
   AND (m.created_at, m.id) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_id)::uuid)
 ORDER BY m.created_at DESC, m.id DESC
 LIMIT sqlc.arg(max_rows);
