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

-- name: MarkEmailVerified :execrows
-- すでに確認済みなら日時を上書きしない（最初に確認した日時を残す）。
UPDATE users
   SET email_verified_at = coalesce(email_verified_at, sqlc.arg(now)::timestamptz),
       updated_at        = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id)
   AND deleted_at IS NULL;

-- name: UpdatePasswordFromReset :execrows
-- リセットのリンクはその email に届いたものなので、email の所有も確認できたとみなす。
UPDATE users
   SET password_hash     = sqlc.arg(password_hash),
       email_verified_at = coalesce(email_verified_at, sqlc.arg(now)::timestamptz),
       updated_at        = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id)
   AND deleted_at IS NULL;

-- name: UpdateUserProfile :one
-- 表示名とハンドルの変更（ADR 0019）。省略した項目（NULL）は変えない。
-- handle の重複は登録と同じく UNIQUE 制約（users_handle_key）の違反として受け取る。
UPDATE users
   SET display_name = coalesce(sqlc.narg(display_name), display_name),
       handle       = coalesce(sqlc.narg(handle)::citext, handle),
       updated_at   = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id)
   AND deleted_at IS NULL
RETURNING *;
