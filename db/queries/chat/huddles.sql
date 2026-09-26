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
