-- スレッド（返信をチャンネルのタイムラインから分ける。ADR 0036）

-- +goose Up

-- 引用付きの返信はスレッドに置き換える。既存の返信は、チャンネルの普通の投稿として残る（引用の表示だけが消える）。
ALTER TABLE messages DROP CONSTRAINT messages_reply_to_fkey;
ALTER TABLE messages DROP COLUMN reply_to_id;

-- 返信の行だけが持つ列。順序と同期は、ルームの seq / change_seq をそのまま使う（ADR 0036）。
ALTER TABLE messages ADD COLUMN thread_root_id uuid;
-- スレッドの中で何番目の返信か。スレッドの未読（親の last_thread_seq - 既読位置）に使う。順序の根拠にはしない。
ALTER TABLE messages ADD COLUMN thread_seq bigint CHECK (thread_seq > 0);

-- 親の行だけが使う列。
-- last_thread_seq は thread_seq の採番カウンタ（減らない）。thread_reply_count は削除されていない返信の数（表示用。返信の削除で減る）。
-- 2 つに分けるのは、未読の番号が減ると既読位置との引き算が壊れるため。
ALTER TABLE messages ADD COLUMN last_thread_seq bigint NOT NULL DEFAULT 0 CHECK (last_thread_seq >= 0);
ALTER TABLE messages ADD COLUMN thread_reply_count integer NOT NULL DEFAULT 0 CHECK (thread_reply_count >= 0);
ALTER TABLE messages ADD COLUMN thread_last_reply_at timestamptz;

ALTER TABLE messages ADD CONSTRAINT messages_thread_fields_check CHECK (
    (thread_root_id IS NULL) = (thread_seq IS NULL) AND thread_root_id <> id AND (thread_root_id IS NULL OR kind = 'user')
);
-- 親は同じルームのメッセージに限る（messages_room_id_id_key を参照する複合 FK）。
-- メッセージの行が物理削除されるのはルームごと消えるときだけなので、返信も一緒に消してよい。
-- 入れ子（返信への返信）と、システムメッセージを親にすることは、送信時に親の行をロックして拒む（CHECK では表せない）。
ALTER TABLE messages ADD CONSTRAINT messages_thread_root_fkey FOREIGN KEY (room_id, thread_root_id)
    REFERENCES messages (room_id, id) ON DELETE CASCADE;

-- チャンネルのページング（before_seq / after_seq / 最新のページ）。返信の行を読み飛ばさずに 1 ページを読めるよう、返信を除いた部分インデックスにする。
CREATE INDEX messages_room_id_channel_seq_idx ON messages (room_id, seq DESC) WHERE thread_root_id IS NULL;
-- スレッドのページングと、既読の seq に対応する thread_seq の検索。
CREATE INDEX messages_thread_root_id_seq_idx ON messages (thread_root_id, seq) WHERE thread_root_id IS NOT NULL;
-- 採番は親の行ロックで直列にするので、これは最後の防御。
CREATE UNIQUE INDEX messages_thread_root_id_thread_seq_idx ON messages (thread_root_id, thread_seq)
    WHERE thread_root_id IS NOT NULL;

-- チャンネルに出る最後のメッセージの seq。ルーム一覧の「最終メッセージ」に使う（last_message_seq はスレッドの返信でも進む）。
ALTER TABLE rooms ADD COLUMN last_channel_seq bigint NOT NULL DEFAULT 0 CHECK (last_channel_seq >= 0);
UPDATE rooms SET last_channel_seq = last_message_seq;

-- スレッドへの参加と既読位置。参加するのは親の投稿者と返信した人（ADR 0036）。
-- 「なぜ参加したか」は持たない。メンションを足したら、メンションされた人の行を同じテーブルに足す。
CREATE TABLE thread_members (
    room_id              uuid        NOT NULL,
    thread_root_id       uuid        NOT NULL,
    user_id              uuid        NOT NULL,
    -- 未読数 = 親の last_thread_seq - これ。DEFAULT を付けないのは、初期化の書き忘れを INSERT のエラーにするため。
    last_read_thread_seq bigint      NOT NULL CHECK (last_read_thread_seq >= 0),
    created_at           timestamptz NOT NULL,

    PRIMARY KEY (thread_root_id, user_id),
    CONSTRAINT thread_members_thread_root_fkey FOREIGN KEY (room_id, thread_root_id)
        REFERENCES messages (room_id, id) ON DELETE CASCADE,
    -- ルームから抜けた・外された・ワークスペースから外れた人の参加は、DB が消す。
    -- ルームのメンバーでない人がスレッドに参加している状態を、アプリのコードに頼らずに作らせない。
    CONSTRAINT thread_members_room_member_fkey FOREIGN KEY (room_id, user_id)
        REFERENCES room_members (room_id, user_id) ON DELETE CASCADE
);
-- 参加しているスレッドの一覧。主キーは thread_root_id が先頭なので使えない。
CREATE INDEX thread_members_user_id_idx ON thread_members (user_id);
-- room_members の行の削除（CASCADE）で、そのルームの参加を探す。
CREATE INDEX thread_members_room_id_user_id_idx ON thread_members (room_id, user_id);

-- +goose Down

DROP TABLE thread_members;
ALTER TABLE rooms DROP COLUMN last_channel_seq;
DROP INDEX messages_thread_root_id_thread_seq_idx;
DROP INDEX messages_thread_root_id_seq_idx;
DROP INDEX messages_room_id_channel_seq_idx;
ALTER TABLE messages DROP CONSTRAINT messages_thread_root_fkey;
ALTER TABLE messages DROP CONSTRAINT messages_thread_fields_check;
ALTER TABLE messages DROP COLUMN thread_last_reply_at;
ALTER TABLE messages DROP COLUMN thread_reply_count;
ALTER TABLE messages DROP COLUMN last_thread_seq;
ALTER TABLE messages DROP COLUMN thread_seq;
-- スレッドの返信は、チャンネルの投稿として残る（引用の情報は戻らない）。
ALTER TABLE messages DROP COLUMN thread_root_id;
ALTER TABLE messages ADD COLUMN reply_to_id uuid;
ALTER TABLE messages ADD CONSTRAINT messages_reply_to_fkey FOREIGN KEY (room_id, reply_to_id)
    REFERENCES messages (room_id, id) ON DELETE SET NULL (reply_to_id);
