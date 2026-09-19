-- 削除したメッセージを画面から消す（ADR 0038）。
-- ルーム一覧の最終メッセージは「削除されていない最後のチャンネルの行」を LATERAL で引くので、
-- その位置を持っていた rooms.last_channel_seq（ADR 0036）は使わなくなった。

-- +goose Up

ALTER TABLE rooms DROP COLUMN last_channel_seq;

-- +goose Down

ALTER TABLE rooms ADD COLUMN last_channel_seq bigint NOT NULL DEFAULT 0 CHECK (last_channel_seq >= 0);
UPDATE rooms r
   SET last_channel_seq = COALESCE(
       (SELECT max(m.seq) FROM messages m WHERE m.room_id = r.id AND m.thread_root_id IS NULL), 0);
