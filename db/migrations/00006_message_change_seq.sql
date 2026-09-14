-- メッセージの変更番号（change_seq）。作成・編集・削除をまとめて差分取得するためのカーソル（ADR 0014）

-- +goose Up

-- 採番カウンタ兼「最新の change_seq」。作成・編集・削除のたびに 1 増やす。seq（last_message_seq）とは別に持つ。
ALTER TABLE rooms ADD COLUMN last_change_seq bigint NOT NULL DEFAULT 0 CHECK (last_change_seq >= 0);

-- 最後に作成・編集・削除されたときの rooms.last_change_seq。
-- DEFAULT を付けないのは、採番の書き忘れを INSERT のエラーとして検出するため（room_members.last_read_seq と同じ）。
-- 既存の行は編集・削除の履歴を持たないので、作成順の seq をそのまま使う。
ALTER TABLE messages ADD COLUMN change_seq bigint CHECK (change_seq > 0);
UPDATE messages SET change_seq = seq;
ALTER TABLE messages ALTER COLUMN change_seq SET NOT NULL;
UPDATE rooms SET last_change_seq = last_message_seq;

-- 差分取得（change_seq > N を昇順に読む）と、同じ番号の二重使用の防止を兼ねる。
CREATE UNIQUE INDEX messages_room_id_change_seq_idx ON messages (room_id, change_seq);

-- +goose Down

DROP INDEX messages_room_id_change_seq_idx;
ALTER TABLE messages DROP COLUMN change_seq;
ALTER TABLE rooms DROP COLUMN last_change_seq;
