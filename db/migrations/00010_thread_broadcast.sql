-- チャンネルにも投稿する（ADR 0039）。
-- 返信のフラグではなく「この行がチャンネルのタイムラインに出るか」を 1 列で持ち、チャンネルを引く条件と部分インデックスの条件を in_channel だけで書く。
-- 条件を thread_root_id IS NULL OR also_in_channel のような式にすると、書き方が 1 か所ずれただけで部分インデックスが使われなくなる。

-- +goose Up

ALTER TABLE messages ADD COLUMN in_channel boolean;
UPDATE messages SET in_channel = (thread_root_id IS NULL);
-- DEFAULT を付けない。どちらの値も「多くの行で正しい」とは言えず、SQL で書き忘れたら NOT NULL のエラーにする。
ALTER TABLE messages ALTER COLUMN in_channel SET NOT NULL;
-- チャンネルの投稿とシステムメッセージは常にチャンネルに出る。
-- sqlc の引数は Go のゼロ値（false）で渡りうるので、チャンネルの投稿で渡し忘れても、行がチャンネルから消える前にここで止まる。
ALTER TABLE messages ADD CONSTRAINT messages_in_channel_check CHECK (thread_root_id IS NOT NULL OR in_channel);

DROP INDEX messages_room_id_channel_seq_idx;
CREATE INDEX messages_room_id_channel_seq_idx ON messages (room_id, seq DESC) WHERE in_channel;

-- +goose Down

DROP INDEX messages_room_id_channel_seq_idx;
CREATE INDEX messages_room_id_channel_seq_idx ON messages (room_id, seq DESC) WHERE thread_root_id IS NULL;
ALTER TABLE messages DROP CONSTRAINT messages_in_channel_check;
-- チャンネルにも投稿した返信は、スレッドだけの返信に戻る。
ALTER TABLE messages DROP COLUMN in_channel;
