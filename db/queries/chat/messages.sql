-- メッセージ（ADR 0002 / 0004 / 0012）。
--
-- 一覧と 1 件の取得は、送信者と返信先のプレビューを同じ文で JOIN する（N+1 にしない）。
-- sqlc は SELECT の列リストを共有できないので、GetMessageView / ListMessagesBefore / ListMessagesAfter / ListMessagesChangedAfter の列は揃えて書く。

-- name: LockRoomMemberships :many
-- user_ids のうちルームのメンバーである人の行を、FOR NO KEY UPDATE でロックして返す（ADR 0012）。
-- 送信は同じトランザクションで last_read_seq を更新するので、その UPDATE と同じ強さのロックを先に取る。
-- FOR SHARE で読んでから UPDATE すると、同じ人の並行した送信が互いの共有ロックを待ってデッドロックする。
SELECT user_id
  FROM room_members
 WHERE room_id = sqlc.arg(room_id)
   AND user_id = ANY(sqlc.arg(user_ids)::uuid[])
 ORDER BY user_id
   FOR NO KEY UPDATE;

-- name: GetMessageIDByClientMsgID :one
-- 冪等な再送の検出。sender_id を条件に含めるので、他人の client_msg_id では引けない。
SELECT id
  FROM messages
 WHERE room_id = sqlc.arg(room_id)
   AND sender_id = sqlc.arg(sender_id)
   AND client_msg_id = sqlc.arg(client_msg_id);

-- name: CreateMessage :exec
-- 返信先が別のルームのメッセージなら、複合 FK（messages_reply_to_fkey）の違反になる。
INSERT INTO messages (id, room_id, seq, change_seq, sender_id, client_msg_id, body, reply_to_id, created_at)
VALUES (sqlc.arg(id), sqlc.arg(room_id), sqlc.arg(seq), sqlc.arg(change_seq), sqlc.arg(sender_id), sqlc.arg(client_msg_id),
        sqlc.arg(body), sqlc.narg(reply_to_id), sqlc.arg(now)::timestamptz);

-- name: AdvanceLastReadSeq :one
-- 既読位置を進める。後退させず、ルームの最新の seq を超えさせない。
-- 送信者の既読（送信の直後）と、POST /rooms/{id}/read の両方で使う。ルームのメンバーでなければ行を返さない。
UPDATE room_members rm
   SET last_read_seq = GREATEST(rm.last_read_seq, LEAST(sqlc.arg(seq)::bigint, r.last_message_seq))
  FROM rooms r
 WHERE r.id = rm.room_id
   AND rm.room_id = sqlc.arg(room_id)
   AND rm.user_id = sqlc.arg(user_id)
RETURNING rm.last_read_seq, r.last_message_seq;

-- name: GetMessageForUpdate :one
-- 編集・削除の対象を行ロックする。room_id を条件に含め、別のルームの ID では見つからないようにする。
-- FOR UPDATE ではなく FOR NO KEY UPDATE にする（ADR 0014）。返信の送信は rooms の行ロックを持ったまま返信先に FOR KEY SHARE を取るので、
-- FOR UPDATE で持ったまま rooms を待つ編集・削除とデッドロックする。本文と削除時刻の UPDATE はキーを変えないので、この強さで足りる。
SELECT *
  FROM messages
 WHERE room_id = sqlc.arg(room_id)
   AND id = sqlc.arg(id)
   FOR NO KEY UPDATE;

-- name: GetMessageSenderID :one
-- 削除の判定に送信者のロールが必要なので、ロックを取る前に送信者を読む。sender_id は変わらないので、ロックの前に読んでよい。
SELECT sender_id
  FROM messages
 WHERE room_id = sqlc.arg(room_id)
   AND id = sqlc.arg(id);

-- name: UpdateMessageBody :exec
UPDATE messages
   SET body       = sqlc.arg(body),
       edited_at  = sqlc.arg(now)::timestamptz,
       change_seq = sqlc.arg(change_seq)
 WHERE id = sqlc.arg(id);

-- name: SoftDeleteMessage :exec
-- 論理削除。行と seq は残し、本文だけを消す（ADR 0002 / 0004）。
UPDATE messages
   SET body       = '',
       deleted_at = sqlc.arg(now)::timestamptz,
       change_seq = sqlc.arg(change_seq)
 WHERE id = sqlc.arg(id);

-- name: GetMessageView :one
SELECT m.id, m.room_id, m.seq, m.change_seq, m.sender_id, m.client_msg_id, m.body, m.reply_to_id,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name,
       p.seq AS reply_seq, p.sender_id AS reply_sender_id, p.body AS reply_body, p.deleted_at AS reply_deleted_at,
       pu.handle AS reply_sender_handle, pu.display_name AS reply_sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages p ON p.room_id = m.room_id AND p.id = m.reply_to_id
  LEFT JOIN users pu ON pu.id = p.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.id = sqlc.arg(id);

-- name: ListMessagesBefore :many
-- seq が before_seq より小さいメッセージを、新しい順に max_rows 件。最新のページは before_seq に最大値を渡す。
-- 「before_seq が NULL なら条件なし」とは書かない。汎用の実行計画でインデックスの範囲条件にならず、ルームの全件を走査しうるため。
-- インデックス messages_room_id_seq_idx (room_id, seq DESC) を順方向に走査する。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.sender_id, m.client_msg_id, m.body, m.reply_to_id,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name,
       p.seq AS reply_seq, p.sender_id AS reply_sender_id, p.body AS reply_body, p.deleted_at AS reply_deleted_at,
       pu.handle AS reply_sender_handle, pu.display_name AS reply_sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages p ON p.room_id = m.room_id AND p.id = m.reply_to_id
  LEFT JOIN users pu ON pu.id = p.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.seq < sqlc.arg(before_seq)
 ORDER BY m.seq DESC
 LIMIT sqlc.arg(max_rows);

-- name: ListMessagesAfter :many
-- seq が after_seq より大きいメッセージを、古い順に max_rows 件。再接続の差分取得（ADR 0004）。
-- 同じインデックスを逆方向に走査する。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.sender_id, m.client_msg_id, m.body, m.reply_to_id,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name,
       p.seq AS reply_seq, p.sender_id AS reply_sender_id, p.body AS reply_body, p.deleted_at AS reply_deleted_at,
       pu.handle AS reply_sender_handle, pu.display_name AS reply_sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages p ON p.room_id = m.room_id AND p.id = m.reply_to_id
  LEFT JOIN users pu ON pu.id = p.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.seq > sqlc.arg(after_seq)
 ORDER BY m.seq
 LIMIT sqlc.arg(max_rows);

-- name: ListMessagesChangedAfter :many
-- change_seq が after_change_seq より大きいメッセージ（作成・編集・削除）を、change_seq の古い順に max_rows 件。
-- 再接続の差分取得（ADR 0014）。インデックス messages_room_id_change_seq_idx を順方向に走査する。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.sender_id, m.client_msg_id, m.body, m.reply_to_id,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name,
       p.seq AS reply_seq, p.sender_id AS reply_sender_id, p.body AS reply_body, p.deleted_at AS reply_deleted_at,
       pu.handle AS reply_sender_handle, pu.display_name AS reply_sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages p ON p.room_id = m.room_id AND p.id = m.reply_to_id
  LEFT JOIN users pu ON pu.id = p.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.change_seq > sqlc.arg(after_change_seq)
 ORDER BY m.change_seq
 LIMIT sqlc.arg(max_rows);
