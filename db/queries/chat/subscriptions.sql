-- WebSocket の購読の authz に必要な事実（ADR 0015）。判定そのものは authz の関数が行う。
-- どれも読み取りだけで、ロックしない。購読と権限の変更の競合は Hub の epoch で扱う。

-- name: ListRoomAccessForUser :many
-- room_ids のうち存在するルームについて、user_id のワークスペースでのロールとルームのメンバーかどうかを返す。
-- 削除済みのワークスペースのルームは返さない（存在しないものとして扱う）。
-- is_default / archived_at は authz に渡すルームの状態（ADR 0059 決定 2。アーカイブ中は typing を止める）。
SELECT r.id, r.workspace_id, r.kind, r.is_default, r.archived_at,
       coalesce(wm.role, '')::text AS role,
       (rm.user_id IS NOT NULL)::boolean AS is_room_member
  FROM rooms r
  JOIN workspaces w ON w.id = r.workspace_id AND w.deleted_at IS NULL
  LEFT JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = sqlc.arg(user_id)
  LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = sqlc.arg(user_id)
 WHERE r.id = ANY(sqlc.arg(room_ids)::uuid[]);

-- name: ListWorkspaceRolesForUser :many
-- workspace_ids のうち、user_id がメンバーであるワークスペースとロール。
SELECT wm.workspace_id, wm.role
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id AND w.deleted_at IS NULL
 WHERE wm.user_id = sqlc.arg(user_id)
   AND wm.workspace_id = ANY(sqlc.arg(workspace_ids)::uuid[]);

-- name: ListWorkspaceIDsForUser :many
-- user_id が所属するすべてのワークスペース。presence.changed の宛先に使う。
SELECT wm.workspace_id
  FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id AND w.deleted_at IS NULL
 WHERE wm.user_id = sqlc.arg(user_id);
