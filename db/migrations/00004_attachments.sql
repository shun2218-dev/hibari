-- 添付ファイル: attachments（ADR 0008）

-- +goose Up

CREATE TABLE attachments (
    id          uuid        PRIMARY KEY,
    -- アップロード URL を発行した時点で authz を通したルーム。
    room_id     uuid        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    uploader_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- NULL なら未確定（pending）。
    message_id  uuid,
    status      text        NOT NULL CHECK (status IN ('pending', 'attached')),
    -- S3 API のオブジェクトキー。
    object_key  text        NOT NULL,
    -- 発行時は申告値。complete で HEAD の結果と一致することを確かめる。
    mime_type   text        NOT NULL,
    size_bytes  bigint      NOT NULL CHECK (size_bytes > 0),
    -- 画像のみ。
    width       integer     CHECK (width > 0),
    height      integer     CHECK (height > 0),
    created_at  timestamptz NOT NULL,

    CONSTRAINT attachments_object_key_key UNIQUE (object_key),
    -- status と message_id を食い違わせない。
    CONSTRAINT attachments_status_message CHECK ((status = 'attached') = (message_id IS NOT NULL)),
    -- 添付先は同じルームのメッセージに限る。別ルームでアップロードした添付を付け替えられないよう DB でも保証する。
    -- NO ACTION（文の終わりに検査）にするのは、ルームの削除で messages と attachments が同じ文の中で
    -- CASCADE されるのを許しつつ、メッセージだけを物理削除して添付の行（= ストレージのオブジェクトを
    -- 消すための手がかり）を失うことは防ぐため。
    CONSTRAINT attachments_message_fkey FOREIGN KEY (room_id, message_id)
        REFERENCES messages (room_id, id) ON DELETE NO ACTION
);
-- メッセージの添付一覧に使う。room_id が先頭なので、rooms の CASCADE の検索にも使われる。
CREATE INDEX attachments_room_id_message_id_idx ON attachments (room_id, message_id);

-- +goose Down

DROP TABLE attachments;
