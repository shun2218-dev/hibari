-- ルーム（ADR 0006 / 0011）。

-- name: AllocateMessageSeq :one
-- ルームの次の seq を採番して返す（ADR 0002「採番方式の確定」）。
-- 送信と同じトランザクションの中で呼ぶ。rooms の行ロックで同じルームへの送信が直列化され、
-- ロールバックすれば採番も取り消されるので欠番にならない。
UPDATE rooms
   SET last_message_seq = last_message_seq + 1,
       last_message_at  = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(room_id)
RETURNING last_message_seq;

-- name: CreateRoom :one
-- public / private のルーム。名前の重複は部分 UNIQUE インデックス（rooms_workspace_id_name_idx）で検出する。
INSERT INTO rooms (id, workspace_id, kind, name, created_by, created_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(kind), sqlc.arg(name), sqlc.arg(created_by), sqlc.arg(now)::timestamptz)
RETURNING *;

-- name: CreateDMRoom :one
-- DM を作る。同じ 2 人の DM がすでにあれば何もせず、行を返さない（呼び出し側で既存を読む）。
-- 並行して同じ DM を作ると、2 本目は 1 本目の UNIQUE の確定を待ってから DO NOTHING になる。
INSERT INTO rooms (id, workspace_id, kind, dm_key, created_by, created_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), 'dm', sqlc.arg(dm_key), sqlc.arg(created_by), sqlc.arg(now)::timestamptz)
ON CONFLICT (workspace_id, dm_key) WHERE kind = 'dm' DO NOTHING
RETURNING *;

-- name: GetDMRoom :one
SELECT *
  FROM rooms
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND kind = 'dm'
   AND dm_key = sqlc.arg(dm_key);

-- name: GetRoom :one
-- 削除済みのワークスペースのルームは見つからないものとして扱う。
SELECT r.*
  FROM rooms r
  JOIN workspaces w ON w.id = r.workspace_id
 WHERE r.id = sqlc.arg(id)
   AND w.deleted_at IS NULL;

-- name: GetRoomMemberCount :one
SELECT count(*)
  FROM room_members
 WHERE room_id = sqlc.arg(room_id);

-- name: GetRoomMemberships :many
-- user_ids のうち、ルームのメンバーである人。
SELECT user_id
  FROM room_members
 WHERE room_id = sqlc.arg(room_id)
   AND user_id = ANY(sqlc.arg(user_ids)::uuid[]);

-- name: ListRoomsForUser :many
-- サイドバーのルーム一覧: 参加しているルーム（全種類）と、参加していない public ルーム。
-- 読めない private / dm は含めない。並びは最近メッセージがあった順（インデックス rooms_workspace_id_last_message_at_idx）。
SELECT sqlc.embed(r), (rm.user_id IS NOT NULL)::boolean AS is_member
  FROM rooms r
  LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = sqlc.arg(user_id)
 WHERE r.workspace_id = sqlc.arg(workspace_id)
   AND (r.kind = 'public' OR rm.user_id IS NOT NULL)
 ORDER BY r.last_message_at DESC NULLS LAST, r.id;

-- name: ListUserProfiles :many
-- DM の相手などの公開プロフィールをまとめて引く（N+1 にしない）。退会済みでも匿名化した値を返す。
SELECT id, handle, display_name
  FROM users
 WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: UpdateRoom :one
-- NULL を渡した項目は変更しない（PATCH）。
UPDATE rooms
   SET name       = coalesce(sqlc.narg(name), name),
       is_default = coalesce(sqlc.narg(is_default), is_default)
 WHERE id = sqlc.arg(id)
RETURNING *;

-- name: AddRoomMember :execrows
-- ルームに参加する。すでにメンバーなら何もせず 0 を返す（冪等）。
-- last_read_seq は同じ文の中で rooms から読み、参加前のメッセージを未読にしない。
INSERT INTO room_members (room_id, user_id, last_read_seq, joined_at)
SELECT r.id, sqlc.arg(user_id), r.last_message_seq, sqlc.arg(now)::timestamptz
  FROM rooms r
 WHERE r.id = sqlc.arg(room_id)
ON CONFLICT DO NOTHING;

-- name: DeleteRoomMember :execrows
DELETE FROM room_members
 WHERE room_id = sqlc.arg(room_id)
   AND user_id = sqlc.arg(user_id);

-- name: ListRoomMembers :many
-- ルームのメンバーと、ワークスペースでのロール。主キー (room_id, user_id) の順に走査するので user_id をカーソルにする。
SELECT rm.user_id, rm.joined_at, wm.role, u.handle, u.display_name
  FROM room_members rm
  JOIN rooms r ON r.id = rm.room_id
  JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = rm.user_id
  JOIN users u ON u.id = rm.user_id
 WHERE rm.room_id = sqlc.arg(room_id)
   AND rm.user_id > sqlc.arg(after)
   AND u.deleted_at IS NULL
 ORDER BY rm.user_id
 LIMIT sqlc.arg(max_rows);
