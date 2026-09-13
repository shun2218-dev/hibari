-- name: DeleteUnconsumedOneTimeTokens :exec
-- 新しいトークンを発行する前に、同じ用途の未使用のトークンを消す。
-- 確認メールやリセットのメールを何通も要求されても、有効なリンクは常に最新の 1 つだけにする。
DELETE FROM one_time_tokens
 WHERE user_id = sqlc.arg(user_id)
   AND purpose = sqlc.arg(purpose)
   AND consumed_at IS NULL;

-- name: CreateOneTimeToken :exec
INSERT INTO one_time_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(purpose), sqlc.arg(token_hash), sqlc.arg(expires_at),
        sqlc.arg(now)::timestamptz);

-- name: ConsumeOneTimeToken :one
-- 未使用・期限内のトークンを使用済みにして、持ち主を返す。
-- 「読んで確かめてから更新」を 1 文にするので、同じリンクを同時に開いても成功するのは 1 回だけ。
UPDATE one_time_tokens
   SET consumed_at = sqlc.arg(now)::timestamptz
 WHERE token_hash = sqlc.arg(token_hash)
   AND purpose = sqlc.arg(purpose)
   AND consumed_at IS NULL
   AND expires_at > sqlc.arg(now)::timestamptz
RETURNING user_id;
