-- スレッドの通知（ADR 0056）。

-- +goose Up

-- 「返信の通知」。オフでも参加は残す（一覧に残り、未読も数える。見せ方だけを変える。決定 1・2）。
-- 返信やメンションで参加し直しても戻さない（オフにした意味がなくなる）。本人が選んだ設定なので Postgres に置く。
ALTER TABLE thread_members
    ADD COLUMN notify_replies boolean NOT NULL DEFAULT true;

-- 1 対 1 の DM のスレッドは 2 人とも参加者にする（Slack の既定。決定 6）。これまでの DM のスレッドにも足す。
-- 既読位置は親の last_thread_seq にして、過去の返信を未読にしない。
INSERT INTO thread_members (room_id, thread_root_id, user_id, last_read_thread_seq, created_at)
SELECT m.room_id, m.id, rm.user_id, m.last_thread_seq, now()
  FROM messages m
  JOIN rooms r ON r.id = m.room_id AND r.kind = 'dm'
  JOIN room_members rm ON rm.room_id = m.room_id
 WHERE m.last_thread_seq > 0
ON CONFLICT (thread_root_id, user_id) DO NOTHING;

-- +goose Down

-- 足した DM の参加の行は区別できないので残す（参加していても害はない）。
ALTER TABLE thread_members DROP COLUMN notify_replies;
