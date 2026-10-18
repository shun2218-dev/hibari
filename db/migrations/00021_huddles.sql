-- 音声のハドル（ADR 0066）。
--
-- Postgres に置くのは、残らなければ困る履歴だけ（決定 3）。
-- いま入っている人・心拍の期限・「もうすぐ参加する」は自動で変わる状態なので Redis に置く（CLAUDE.md ルール 5）。

-- +goose Up

-- 会話に残すハドルのメッセージ（決定 12）。DM にも書く（ADR 0033 の例外）。
ALTER TABLE messages DROP CONSTRAINT messages_system_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_system_type_check CHECK (
    system_type IN ('room_created', 'member_joined', 'member_left', 'member_removed', 'room_renamed', 'message_pinned',
                    'room_archived', 'room_unarchived', 'huddle')
);

-- ハドル 1 回ぶん。始めた時刻と終わった時刻、会話に残したメッセージ。
CREATE TABLE huddles (
    id         uuid        PRIMARY KEY,
    room_id    uuid        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    -- 利用者は論理削除なので、行が消えることはない。消えるなら先に履歴をどうするか決める必要があるので止める
    started_by uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- 会話に残したシステムメッセージ（system_type = huddle）。ハドルのチャット（ADR 0066 追記 A）はこのメッセージのスレッド
    message_id uuid        NOT NULL,
    started_at timestamptz NOT NULL,
    -- null なら進行中。最後の人が抜けた・アーカイブ・削除で埋まる
    ended_at   timestamptz,
    FOREIGN KEY (room_id, message_id) REFERENCES messages (room_id, id) ON DELETE CASCADE,
    UNIQUE (message_id),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- 進行中のハドルは 1 ルームに 1 つ（決定 3）。2 人が同時に始めても、後の INSERT はここで止まり、先のハドルに入り直す
CREATE UNIQUE INDEX huddles_room_id_active_idx ON huddles (room_id) WHERE ended_at IS NULL;

-- ハドルに一度でも入った人（決定 3）。人ごとに 1 回だけ書く。終わったメッセージの「参加した人」に使う（決定 12）。
CREATE TABLE huddle_participants (
    huddle_id uuid        NOT NULL REFERENCES huddles (id) ON DELETE CASCADE,
    user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- 最初に入った時刻。参加した人を並べる順
    joined_at timestamptz NOT NULL,
    PRIMARY KEY (huddle_id, user_id)
);

-- +goose Down

DROP TABLE huddle_participants;
DROP TABLE huddles;
-- ハドルのチャット（ハドルのメッセージのスレッド）の返信は、スレッドの親の外部キー（CASCADE）で一緒に消える
DELETE FROM messages WHERE system_type = 'huddle';
ALTER TABLE messages DROP CONSTRAINT messages_system_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_system_type_check CHECK (
    system_type IN ('room_created', 'member_joined', 'member_left', 'member_removed', 'room_renamed', 'message_pinned',
                    'room_archived', 'room_unarchived')
);
