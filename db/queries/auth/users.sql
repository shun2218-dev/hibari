-- name: CreateUser :one
-- email と handle の重複は UNIQUE 制約（users_email_key / users_handle_key）で検出する。
-- 先に SELECT で確かめると、並行した登録の間に割り込まれるので、制約違反をエラーとして受け取る。
INSERT INTO users (id, handle, display_name, email, password_hash, created_at, updated_at)
VALUES (sqlc.arg(id), sqlc.arg(handle), sqlc.arg(display_name), sqlc.arg(email), sqlc.arg(password_hash),
        sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz)
RETURNING *;

-- name: GetActiveUserByEmail :one
-- 退会済みのユーザーは存在しないものとして扱う（ログインできない）。
SELECT *
  FROM users
 WHERE email = sqlc.arg(email)
   AND deleted_at IS NULL;

-- name: GetActiveUserByID :one
SELECT *
  FROM users
 WHERE id = sqlc.arg(id)
   AND deleted_at IS NULL;
