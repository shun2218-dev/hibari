-- ピン留め（ADR 0054 決定 1・3）。
-- 1 つのメッセージは「ピン留めされているか、いないか」の 2 通りしかないので、別のテーブルにせず messages の列で持つ。
-- 列で持つと、ピン留めの状態がメッセージの行と同じトランザクション・同じ change_seq で変わる。

-- +goose Up

ALTER TABLE messages
    ADD COLUMN pinned_at timestamptz,
    -- users は物理削除しない（sender_id と同じく、万一のときにメッセージごと消えないよう RESTRICT）。
    -- ピンはルームのものなので、付けた人がルームやワークスペースから抜けても残す（room_members には FK を張らない）。
    ADD COLUMN pinned_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD CONSTRAINT messages_pinned_check CHECK ((pinned_at IS NULL) = (pinned_by IS NULL));
-- ピン留めの一覧（新しい順）と、上限（100 件）を確かめるための件数。ピン留めされた行だけが入る。
CREATE INDEX messages_room_id_pinned_at_idx ON messages (room_id, pinned_at DESC, id DESC) WHERE pinned_at IS NOT NULL;

-- ピン留めのログ（「〜がピン留めしました」）を、システムメッセージの種類に足す。
ALTER TABLE messages DROP CONSTRAINT messages_system_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_system_type_check CHECK (
    system_type IN ('room_created', 'member_joined', 'member_left', 'member_removed', 'room_renamed', 'message_pinned')
);

-- +goose Down

DELETE FROM messages WHERE system_type = 'message_pinned';
ALTER TABLE messages DROP CONSTRAINT messages_system_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_system_type_check CHECK (
    system_type IN ('room_created', 'member_joined', 'member_left', 'member_removed', 'room_renamed')
);
DROP INDEX messages_room_id_pinned_at_idx;
ALTER TABLE messages DROP CONSTRAINT messages_pinned_check;
ALTER TABLE messages DROP COLUMN pinned_by;
ALTER TABLE messages DROP COLUMN pinned_at;
