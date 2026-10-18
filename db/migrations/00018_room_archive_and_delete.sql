-- チャンネルのアーカイブと削除（ADR 0059）。rooms.archived_at は 00003 から用意してあるので、列は足さない。

-- +goose Up

-- アーカイブ・復元のログ（決定 4）。
ALTER TABLE messages DROP CONSTRAINT messages_system_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_system_type_check CHECK (
    system_type IN ('room_created', 'member_joined', 'member_left', 'member_removed', 'room_renamed', 'message_pinned',
                    'room_archived', 'room_unarchived')
);

-- 行が消えた後に、ストレージのオブジェクトを消すための列（決定 6）。
-- どの表にも外部キーを張らない。元の行（ルーム・添付）が消えても残すため。
CREATE TABLE storage_deletions (
    object_key text        PRIMARY KEY,
    -- これより前には消さない。削除の直前に発行された PUT URL（15 分。ADR 0013）で、削除の後にオブジェクトが置かれることがあるため。
    not_before timestamptz NOT NULL,
    created_at timestamptz NOT NULL
);
-- 掃除ジョブが「not_before を過ぎた行」を古い順に取る。
CREATE INDEX storage_deletions_not_before_idx ON storage_deletions (not_before);

-- +goose Down

DROP TABLE storage_deletions;
DELETE FROM messages WHERE system_type IN ('room_archived', 'room_unarchived');
ALTER TABLE messages DROP CONSTRAINT messages_system_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_system_type_check CHECK (
    system_type IN ('room_created', 'member_joined', 'member_left', 'member_removed', 'room_renamed', 'message_pinned')
);
