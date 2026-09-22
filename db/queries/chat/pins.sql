-- ピン留め（ADR 0054）。

-- name: PinMessage :execrows
-- まだピン留めされていないときだけ付ける。0 行なら「すでにピン留め済み」で、番号も配信も使わない（冪等。決定 2）。
UPDATE messages
   SET pinned_at  = sqlc.arg(now)::timestamptz,
       pinned_by  = sqlc.arg(pinned_by),
       change_seq = sqlc.arg(change_seq)
 WHERE id = sqlc.arg(id)
   AND pinned_at IS NULL;

-- name: UnpinMessage :execrows
UPDATE messages
   SET pinned_at  = NULL,
       pinned_by  = NULL,
       change_seq = sqlc.arg(change_seq)
 WHERE id = sqlc.arg(id)
   AND pinned_at IS NOT NULL;

-- name: CountRoomPins :one
-- 上限（100 件）の確認。rooms の行ロック（change_seq の採番）を持ったまま数えるので、同じルームの並行したピン留めと取り合わない（決定 4）。
SELECT count(*)
  FROM messages
 WHERE room_id = sqlc.arg(room_id)
   AND pinned_at IS NOT NULL;

-- name: ListRoomPins :many
-- ピン留めした時刻の新しい順（決定 5）。同じ時刻ならメッセージの ID で順を決める。上限が 100 件なのでページングしない。
-- 列は GetMessageView と同じにして、Message への変換を共有する。
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
   AND m.pinned_at IS NOT NULL
 ORDER BY m.pinned_at DESC, m.id DESC
 LIMIT sqlc.arg(max_rows);
