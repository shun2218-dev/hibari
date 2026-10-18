-- ミュートと通知の設定（ADR 0055）。

-- name: GetWorkspaceNotifyLevel :one
-- 全体の「通知する内容」。行がなければメンバーではない（呼び出し側が 404 にする）。NULL は未設定。
SELECT notify_level
  FROM workspace_members
 WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id);

-- name: SetWorkspaceNotifyLevel :one
-- 行がなければメンバーではない（呼び出し側が 404 にする）。
UPDATE workspace_members
   SET notify_level = sqlc.arg(notify_level)
 WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
RETURNING notify_level;

-- name: SetRoomNotifications :one
-- チャンネルごとの設定を全部の値で置き換える（PUT。決定 4）。組み合わせの検証はサービスで済ませてから呼ぶ。
-- 行がなければメンバーではない（判定の後にルームから外された。呼び出し側が 403 にする）。
UPDATE room_members
   SET notify_level = sqlc.narg(notify_level),
       muted        = sqlc.arg(muted),
       muted_until  = sqlc.narg(muted_until)
 WHERE room_id = sqlc.arg(room_id) AND user_id = sqlc.arg(user_id)
RETURNING notify_level, muted, muted_until;
