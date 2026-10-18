-- 絵文字のリアクション（ADR 0044）。
-- 行 1 つが「誰がどのメッセージにどの絵文字を付けたか」。件数の列は持たない（message_mentions と同じ理由。ADR 0041）。
-- カウンタにすると、付け外しが同時に来たときに取り合い、1 回ずれると二度と直らない。
-- 行を積んでおけば、数はいつでも数え直して正しい値を作れる。

-- +goose Up

CREATE TABLE message_reactions (
    room_id    uuid        NOT NULL,
    message_id uuid        NOT NULL,
    user_id    uuid        NOT NULL,
    -- Unicode の絵文字そのもの（カスタム絵文字は作らない）。正規化はせず、クライアントが出す形のまま保存する。
    -- 異体字セレクタの有無（❤ と ❤️）は別の行になる（ADR 0044 決定 5）。
    emoji      text        NOT NULL,
    created_at timestamptz NOT NULL,

    -- 二重に付けられないことと、付け外しの冪等性を主キーで保証する。アプリ側の「すでに付いているか」の確認は要らない。
    PRIMARY KEY (message_id, user_id, emoji),
    CONSTRAINT message_reactions_message_fkey FOREIGN KEY (room_id, message_id)
        REFERENCES messages (room_id, id) ON DELETE CASCADE,
    -- ルームを抜けた・外された人のリアクションは DB が消す（thread_members / message_mentions と同じ）。
    -- 読めないルームのリアクションが数に残らないことを、アプリのコードに頼らずに保証する。
    CONSTRAINT message_reactions_room_member_fkey FOREIGN KEY (room_id, user_id)
        REFERENCES room_members (room_id, user_id) ON DELETE CASCADE
);
-- 集計（絵文字ごとの数と、最初に付いた順の先頭 8 人）の入口。並びの根拠が created_at なので、索引にも入れる。
CREATE INDEX message_reactions_message_id_created_at_idx ON message_reactions (message_id, created_at);
-- room_members の CASCADE と、ルームを抜けるときの削除の検索。主キーの先頭が message_id なので別に張る。
CREATE INDEX message_reactions_room_id_user_id_idx ON message_reactions (room_id, user_id);

-- +goose Down

DROP TABLE message_reactions;
