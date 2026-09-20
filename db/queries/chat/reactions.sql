-- 絵文字のリアクション（ADR 0044）。
--
-- 行を積むだけで、件数のカウンタは持たない。数も「誰が付けたか」も、読むときに数え直す。
-- 付け外しの冪等性は主キー（message_id, user_id, emoji）が保証するので、
-- アプリ側で「すでに付いているか」を確かめてから書く、という往復は要らない。

-- name: AddMessageReaction :execrows
-- 付ける。すでに付いていれば 0 行。呼ぶ側は「0 行なら change_seq を進めない」で冪等にできる（ADR 0044 決定 2）。
INSERT INTO message_reactions (room_id, message_id, user_id, emoji, created_at)
VALUES (sqlc.arg(room_id), sqlc.arg(message_id), sqlc.arg(user_id), sqlc.arg(emoji), sqlc.arg(now))
    ON CONFLICT DO NOTHING;

-- name: RemoveMessageReaction :execrows
-- 外す。付いていなければ 0 行。
DELETE FROM message_reactions
 WHERE message_id = sqlc.arg(message_id)
   AND user_id = sqlc.arg(user_id)
   AND emoji = sqlc.arg(emoji);

-- name: CountMessageReactionKinds :one
-- そのメッセージに付いている絵文字の種類の数。20 種類の上限（ADR 0044 決定 5）の判定に使う。
-- 付ける直前に、そのメッセージの行を FOR UPDATE で押さえた上で数える（同時に 21 種類目が入らないように）。
SELECT count(DISTINCT emoji)::bigint
  FROM message_reactions
 WHERE message_id = sqlc.arg(message_id);

-- name: MessageReactionKindExists :one
-- その絵文字がすでにそのメッセージに付いているか。種類の上限に達していても、
-- 「すでにある絵文字をもう 1 人が押す」のは種類が増えないので通すために使う。
SELECT EXISTS (
    SELECT 1 FROM message_reactions
     WHERE message_id = sqlc.arg(message_id)
       AND emoji = sqlc.arg(emoji)
);

-- name: UpdateMessageChangeSeq :exec
-- 本文を変えずに change_seq だけを進める（リアクションの付け外し。ADR 0044 決定 2）。
-- edited_at は触らない。リアクションは「編集」ではないので、（編集済み）を付けてはいけない。
UPDATE messages
   SET change_seq = sqlc.arg(change_seq)
 WHERE id = sqlc.arg(id);

-- name: ListMessageReactions :many
-- ページの全メッセージのリアクションを、1 回で絵文字ごとに集計する（N+1 にしない）。
--
-- 並びは「最初に付いた順」（MIN(created_at)）。数が増減しても入れ替わらない（ADR 0044 決定 3）。
-- users は先頭 8 人まで。全員を載せるとレスポンスが人数ぶん膨らむので、ホバーに要る数だけにする。
-- me は「受け取る人ごとの値」なので REST でしか使わない。WebSocket の配信では捨てる（ADR 0044 決定 3 の追記）。
SELECT mr.message_id,
       mr.emoji,
       count(*)::bigint                                                    AS reaction_count,
       bool_or(mr.user_id = sqlc.arg(viewer))                              AS reacted_by_viewer,
       (array_agg(mr.user_id ORDER BY mr.created_at, mr.user_id))[1:8]::uuid[] AS user_ids
  FROM message_reactions mr
 WHERE mr.room_id = sqlc.arg(room_id)
   AND mr.message_id = ANY(sqlc.arg(message_ids)::uuid[])
 GROUP BY mr.message_id, mr.emoji
 ORDER BY mr.message_id, min(mr.created_at), mr.emoji;
