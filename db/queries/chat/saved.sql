-- 「後で」（自分用の保存。ADR 0054）。

-- name: LockSavedCounter :one
-- 本人の保存の変更を直列にする。同じ人の同時の変更（別のタブ）が、行の読み取りと採番の間に割り込まないようにする。
-- キーは変えないので FOR NO KEY UPDATE（workspace_members への FK の KEY SHARE と取り合わない）。
-- 0 行ならワークスペースのメンバーではない。
SELECT last_saved_change_seq
  FROM workspace_members
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id)
   FOR NO KEY UPDATE;

-- name: AllocateSavedChangeSeq :one
-- 本人ごとの change_seq を 1 つ進める（ADR 0054 決定 7）。実際に状態が変わるときだけ呼ぶ。
UPDATE workspace_members
   SET last_saved_change_seq = last_saved_change_seq + 1
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id)
RETURNING last_saved_change_seq;

-- name: GetLastSavedChangeSeq :one
SELECT last_saved_change_seq
  FROM workspace_members
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id);

-- name: GetSavedMessage :one
SELECT *
  FROM saved_messages
 WHERE user_id = sqlc.arg(user_id)
   AND message_id = sqlc.arg(message_id);

-- name: InsertSavedMessage :exec
INSERT INTO saved_messages (workspace_id, user_id, message_id, room_id, id, state, change_seq, saved_at, updated_at)
VALUES (sqlc.arg(workspace_id), sqlc.arg(user_id), sqlc.arg(message_id), sqlc.arg(room_id), sqlc.arg(id),
        'in_progress', sqlc.arg(change_seq), sqlc.arg(now)::timestamptz, sqlc.arg(now)::timestamptz);

-- name: ResaveSavedMessage :exec
-- 外した行をもう一度保存した。同じ行を進行中に戻し、ID を振り直して一覧の先頭に出す（決定 6）。
UPDATE saved_messages
   SET id         = sqlc.arg(id),
       state      = 'in_progress',
       change_seq = sqlc.arg(change_seq),
       saved_at   = sqlc.arg(now)::timestamptz,
       updated_at = sqlc.arg(now)::timestamptz
 WHERE user_id = sqlc.arg(user_id)
   AND message_id = sqlc.arg(message_id);

-- name: UpdateSavedMessageState :exec
UPDATE saved_messages
   SET state      = sqlc.arg(state),
       change_seq = sqlc.arg(change_seq),
       updated_at = sqlc.arg(now)::timestamptz
 WHERE user_id = sqlc.arg(user_id)
   AND message_id = sqlc.arg(message_id);

-- name: ListSavedMessages :many
-- タブの一覧を保存した新しい順に max_rows 件。最初のページは before_id に最大の ID を渡す（カーソル。OFFSET を使わない）。
SELECT *
  FROM saved_messages
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id)
   AND state = sqlc.arg(state)
   AND id < sqlc.arg(before_id)
 ORDER BY id DESC
 LIMIT sqlc.arg(max_rows);

-- name: ListSavedMessagesChangedAfter :many
-- 再接続の差分（決定 7）。removed の行も返す（切断中に外されたものを消せるように）。
SELECT *
  FROM saved_messages
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id)
   AND change_seq > sqlc.arg(after_change_seq)
 ORDER BY change_seq
 LIMIT sqlc.arg(max_rows);

-- name: CountSavedInProgress :one
-- 「進行中」のタブの件数（決定 9）。読めなくなった行も数える（一覧に残るので、件数と行の数をそろえる）。
SELECT count(*)
  FROM saved_messages
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND user_id = sqlc.arg(user_id)
   AND state = 'in_progress';

-- name: ListSavedMessageIDs :many
-- メッセージの「保存済み」の印（決定 10）。ページの全メッセージを 1 回で引く（N+1 にしない）。
SELECT message_id
  FROM saved_messages
 WHERE user_id = sqlc.arg(user_id)
   AND message_id = ANY(sqlc.arg(message_ids)::uuid[])
   AND state <> 'removed';

-- name: ListMessageViewsByIDs :many
-- 保存の一覧に載せるメッセージを、ルームごとにまとめて読む。列は GetMessageView と同じ。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.user_seq, m.sender_id, m.client_msg_id, m.body,
       m.kind, m.system_type, m.system_data,
       m.thread_root_id, m.thread_seq, m.in_channel, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name,
       m.pinned_at, m.pinned_by, pu.handle AS pinned_by_handle, pu.display_name AS pinned_by_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN users pu ON pu.id = m.pinned_by
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.id = ANY(sqlc.arg(ids)::uuid[]);
