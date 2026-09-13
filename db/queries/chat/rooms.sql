-- name: AllocateMessageSeq :one
-- ルームの次の seq を採番して返す（ADR 0002「採番方式の確定」）。
-- 送信と同じトランザクションの中で呼ぶ。rooms の行ロックで同じルームへの送信が直列化され、
-- ロールバックすれば採番も取り消されるので欠番にならない。
UPDATE rooms
   SET last_message_seq = last_message_seq + 1,
       last_message_at  = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(room_id)
RETURNING last_message_seq;
