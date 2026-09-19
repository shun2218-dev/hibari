-- メンション（ADR 0041）。
--
-- 行は常に本文と一致させる。送信・編集・削除のたびに、そのメッセージの行を消してから入れ直す。
-- 件数は数えるときに「既読位置より後の行」を数える（カウンタの列は持たない）。数える条件はルームの一覧にも書いてある（rooms.sql）。

-- name: DeleteMessageMentions :exec
-- 本文が変わる前に、そのメッセージの行を消す。編集・削除のたびに呼ぶ。
DELETE FROM message_mentions
 WHERE room_id = sqlc.arg(room_id)
   AND message_id = sqlc.arg(message_id);

-- name: CreateUserMentions :execrows
-- 個人へのメンション（kind = 'user'）と @here の解決結果（kind = 'here'）を入れる。
-- room_members を JOIN するので、ルームのメンバーでない人の行はできない（知らせない。ADR 0041）。
-- FK に任せて弾くとトランザクションごと落ちるので、ここで静かに落とす。
-- 同じ人が @here と個人の両方で挙がったときは、先に入れた方（個人）が残る。
INSERT INTO message_mentions (room_id, message_id, user_id, kind, created_at)
SELECT sqlc.arg(room_id), sqlc.arg(message_id), rm.user_id, sqlc.arg(kind), sqlc.arg(now)
  FROM room_members rm
 WHERE rm.room_id = sqlc.arg(room_id)
   AND rm.user_id = ANY(sqlc.arg(user_ids)::uuid[])
    ON CONFLICT DO NOTHING;

-- name: CreateChannelMention :exec
-- @channel は 1 行だけ。user_id が NULL で「ルームの全員」を表すので、ルームの人数によらず書き込みは 1 行で済む。
INSERT INTO message_mentions (room_id, message_id, user_id, kind, created_at)
VALUES (sqlc.arg(room_id), sqlc.arg(message_id), NULL, 'channel', sqlc.arg(now))
    ON CONFLICT DO NOTHING;

-- name: CountRoomMentions :one
-- 1 つのルームの、自分宛ての未読のメンションの数。既読の更新（ADR 0041）で使う。
-- 条件は ListRoomsForUser / GetRoomSummary の相関サブクエリと同じ。片方だけ直さないこと。
SELECT count(*)::bigint
  FROM message_mentions mm
  JOIN messages m ON m.room_id = mm.room_id AND m.id = mm.message_id
  JOIN room_members rm ON rm.room_id = mm.room_id AND rm.user_id = sqlc.arg(user_id)
  -- スレッドだけの返信は、チャンネルの既読位置では判定できない（ADR 0036）。自分のスレッドの既読位置と比べる。
  LEFT JOIN thread_members tm ON tm.thread_root_id = m.thread_root_id AND tm.user_id = sqlc.arg(user_id)
 WHERE mm.room_id = sqlc.arg(room_id)
   -- user_id が NULL の行は @channel（ルームの全員）。rm を JOIN しているので、メンバーでなければ数えない。
   AND (mm.user_id IS NULL OR mm.user_id = sqlc.arg(user_id))
   AND CASE WHEN m.in_channel THEN m.user_seq > rm.last_read_user_seq
            ELSE tm.user_id IS NOT NULL AND m.thread_seq > tm.last_read_thread_seq
       END;
