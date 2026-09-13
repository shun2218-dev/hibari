-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, rotated_from, expires_at, user_agent, ip, created_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(family_id), sqlc.arg(token_hash), sqlc.narg(rotated_from),
        sqlc.arg(expires_at), sqlc.narg(user_agent), sqlc.narg(ip), sqlc.arg(now)::timestamptz);

-- name: GetRefreshTokenForUpdate :one
-- ローテーションの対象を行ロックして読む。
-- 同じトークンで同時に refresh されても、2 本目は 1 本目のコミットを待ってから
-- 「rotated で失効済み」の状態を読むので、必ず再利用として検知される。
-- 退会済みのユーザーのトークンは見つからないものとして扱う。
SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at, rt.revoked_reason
  FROM refresh_tokens rt
  JOIN users u ON u.id = rt.user_id
 WHERE rt.token_hash = sqlc.arg(token_hash)
   AND u.deleted_at IS NULL
   FOR UPDATE OF rt;

-- name: MarkRefreshTokenRotated :exec
UPDATE refresh_tokens
   SET revoked_at     = sqlc.arg(now)::timestamptz,
       revoked_reason = 'rotated'
 WHERE id = sqlc.arg(id);

-- name: GetRefreshTokenFamily :one
SELECT family_id
  FROM refresh_tokens
 WHERE token_hash = sqlc.arg(token_hash);

-- name: RevokeRefreshTokenFamily :execrows
-- セッション（family）単位の失効。rotated_from を再帰で辿らず、family_id の 1 文で全部を失効させる（ADR 0007）。
-- すでに失効している行（rotated を含む）は理由を上書きしない。影響行数が 0 なら、すでに失効済みだったことを表す。
UPDATE refresh_tokens
   SET revoked_at     = sqlc.arg(now)::timestamptz,
       revoked_reason = sqlc.arg(reason)::text
 WHERE family_id = sqlc.arg(family_id)
   AND revoked_at IS NULL;
