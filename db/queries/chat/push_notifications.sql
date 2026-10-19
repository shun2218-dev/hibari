-- プッシュ通知を送る相手と本文（ADR 0069 決定 5・7）。
--
-- 送るかどうかの規則は Go の純粋な関数（internal/chat/push_notification.go の pushReasons）が決める。
-- ここは判定に使う値を、ルームの参加者の分だけ 1 回で読む（N+1 にしない）。規則を SQL に書かないのは、
-- クライアントの shouldNotify と同じ表（testdata/notification-rules.json）で、DB なしに確かめられるようにするため。

-- name: ListPushCandidates :many
-- 送る相手の候補: ルームの参加者のうち、送信者でなく、購読が 1 つ以上ある人。
-- 判定はメッセージの作成の後にここで DB を読む（ルール 8。キックや非公開ルームからの削除の直後に送らないため）。
-- 購読のない人はどの規則でも送れないので、先に落として行を減らす（大きなルームの @channel で全員の設定を読まない）。
-- thread_notify_replies は、スレッドの返信なら参加者の行の値、参加していないかスレッドの返信でなければ NULL。
SELECT rm.user_id,
       wm.notify_level AS workspace_level,
       rm.notify_level AS room_level,
       rm.muted,
       rm.muted_until,
       tm.notify_replies AS thread_notify_replies
  FROM room_members rm
  JOIN rooms r ON r.id = rm.room_id
  JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = rm.user_id
  LEFT JOIN thread_members tm ON tm.thread_root_id = sqlc.narg(thread_root_id) AND tm.user_id = rm.user_id
 WHERE rm.room_id = sqlc.arg(room_id)
   AND rm.user_id <> sqlc.arg(sender_id)
   AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = rm.user_id)
 ORDER BY rm.user_id;

-- name: ListPushChannelLinks :many
-- 本文のチャンネルへのリンク（ADR 0062）の名前と、private なら user_ids のうちの参加者。
-- 名前は受け取る人が読めるときだけ出す（Web がルーム一覧から引くのと同じ範囲。読めない private の名前を通知で漏らさない）。
--   - 同じワークスペースの public / private だけ（Web のルーム一覧は表示中のワークスペースのもので、DM は入れない）
--   - private は参加者の行が 1 行ずつ付く。参加者がいなければ member_id が NULL の 1 行になる
SELECT r.id, r.name, r.kind, rm.user_id AS member_id
  FROM rooms r
  LEFT JOIN room_members rm ON r.kind = 'private' AND rm.room_id = r.id AND rm.user_id = ANY(sqlc.arg(user_ids)::uuid[])
 WHERE r.id = ANY(sqlc.arg(room_ids)::uuid[])
   AND r.workspace_id = sqlc.arg(workspace_id)
   AND r.kind <> 'dm';
