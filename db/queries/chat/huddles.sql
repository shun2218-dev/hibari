-- 音声のハドル（ADR 0066）。Postgres に置くのは履歴だけで、いま入っている人は Redis にある（決定 3）。

-- name: LockActiveHuddle :one
-- ルームの進行中のハドルを行ロックして取る（決定 4）。
-- 「入る」と「最後の人が抜けて終わる」はどちらもこの行をロックしてから Redis を見るので、終わったハドルに入ってしまうことがない。
SELECT *
  FROM huddles
 WHERE room_id = sqlc.arg(room_id)
   AND ended_at IS NULL
   FOR UPDATE;

-- name: LockHuddle :one
-- ハドルを ID で行ロックして取る（終わらせる前に、まだ誰もいないかを確かめるため）。
SELECT *
  FROM huddles
 WHERE id = sqlc.arg(id)
   FOR UPDATE;

-- name: GetHuddle :one
SELECT *
  FROM huddles
 WHERE id = sqlc.arg(id);

-- name: CreateHuddle :exec
-- 進行中のハドルは部分 UNIQUE インデックス（huddles_room_id_active_idx）で 1 ルームに 1 つに限る。
-- 2 人が同時に始めたら後の方が一意制約の違反になり、呼び出し側は先のハドルに入り直す。
INSERT INTO huddles (id, room_id, started_by, message_id, started_at)
VALUES (sqlc.arg(id), sqlc.arg(room_id), sqlc.arg(started_by), sqlc.arg(message_id), sqlc.arg(now)::timestamptz);

-- name: EndHuddle :exec
UPDATE huddles
   SET ended_at = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id)
   AND ended_at IS NULL;

-- name: AddHuddleParticipant :execrows
-- 一度でも入った人を 1 回だけ書く（決定 3）。返す行数が 1 なら初めて入った（会話のメッセージの参加者が増えた）。
INSERT INTO huddle_participants (huddle_id, user_id, joined_at)
VALUES (sqlc.arg(huddle_id), sqlc.arg(user_id), sqlc.arg(now)::timestamptz)
ON CONFLICT (huddle_id, user_id) DO NOTHING;

-- name: ListActiveHuddlesInRooms :many
-- ルームの一覧と 1 件の取得に、進行中のハドルを添える（決定 13）。いま入っている人は Redis から読む。
SELECT id, room_id, message_id, started_at
  FROM huddles
 WHERE room_id = ANY(sqlc.arg(room_ids)::uuid[])
   AND ended_at IS NULL;

-- name: GetHuddleRoom :one
-- ハドルのルームとワークスペース（権限が変わった人をハドルから外すとき、そのハドルが対象かを決める。決定 8）。
SELECT h.id, h.room_id, h.ended_at, r.workspace_id, r.kind
  FROM huddles h
  JOIN rooms r ON r.id = h.room_id
 WHERE h.id = sqlc.arg(id);

-- name: ListHuddlesOfMessages :many
-- メッセージの応答の huddle（決定 12）。ページのハドルのメッセージをまとめて引く（N+1 にしない）。
-- 参加した人は最初に入った順。20 人までなので全員を載せる。
SELECT h.id, h.message_id, h.started_at, h.ended_at,
       COALESCE(array_agg(p.user_id ORDER BY p.joined_at, p.user_id) FILTER (WHERE p.user_id IS NOT NULL), '{}')::uuid[] AS participant_ids
  FROM huddles h
  LEFT JOIN huddle_participants p ON p.huddle_id = h.id
 WHERE h.message_id = ANY(sqlc.arg(message_ids)::uuid[])
 GROUP BY h.id;

-- name: AllocateHuddleChangeSeq :one
-- ハドルのメッセージの change_seq を 1 つ採番する（参加した人が増えた・終わった。決定 12）。
-- AllocateChangeSeq と違い、アーカイブ中でも採番する。アーカイブするときに進行中のハドルを終わらせ（決定 7）、
-- 終わったことを差分の同期でもそろえるため（アーカイブのログと同じ考え方。ADR 0059）。
UPDATE rooms
   SET last_change_seq = last_change_seq + 1
 WHERE id = sqlc.arg(room_id)
RETURNING last_change_seq;

-- name: ListHuddles :many
-- ハドルの一覧の「最近のハドルミーティング」（ADR 0067 決定 6）。終わったハドルを新しい順に 1 ページ返す。
--
-- 出すのは、いま読める（`readable_rooms`）ルームのハドルのうち、
--   - missed = false（すべて）: 自分がいまメンバーのルームで、参加した後に始まったもの、または自分が入ったもの
--   - missed = true（参加しなかった）: 自分がいまメンバーのルームで、参加した後に始まったもので、自分が入っていないもの
-- 参加する前のハドルを「参加しなかった」に入れないため、メンバーのルームのハドルは room_members.joined_at 以降に絞る。
-- 参加していない public のチャンネルのハドルは、自分が入ったものだけ（アクティビティと同じ線引き。ADR 0058 決定 4）。
--
-- `readable_rooms` は検索（search.sql）と同じ述語。**`authz.CanReadRoom` を変えたらここも直すこと**
-- （`huddle_list_test.go` が同じ組み合わせを検査する）。アーカイブしたルームは外さない（読めるため。ADR 0059）。
--
-- 参加した人と返信の数は同じ 1 文で読む（N+1 にしない）。参加した人は 20 人までなので全員を載せる。
-- 並びはハドルの ID（始めたときの ULID）の降順。メッセージではないので、created_at で並べないルール 3 には当たらない。
WITH readable_rooms AS (
    SELECT r.id, r.kind, r.name, r.dm_key, rm.joined_at AS member_since
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = sqlc.arg(user_id)
     WHERE r.workspace_id = sqlc.arg(workspace_id)
       AND (r.kind = 'public' OR rm.user_id IS NOT NULL)
)
SELECT h.id, h.room_id, h.message_id, h.started_by, h.started_at, h.ended_at,
       rr.kind AS room_kind, rr.name AS room_name, rr.dm_key AS room_dm_key,
       m.thread_reply_count,
       COALESCE((SELECT array_agg(p.user_id ORDER BY p.joined_at, p.user_id)
                   FROM huddle_participants p
                  WHERE p.huddle_id = h.id), '{}')::uuid[] AS participant_ids
  FROM huddles h
  JOIN readable_rooms rr ON rr.id = h.room_id
  JOIN messages m ON m.room_id = h.room_id AND m.id = h.message_id
 WHERE h.ended_at IS NOT NULL
   AND h.id < sqlc.arg(before_id)::uuid
   AND (sqlc.narg(room_id)::uuid IS NULL OR h.room_id = sqlc.narg(room_id)::uuid)
   AND (sqlc.narg(participant_id)::uuid IS NULL OR EXISTS (
         SELECT 1 FROM huddle_participants p WHERE p.huddle_id = h.id AND p.user_id = sqlc.narg(participant_id)::uuid))
   AND CASE
         WHEN sqlc.arg(missed)::boolean THEN
           rr.member_since IS NOT NULL AND h.started_at >= rr.member_since
           AND NOT EXISTS (SELECT 1 FROM huddle_participants me WHERE me.huddle_id = h.id AND me.user_id = sqlc.arg(user_id))
         ELSE
           (rr.member_since IS NOT NULL AND h.started_at >= rr.member_since)
           OR EXISTS (SELECT 1 FROM huddle_participants me WHERE me.huddle_id = h.id AND me.user_id = sqlc.arg(user_id))
       END
 ORDER BY h.id DESC
 LIMIT sqlc.arg(max_rows);

-- name: ListHuddleSuggestions :many
-- 提案のカード（ADR 0067 決定 7）。since 以降に自分が参加したハドルがあったルームを、回数の多い順に返す（同じなら新しい方）。
-- 候補は自分がいまメンバーで、アーカイブしていないルームだけ（入れるかの最後の判断はサービスが authz で行う）。
-- いまハドルが進行中のルームは除く（一覧の上の進行中のカードに出る）。
-- 顔に出す人は、そのルームの同じ期間のハドルに参加した人（自分を除く）。
SELECT h.room_id, r.kind AS room_kind, r.name AS room_name, r.dm_key AS room_dm_key, r.is_default AS room_is_default,
       count(*)::bigint AS huddle_count,
       max(h.started_at)::timestamptz AS last_started_at,
       COALESCE((SELECT array_agg(DISTINCT p2.user_id)
                   FROM huddles h2
                   JOIN huddle_participants p2 ON p2.huddle_id = h2.id
                  WHERE h2.room_id = h.room_id
                    AND h2.started_at >= sqlc.arg(since)::timestamptz
                    AND p2.user_id <> sqlc.arg(user_id)), '{}')::uuid[] AS participant_ids
  FROM huddle_participants me
  JOIN huddles h ON h.id = me.huddle_id
  JOIN rooms r ON r.id = h.room_id
  JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = me.user_id
 WHERE me.user_id = sqlc.arg(user_id)
   AND r.workspace_id = sqlc.arg(workspace_id)
   AND r.archived_at IS NULL
   AND h.started_at >= sqlc.arg(since)::timestamptz
   AND NOT EXISTS (SELECT 1 FROM huddles a WHERE a.room_id = h.room_id AND a.ended_at IS NULL)
 GROUP BY h.room_id, r.kind, r.name, r.dm_key, r.is_default
 ORDER BY huddle_count DESC, last_started_at DESC
 LIMIT sqlc.arg(max_rows);
