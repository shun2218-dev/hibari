-- 招待リンク（ADR 0006 / 0011）。コードは SHA-256 のハッシュだけを扱い、生の値は SQL に渡さない。

-- name: CreateInvite :one
INSERT INTO workspace_invites (id, workspace_id, code_hash, created_by, max_uses, expires_at, created_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(code_hash), sqlc.arg(created_by), sqlc.narg(max_uses),
        sqlc.arg(expires_at), sqlc.arg(now)::timestamptz)
RETURNING *;

-- name: ListInvites :many
-- 新しい順。カーソルは直前のページの最後の id で、それより古いものを返す（NULL なら先頭から）。
SELECT sqlc.embed(i), u.handle AS creator_handle, u.display_name AS creator_display_name
  FROM workspace_invites i
  JOIN users u ON u.id = i.created_by
 WHERE i.workspace_id = sqlc.arg(workspace_id)
   AND (sqlc.narg(before)::uuid IS NULL OR i.id < sqlc.narg(before)::uuid)
 ORDER BY i.id DESC
 LIMIT sqlc.arg(max_rows);

-- name: GetInviteWithCreator :one
SELECT sqlc.embed(i), u.handle AS creator_handle, u.display_name AS creator_display_name
  FROM workspace_invites i
  JOIN users u ON u.id = i.created_by
 WHERE i.id = sqlc.arg(id)
   AND i.workspace_id = sqlc.arg(workspace_id);

-- name: RevokeInvite :exec
-- すでに取り消し済みなら最初に取り消した日時を残す。
UPDATE workspace_invites
   SET revoked_at = coalesce(revoked_at, sqlc.arg(now)::timestamptz)
 WHERE id = sqlc.arg(id)
   AND workspace_id = sqlc.arg(workspace_id);

-- name: GetInvitePreview :one
-- 招待のプレビュー。削除済みのワークスペースの招待は見つからないものとして扱う。
-- 件数は招待を持っている人（まだメンバーではない人）に見せる値なので、public ルームだけを数える（private の存在は明かさない）。
SELECT sqlc.embed(i),
       w.name AS workspace_name,
       u.handle AS creator_handle,
       u.display_name AS creator_display_name,
       (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = i.workspace_id) AS member_count,
       (SELECT count(*) FROM rooms r WHERE r.workspace_id = i.workspace_id AND r.kind = 'public') AS public_room_count,
       EXISTS (SELECT 1 FROM workspace_members m
                WHERE m.workspace_id = i.workspace_id AND m.user_id = sqlc.arg(user_id)) AS already_member
  FROM workspace_invites i
  JOIN workspaces w ON w.id = i.workspace_id
  JOIN users u ON u.id = i.created_by
 WHERE i.code_hash = sqlc.arg(code_hash)
   AND w.deleted_at IS NULL;

-- name: GetInviteByCodeHash :one
SELECT i.*
  FROM workspace_invites i
  JOIN workspaces w ON w.id = i.workspace_id
 WHERE i.code_hash = sqlc.arg(code_hash)
   AND w.deleted_at IS NULL;

-- name: GetInvite :one
SELECT *
  FROM workspace_invites
 WHERE id = sqlc.arg(id);

-- name: AddWorkspaceMemberIfAbsent :execrows
-- 招待の受け入れでメンバーにする。すでにメンバーなら何もせず 0 を返す（使用回数を消費しない）。
-- 同じユーザーの並行した受け入れは、主キーの一意性の確定を待ってから ON CONFLICT になる。
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
VALUES (sqlc.arg(workspace_id), sqlc.arg(user_id), 'member', sqlc.arg(now)::timestamptz)
ON CONFLICT DO NOTHING;

-- name: ConsumeInvite :execrows
-- 有効な招待の使用回数を 1 増やす。条件を満たさなければ 0 行。
-- 「読んで確かめてから加算」を 1 文にするので、並行した受け入れでも max_uses を超えない。
-- 行ロックを待った後、Postgres は更新後の行で WHERE を評価し直す（READ COMMITTED）ので、
-- 先に上限に達したトランザクションがコミットしたら、待っていた側は 0 行になる。
UPDATE workspace_invites
   SET use_count = use_count + 1
 WHERE id = sqlc.arg(id)
   AND revoked_at IS NULL
   AND expires_at > sqlc.arg(now)::timestamptz
   AND (max_uses IS NULL OR use_count < max_uses);

-- name: JoinDefaultRooms :many
-- is_default のルームに参加する。last_read_seq は参加時点の最新の seq にする（参加前のメッセージを未読にしない）。
-- 参加したルームを返す。本人と各ルームの購読者に member.joined を配信するため（ADR 0015）。
INSERT INTO room_members (room_id, user_id, last_read_seq, joined_at)
SELECT r.id, sqlc.arg(user_id), r.last_message_seq, sqlc.arg(now)::timestamptz
  FROM rooms r
 WHERE r.workspace_id = sqlc.arg(workspace_id)
   AND r.is_default
ON CONFLICT DO NOTHING
RETURNING room_id;
