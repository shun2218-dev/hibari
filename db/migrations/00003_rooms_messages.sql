-- チャットドメイン: rooms / room_members / messages（ADR 0002 / 0004 / 0006）

-- +goose Up

CREATE TABLE rooms (
    id               uuid        PRIMARY KEY,
    workspace_id     uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    kind             text        NOT NULL CHECK (kind IN ('public', 'private', 'dm')),
    -- dm では NULL。
    name             text,
    -- dm だけが持つ。2 人の userID をソートして連結した値。
    dm_key           text,
    -- ワークスペースに参加したときに自動で参加するルーム。
    is_default       boolean     NOT NULL DEFAULT false,
    created_by       uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- 採番カウンタ兼「最新の seq」。messages.seq はこれを 1 増やした値だけを使う（ADR 0002）。
    last_message_seq bigint      NOT NULL DEFAULT 0 CHECK (last_message_seq >= 0),
    -- ルーム一覧のソート用に非正規化した値。メッセージが 1 件もなければ NULL。
    last_message_at  timestamptz,
    created_at       timestamptz NOT NULL,
    archived_at      timestamptz,

    -- kind ごとに持つべき列を DB で強制する。dm に名前が付いたり、dm_key のない dm ができたりしないように。
    CONSTRAINT rooms_kind_columns CHECK (
        (kind = 'dm' AND name IS NULL AND dm_key IS NOT NULL AND NOT is_default)
        OR (kind <> 'dm' AND name IS NOT NULL AND dm_key IS NULL)
    )
);
-- dm 以外の名前はワークスペース内で一意。dm は name が NULL なので対象外にする。
CREATE UNIQUE INDEX rooms_workspace_id_name_idx ON rooms (workspace_id, name) WHERE kind <> 'dm';
-- 同じ 2 人の DM はワークスペース内に 1 つだけ。並行した作成でも 2 つにならないよう DB で保証する。
CREATE UNIQUE INDEX rooms_workspace_id_dm_key_idx ON rooms (workspace_id, dm_key) WHERE kind = 'dm';
-- ルーム一覧（最近メッセージがあった順）。メッセージのないルームを末尾に置くため NULLS LAST にする。
-- workspace_id が先頭なので、workspaces を削除するときの CASCADE の検索にも使われる。
CREATE INDEX rooms_workspace_id_last_message_at_idx ON rooms (workspace_id, last_message_at DESC NULLS LAST);

CREATE TABLE room_members (
    room_id       uuid        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- 参加時に rooms.last_message_seq で初期化する。DEFAULT を付けないのは、初期化の書き忘れで
    -- 過去のメッセージがすべて未読になるのを INSERT のエラーとして検出するため。
    last_read_seq bigint      NOT NULL CHECK (last_read_seq >= 0),
    muted_until   timestamptz,
    -- 退出したら行を削除する。
    joined_at     timestamptz NOT NULL,

    PRIMARY KEY (room_id, user_id)
);
-- 「自分が参加しているルーム」に使う。主キーは room_id が先頭なので使えない。
CREATE INDEX room_members_user_id_idx ON room_members (user_id);

CREATE TABLE messages (
    id            uuid        PRIMARY KEY,
    room_id       uuid        NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    -- ルーム内で 1 から始まり欠番のない番号。順序の唯一の根拠（ADR 0002）。
    seq           bigint      NOT NULL CHECK (seq > 0),
    -- users は物理削除しないが、万一のときにメッセージが送信者ごと消えないよう RESTRICT にする。
    sender_id     uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- クライアントが生成する ULID。再送の冪等性に使う（ADR 0004）。
    client_msg_id uuid        NOT NULL,
    -- 論理削除では空文字列にする。
    body          text        NOT NULL,
    reply_to_id   uuid,
    -- 表示専用。ソートにもカーソルにも使わない。
    created_at    timestamptz NOT NULL,
    edited_at     timestamptz,
    -- 論理削除。行と seq は残し、tombstone として配信する。
    deleted_at    timestamptz,

    -- 冪等性。sender_id を含めるのは、他人の client_msg_id を送って既存のメッセージを引き出せないようにするため。
    CONSTRAINT messages_room_id_sender_id_client_msg_id_key UNIQUE (room_id, sender_id, client_msg_id),
    -- 返信の複合 FK の参照先。id は単独で一意なので冗長に見えるが、FK の参照先には UNIQUE 制約が必要。
    CONSTRAINT messages_room_id_id_key UNIQUE (room_id, id),
    -- 返信先は同じルームのメッセージに限る。reply_to_id だけの FK だと別ルームのメッセージを指せてしまう。
    -- 返信先が物理削除されたら reply_to_id だけを NULL にする（列リスト付きの SET NULL は Postgres 15+）。
    -- 列リストがないと room_id まで NULL にしようとして NOT NULL 違反になる。
    CONSTRAINT messages_reply_to_fkey FOREIGN KEY (room_id, reply_to_id)
        REFERENCES messages (room_id, id) ON DELETE SET NULL (reply_to_id)
);
-- UNIQUE(room_id, seq) と INDEX(room_id, seq DESC) を 1 本のインデックスで兼ねる。
-- B-tree は逆方向にも走査できるので、同じ列の昇順と降順を 2 本張っても書き込みが遅くなるだけ。
-- 降順で作るのは、最も頻繁な「最新から N 件」（before_seq / 初回表示）の走査を順方向にするため。
-- after_seq（再接続の差分取得）は同じインデックスを逆方向に走査する。
-- UNIQUE 制約（CONSTRAINT ... UNIQUE）は降順を指定できないので、UNIQUE インデックスとして作る。
CREATE UNIQUE INDEX messages_room_id_seq_idx ON messages (room_id, seq DESC);

-- +goose Down

DROP TABLE messages;
DROP TABLE room_members;
DROP TABLE rooms;
