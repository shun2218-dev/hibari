-- 「後で」（自分用の保存。ADR 0054 決定 6・7）。
-- 本人だけの状態なので、ルームの change_seq には乗せず、本人ごと（ワークスペース × ユーザー）の change_seq で同期する。

-- +goose Up

CREATE TABLE saved_messages (
    workspace_id uuid        NOT NULL,
    user_id      uuid        NOT NULL,
    message_id   uuid        NOT NULL,
    room_id      uuid        NOT NULL,
    -- 保存し直すたびに振り直す ULID。一覧の並び（新しい順）とカーソルに使う。
    id           uuid        NOT NULL,
    -- 「外す」は行を消さず removed にする。消すと、切断中の別の端末に「外された」ことを差分で渡せないため（決定 6）。
    state        text        NOT NULL CHECK (state IN ('in_progress', 'archived', 'completed', 'removed')),
    -- 本人ごとの変更番号（workspace_members.last_saved_change_seq から採番）。再接続の差分のカーソル（決定 7）。
    change_seq   bigint      NOT NULL CHECK (change_seq > 0),
    saved_at     timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,

    -- 1 人が同じメッセージを保存する行は 1 つ。保存し直しも同じ行の更新にする。
    PRIMARY KEY (user_id, message_id),
    CONSTRAINT saved_messages_id_key UNIQUE (id),
    -- 差分の取得（change_seq > N を昇順）と、同じ番号の二重使用の防止を兼ねる。
    CONSTRAINT saved_messages_change_seq_key UNIQUE (workspace_id, user_id, change_seq),
    -- ワークスペースから抜けたら、保存も一緒に消える。
    -- ルームから外れても消さない（読むときに authz で伏せる。入り直したら戻る。決定 8）ので、room_members には FK を張らない。
    CONSTRAINT saved_messages_workspace_member_fkey FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE,
    -- メッセージの行が物理的に消えるのは、ルームごと消えるときだけ（論理削除では消えない。Phase 6.15 で扱う）。
    CONSTRAINT saved_messages_message_fkey FOREIGN KEY (room_id, message_id)
        REFERENCES messages (room_id, id) ON DELETE CASCADE
);
-- タブごとの一覧（新しい順）。removed は一覧に出さないが、行数は「一度でも保存したメッセージの数」までなので分けない。
CREATE INDEX saved_messages_list_idx ON saved_messages (workspace_id, user_id, state, id DESC);
-- メッセージの行の CASCADE の検索。主キーの先頭が user_id なので別に張る。
CREATE INDEX saved_messages_room_id_message_id_idx ON saved_messages (room_id, message_id);

-- 本人ごとの保存の変更番号の採番カウンタ兼「最新の番号」。
ALTER TABLE workspace_members
    ADD COLUMN last_saved_change_seq bigint NOT NULL DEFAULT 0 CHECK (last_saved_change_seq >= 0);

-- +goose Down

ALTER TABLE workspace_members DROP COLUMN last_saved_change_seq;
DROP TABLE saved_messages;
