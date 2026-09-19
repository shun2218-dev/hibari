-- メッセージ（ADR 0002 / 0004 / 0012）。
--
-- 一覧と 1 件の取得は、送信者を同じ文で JOIN する（N+1 にしない）。
-- sqlc は SELECT の列リストを共有できないので、GetMessageView / ListMessagesBefore / ListMessagesAfter / ListMessagesChangedAfter /
-- ListThreadMessagesBefore / ListThreadMessagesAfter の列は揃えて書く。

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
-- スレッドの返信なら thread_root_id と thread_seq を入れる（ADR 0036）。親は呼び出し側でロックして確かめてある。
INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body, thread_root_id, thread_seq, created_at)
VALUES (sqlc.arg(id), sqlc.arg(room_id), sqlc.arg(seq), sqlc.arg(change_seq), sqlc.arg(user_seq), sqlc.arg(sender_id),
        sqlc.arg(client_msg_id), sqlc.arg(body), sqlc.narg(thread_root_id), sqlc.narg(thread_seq), sqlc.arg(now)::timestamptz);

-- name: CreateSystemMessage :exec
-- ログの 1 行（ADR 0033）。sender はその行の主語（参加した人、名前を変えた人）。
-- user_seq は増やさず、直前の値をそのまま入れる（未読数に数えない）。
INSERT INTO messages (id, room_id, seq, change_seq, user_seq, sender_id, client_msg_id, body,
                      kind, system_type, system_data, created_at)
VALUES (sqlc.arg(id), sqlc.arg(room_id), sqlc.arg(seq), sqlc.arg(change_seq), sqlc.arg(user_seq), sqlc.arg(sender_id),
        sqlc.arg(client_msg_id), '', 'system', sqlc.arg(system_type), sqlc.narg(system_data), sqlc.arg(now)::timestamptz);

-- name: AdvanceLastReadSeq :one
-- 既読位置を進める。後退させず、ルームの最新の seq を超えさせない。
-- 送信者の既読（送信の直後）と、POST /rooms/{id}/read の両方で使う。ルームのメンバーでなければ行を返さない。
--
-- 未読数はシステムメッセージを数えない（ADR 0033）ので、既読の seq に対応する user_seq も一緒に進める。
-- 「その seq 以下で最大の user_seq」を messages_room_id_seq_idx の 1 回の走査で引く。
UPDATE room_members rm
   SET last_read_seq = GREATEST(rm.last_read_seq, LEAST(sqlc.arg(seq)::bigint, r.last_message_seq)),
       last_read_user_seq = GREATEST(rm.last_read_user_seq, COALESCE((
           SELECT m.user_seq
             FROM messages m
            WHERE m.room_id = rm.room_id
              AND m.seq <= LEAST(sqlc.arg(seq)::bigint, r.last_message_seq)
            ORDER BY m.seq DESC
            LIMIT 1), 0))
  FROM rooms r
 WHERE r.id = rm.room_id
   AND rm.room_id = sqlc.arg(room_id)
   AND rm.user_id = sqlc.arg(user_id)
RETURNING rm.last_read_seq, rm.last_read_user_seq, r.last_message_seq, r.last_user_seq;

-- name: GetMessageForUpdate :one
-- 編集・削除の対象を行ロックする。room_id を条件に含め、別のルームの ID では見つからないようにする。
-- FOR UPDATE ではなく FOR NO KEY UPDATE にする（ADR 0014）。返信の INSERT は rooms の行ロックを持ったまま親に FOR KEY SHARE（複合 FK）を取るので、
-- FOR UPDATE で持ったまま rooms を待つ編集・削除とデッドロックする。本文・削除時刻・スレッドの集計の UPDATE はキーを変えないので、この強さで足りる。
-- スレッドの返信の送信は、親をこのクエリでロックしてから rooms をロックする（編集と同じ「メッセージ → rooms」の順。ADR 0036）。
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
SELECT m.id, m.room_id, m.seq, m.change_seq, m.user_seq, m.sender_id, m.client_msg_id, m.body,
       m.kind, m.system_type, m.system_data,
       m.thread_root_id, m.thread_seq, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.id = sqlc.arg(id);

-- name: ListMessagesBefore :many
-- チャンネルのタイムライン（スレッドの返信を除く。ADR 0036）で、seq が before_seq より小さいメッセージを、新しい順に max_rows 件。
-- 最新のページは before_seq に最大値を渡す。
-- 「before_seq が NULL なら条件なし」とは書かない。汎用の実行計画でインデックスの範囲条件にならず、ルームの全件を走査しうるため。
-- 部分インデックス messages_room_id_channel_seq_idx (room_id, seq DESC) WHERE thread_root_id IS NULL を順方向に走査する。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.user_seq, m.sender_id, m.client_msg_id, m.body,
       m.kind, m.system_type, m.system_data,
       m.thread_root_id, m.thread_seq, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.thread_root_id IS NULL
   AND m.seq < sqlc.arg(before_seq)
 ORDER BY m.seq DESC
 LIMIT sqlc.arg(max_rows);

-- name: ListMessagesAfter :many
-- チャンネルのタイムラインで、seq が after_seq より大きいメッセージを、古い順に max_rows 件。
-- 同じ部分インデックスを逆方向に走査する。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.user_seq, m.sender_id, m.client_msg_id, m.body,
       m.kind, m.system_type, m.system_data,
       m.thread_root_id, m.thread_seq, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.thread_root_id IS NULL
   AND m.seq > sqlc.arg(after_seq)
 ORDER BY m.seq
 LIMIT sqlc.arg(max_rows);

-- name: ListMessagesChangedAfter :many
-- change_seq が after_change_seq より大きいメッセージ（作成・編集・削除）を、change_seq の古い順に max_rows 件。
-- 再接続の差分取得（ADR 0014）。インデックス messages_room_id_change_seq_idx を順方向に走査する。
-- スレッドの返信と、返信数が変わった親も含める。同期の経路はルームごとに 1 本（ADR 0036）。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.user_seq, m.sender_id, m.client_msg_id, m.body,
       m.kind, m.system_type, m.system_data,
       m.thread_root_id, m.thread_seq, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.change_seq > sqlc.arg(after_change_seq)
 ORDER BY m.change_seq
 LIMIT sqlc.arg(max_rows);

-- name: ListThreadMessagesBefore :many
-- スレッドの返信で、seq が before_seq より小さいものを新しい順に max_rows 件（ADR 0036）。並びはルームの seq。
-- 部分インデックス messages_thread_root_id_seq_idx を逆方向に走査する。親がこのルームにあることは呼び出し側で確かめてある。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.user_seq, m.sender_id, m.client_msg_id, m.body,
       m.kind, m.system_type, m.system_data,
       m.thread_root_id, m.thread_seq, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
 WHERE m.thread_root_id = sqlc.arg(thread_root_id)
   AND m.seq < sqlc.arg(before_seq)
 ORDER BY m.seq DESC
 LIMIT sqlc.arg(max_rows);

-- name: ListThreadMessagesAfter :many
-- スレッドの返信で、seq が after_seq より大きいものを古い順に max_rows 件。
SELECT m.id, m.room_id, m.seq, m.change_seq, m.user_seq, m.sender_id, m.client_msg_id, m.body,
       m.kind, m.system_type, m.system_data,
       m.thread_root_id, m.thread_seq, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.edited_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name
  FROM messages m
  JOIN users u ON u.id = m.sender_id
 WHERE m.thread_root_id = sqlc.arg(thread_root_id)
   AND m.seq > sqlc.arg(after_seq)
 ORDER BY m.seq
 LIMIT sqlc.arg(max_rows);

-- name: AddThreadReply :one
-- 返信を 1 件足したときの親の更新（ADR 0036）。親の行は GetMessageForUpdate でロック済み。
-- 親の change_seq も進め、返信数の変化を after_change_seq の同期に載せる。RETURNING の last_thread_seq が返信の thread_seq になる。
UPDATE messages
   SET last_thread_seq      = last_thread_seq + 1,
       thread_reply_count   = thread_reply_count + 1,
       thread_last_reply_at = sqlc.arg(now)::timestamptz,
       change_seq           = sqlc.arg(change_seq)
 WHERE id = sqlc.arg(id)
RETURNING last_thread_seq;

-- name: RemoveThreadReply :exec
-- 返信を削除したときの親の更新。表示用の返信数だけを減らし、未読のカウンタ（last_thread_seq）は減らさない。
UPDATE messages
   SET thread_reply_count = thread_reply_count - 1,
       change_seq         = sqlc.arg(change_seq)
 WHERE id = sqlc.arg(id);

-- name: FollowThread :execrows
-- スレッドに参加する。ルームのメンバーでなければ何もしない（thread_members は room_members への FK を持つ）。
-- すでに参加していれば何もせず 0 を返す。
INSERT INTO thread_members (room_id, thread_root_id, user_id, last_read_thread_seq, created_at)
SELECT rm.room_id, sqlc.arg(thread_root_id), rm.user_id, sqlc.arg(last_read_thread_seq), sqlc.arg(now)::timestamptz
  FROM room_members rm
 WHERE rm.room_id = sqlc.arg(room_id)
   AND rm.user_id = sqlc.arg(user_id)
ON CONFLICT (thread_root_id, user_id) DO NOTHING;

-- name: AdvanceThreadReadToThreadSeq :exec
-- 自分の返信の送信で、自分の既読位置をその返信まで進める（後退させない）。
UPDATE thread_members
   SET last_read_thread_seq = GREATEST(last_read_thread_seq, sqlc.arg(thread_seq)::bigint)
 WHERE thread_root_id = sqlc.arg(thread_root_id)
   AND user_id = sqlc.arg(user_id);

-- name: AdvanceThreadRead :one
-- POST /rooms/{id}/threads/{rootID}/read。seq を受け取り、その seq 以下で最後の返信の thread_seq まで既読を進める（後退させない）。
-- チャンネルの既読と同じく、seq と thread_seq の取り違えを API に持ち込まない（ADR 0033 / 0036）。参加していなければ行を返さない。
UPDATE thread_members tm
   SET last_read_thread_seq = GREATEST(tm.last_read_thread_seq, COALESCE((
           SELECT m.thread_seq
             FROM messages m
            WHERE m.thread_root_id = tm.thread_root_id
              AND m.seq <= sqlc.arg(seq)::bigint
            ORDER BY m.seq DESC
            LIMIT 1), 0))
  FROM messages r
 WHERE r.id = tm.thread_root_id
   AND tm.thread_root_id = sqlc.arg(thread_root_id)
   AND tm.user_id = sqlc.arg(user_id)
RETURNING tm.last_read_thread_seq, r.last_thread_seq;

-- name: GetThreadMembership :one
SELECT last_read_thread_seq
  FROM thread_members
 WHERE thread_root_id = sqlc.arg(thread_root_id)
   AND user_id = sqlc.arg(user_id);

-- name: ListFollowedThreads :many
-- 参加しているスレッドを、最後の返信が新しい順に max_rows 件（ADR 0036）。after は前のページの最後の親の ID。
-- 並びの (thread_last_reply_at, id) は、返信のたびに変わる。ページをまたいだ重複や取りこぼしは、件数が少ない前提で受け入れる。
-- 参加の行は room_members への FK があるので、読めないルームのスレッドは含まれない。
SELECT m.id, m.room_id, m.seq, m.sender_id, m.body, m.last_thread_seq, m.thread_reply_count, m.thread_last_reply_at,
       m.created_at, m.deleted_at,
       u.handle AS sender_handle, u.display_name AS sender_display_name,
       r.kind AS room_kind, r.name AS room_name, r.dm_key AS room_dm_key,
       tm.last_read_thread_seq
  FROM thread_members tm
  JOIN messages m ON m.id = tm.thread_root_id
  JOIN rooms r ON r.id = tm.room_id
  JOIN users u ON u.id = m.sender_id
 WHERE tm.user_id = sqlc.arg(user_id)
   AND r.workspace_id = sqlc.arg(workspace_id)
   AND (sqlc.narg(after)::uuid IS NULL OR (m.thread_last_reply_at, m.id) < (
           SELECT a.thread_last_reply_at, a.id FROM messages a WHERE a.id = sqlc.narg(after)::uuid))
 ORDER BY m.thread_last_reply_at DESC, m.id DESC
 LIMIT sqlc.arg(max_rows);

-- name: CountUnreadThreads :one
-- 未読の返信がある参加中のスレッドの数（サイドバーの「スレッド」のバッジ。ADR 0036）。
SELECT count(*)
  FROM thread_members tm
  JOIN messages m ON m.id = tm.thread_root_id
  JOIN rooms r ON r.id = tm.room_id
 WHERE tm.user_id = sqlc.arg(user_id)
   AND r.workspace_id = sqlc.arg(workspace_id)
   AND m.last_thread_seq > tm.last_read_thread_seq;
