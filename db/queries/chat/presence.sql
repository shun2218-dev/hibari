-- 離席とカスタムステータス（ADR 0049）。
--
-- ここにあるのは「本人が選んだ設定」だけ。自動で決まる presence は Redis にあり、DB には来ない。
-- 期限切れのステータスを落とすのは、読み取りの変換（internal/chat の statusOf）1 箇所だけ（ADR 0049 決定 6 の追記）。
-- SQL の CASE で落とす案は、sqlc が式の型と NULL 可能性を推せず、`interface{}` か「NULL にならない string」になってしまうため。

-- name: SetManualAway :exec
-- 手動の離席を設定する。設定したときだけ行を作り、以降は上書きする（冪等）。
INSERT INTO user_presence_settings (user_id, manual_away, updated_at)
VALUES (sqlc.arg(user_id), sqlc.arg(manual_away), sqlc.arg(now))
    ON CONFLICT (user_id) DO UPDATE
    SET manual_away = EXCLUDED.manual_away,
        updated_at  = EXCLUDED.updated_at;

-- name: GetManualAway :one
-- 本人の設定を読む。行が無ければ false（呼ぶ側が pgx.ErrNoRows を false として扱う）。
SELECT manual_away FROM user_presence_settings WHERE user_id = sqlc.arg(user_id);

-- name: SetMemberStatus :one
-- カスタムステータスを設定する。ワークスペースのメンバーでなければ 0 行（呼ぶ側が ErrNotFound にする）。
UPDATE workspace_members
   SET status_emoji      = sqlc.arg(status_emoji),
       status_text       = sqlc.narg(status_text),
       status_expires_at = sqlc.narg(status_expires_at)
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id)
RETURNING status_emoji, status_text, status_expires_at;

-- name: ClearMemberStatus :execrows
-- 解除する。設定していなくても成功（冪等）。ワークスペースのメンバーでなければ 0 行。
UPDATE workspace_members
   SET status_emoji      = NULL,
       status_text       = NULL,
       status_expires_at = NULL
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id);

-- name: GetMemberStatus :one
-- 1 人ぶんのステータス（イベントに載せる値を、書いた直後に読み直すのに使う）。
SELECT status_emoji, status_text, status_expires_at
  FROM workspace_members
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id);
