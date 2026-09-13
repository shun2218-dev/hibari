-- ワークスペースとメンバー（ADR 0006 / 0011）。
--
-- users は公開プロフィールの列（id / handle / display_name / avatar_object_key / deleted_at）だけを読む（ADR 0011）。

-- name: CreateWorkspace :one
INSERT INTO workspaces (id, slug, name, created_by, created_at, updated_at)
VALUES (sqlc.arg(id), sqlc.arg(slug), sqlc.arg(name), sqlc.arg(created_by),
        sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz)
RETURNING *;

-- name: AddWorkspaceMember :exec
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
VALUES (sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(role), sqlc.arg(now)::timestamptz);

-- name: ListWorkspacesForUser :many
-- 自分が所属するワークスペース。user_id のインデックスから引く。
SELECT sqlc.embed(w), wm.role
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
 WHERE wm.user_id = sqlc.arg(user_id)
   AND w.deleted_at IS NULL
 ORDER BY w.id;

-- name: GetWorkspaceForUser :one
-- ワークスペースと、そこでの自分のロール。メンバーでなければ行が返らない（呼び出し側で 404 にする）。
SELECT sqlc.embed(w), wm.role,
       (SELECT count(*) FROM workspace_members c WHERE c.workspace_id = w.id) AS member_count
  FROM workspaces w
  JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = sqlc.arg(user_id)
 WHERE w.id = sqlc.arg(id)
   AND w.deleted_at IS NULL;

-- name: GetWorkspaceRoleForShare :one
-- 管理操作の前に、自分のロールを読んで共有ロックする。
-- ロールの変更・キック（FOR UPDATE）と競合させ、判定してから書き込むまでの間に降格・キックされないようにする。
SELECT wm.role, w.invite_policy
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
 WHERE wm.workspace_id = sqlc.arg(workspace_id)
   AND wm.user_id = sqlc.arg(user_id)
   AND w.deleted_at IS NULL
   FOR SHARE OF wm;

-- name: UpdateWorkspace :one
-- NULL を渡した項目は変更しない（PATCH）。
UPDATE workspaces
   SET name          = coalesce(sqlc.narg(name), name),
       invite_policy = coalesce(sqlc.narg(invite_policy), invite_policy),
       updated_at    = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ListWorkspaceMembers :many
-- メンバー一覧。主キー (workspace_id, user_id) の順に走査するので、user_id をカーソルにする。
-- 退会済みのユーザーは表示しない（退会時に行を消す実装になるまでの保険）。
SELECT wm.user_id, wm.role, wm.joined_at, u.handle, u.display_name
  FROM workspace_members wm
  JOIN users u ON u.id = wm.user_id
 WHERE wm.workspace_id = sqlc.arg(workspace_id)
   AND wm.user_id > sqlc.arg(after)
   AND u.deleted_at IS NULL
 ORDER BY wm.user_id
 LIMIT sqlc.arg(max_rows);

-- name: GetWorkspaceMember :one
SELECT wm.user_id, wm.role, wm.joined_at, u.handle, u.display_name
  FROM workspace_members wm
  JOIN users u ON u.id = wm.user_id
 WHERE wm.workspace_id = sqlc.arg(workspace_id)
   AND wm.user_id = sqlc.arg(user_id)
   AND u.deleted_at IS NULL;

-- name: LockWorkspaceMembers :many
-- ロールの変更・キック・譲渡の対象の行（actor と target）をロックして、ロック後のロールを返す。
-- 行ロックは user_id の順に取る。「A が B を降格」と「B が A をキック」が同時に起きても、
-- 両方が同じ順でロックを待つのでデッドロックにならない（ADR 0011）。
SELECT wm.user_id, wm.role
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
 WHERE wm.workspace_id = sqlc.arg(workspace_id)
   AND wm.user_id = ANY(sqlc.arg(user_ids)::uuid[])
   AND w.deleted_at IS NULL
 ORDER BY wm.user_id
   FOR UPDATE OF wm;

-- name: UpdateWorkspaceMemberRole :exec
UPDATE workspace_members
   SET role = sqlc.arg(role)
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id);

-- name: DeleteWorkspaceMember :exec
DELETE FROM workspace_members
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id);

-- name: DeleteRoomMembershipsInWorkspace :exec
-- ワークスペースから外れたら、そのワークスペースのルームからも外す（DM を含む）。
-- ワークスペースのメンバーでない人の room_members が残ると、再参加したときに private ルームへ戻れてしまう。
DELETE FROM room_members rm
 USING rooms r
 WHERE rm.room_id = r.id
   AND r.workspace_id = sqlc.arg(workspace_id)
   AND rm.user_id = sqlc.arg(user_id);

-- name: GetWorkspaceRole :one
-- 自分のロールだけを読む（ロックしない）。読み取りの API の「メンバーか」の確認に使う。
SELECT wm.role
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
 WHERE wm.workspace_id = sqlc.arg(workspace_id)
   AND wm.user_id = sqlc.arg(user_id)
   AND w.deleted_at IS NULL;

-- name: ShareLockWorkspaceMembers :many
-- ルームのメンバーを増やす操作（参加・追加・DM）の前に、関係する人の workspace_members の行を共有ロックする。
-- キック（FOR UPDATE）と直列化し、「キックがルームの参加を消した後に、並行した参加が room_members を入れる」ことを防ぐ。
-- そのまま残ると、同じ人がワークスペースに戻ったときに、招かれていない private ルームに入れてしまう。
-- 行のロックは LockWorkspaceMembers と同じく user_id の順に取る。
SELECT wm.user_id, wm.role
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
 WHERE wm.workspace_id = sqlc.arg(workspace_id)
   AND wm.user_id = ANY(sqlc.arg(user_ids)::uuid[])
   AND w.deleted_at IS NULL
 ORDER BY wm.user_id
   FOR SHARE OF wm;

-- name: GetWorkspaceMemberRoles :many
-- user_ids のワークスペースでのロール。読み取りだけの API で使い、ロックしない。
SELECT wm.user_id, wm.role
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id
 WHERE wm.workspace_id = sqlc.arg(workspace_id)
   AND wm.user_id = ANY(sqlc.arg(user_ids)::uuid[])
   AND w.deleted_at IS NULL;
