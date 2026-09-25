-- 外部のリンクのプレビュー（ADR 0065）。

-- +goose Up

-- URL ごとの取得の結果（決定 2）。30 分以内の同じ URL はこれを使い回す（入力欄の API と、投稿の後の取得の両方）。
-- 失敗も 30 分覚える（OGP のないページを入力欄と送信で 2 回取りに行かない）。
-- 行を持つのは URL で、「消した」はメッセージの側（message_link_previews）に持つ。持ち主が違うので表を分ける。
CREATE TABLE link_previews (
    id                 uuid        PRIMARY KEY,
    url                text        NOT NULL,
    status             text        NOT NULL CHECK (status IN ('ok', 'failed')),
    title              text        NOT NULL DEFAULT '',
    description        text        NOT NULL DEFAULT '',
    site_name          text        NOT NULL DEFAULT '',
    -- 画像とアイコンは取得したときに自前のストレージへ写す（決定 7・14）。キーに URL もファイル名も入れない。
    image_object_key   text        UNIQUE,
    image_content_type text,
    image_width        int,
    image_height       int,
    icon_object_key    text        UNIQUE,
    icon_content_type  text,
    fetched_at         timestamptz NOT NULL,
    CHECK ((image_object_key IS NULL) = (image_content_type IS NULL)
       AND (image_object_key IS NULL) = (image_width IS NULL)
       AND (image_object_key IS NULL) = (image_height IS NULL)),
    CHECK ((icon_object_key IS NULL) = (icon_content_type IS NULL)),
    -- 失敗した行は中身を持たない
    CHECK (status = 'ok' OR (image_object_key IS NULL AND icon_object_key IS NULL))
);
-- 「この URL の 30 分以内の結果」を新しい順に引く
CREATE INDEX link_previews_url_fetched_at_idx ON link_previews (url, fetched_at DESC);
-- 掃除のジョブが古いものから見る
CREATE INDEX link_previews_fetched_at_idx ON link_previews (fetched_at);

-- メッセージに付いたプレビュー（決定 1）。本文の URL ごとに 1 行。
-- 送信・編集のトランザクションで pending の行を作り、取得のジョブが ok / failed にする。
-- 本人が消したら removed_at を立てる。行は消さないので、編集で同じ URL を書き戻しても出ない（決定 4）。
CREATE TABLE message_link_previews (
    id              uuid        PRIMARY KEY,
    room_id         uuid        NOT NULL,
    message_id      uuid        NOT NULL,
    url             text        NOT NULL,
    -- 本文に出てきた順（0 から）
    position        int         NOT NULL,
    status          text        NOT NULL CHECK (status IN ('pending', 'ok', 'failed')),
    -- 同じ取得の結果を複数のメッセージが指すので、URL の行を先に消せないようにする（掃除は参照のない行だけを消す）
    link_preview_id uuid        REFERENCES link_previews (id) ON DELETE RESTRICT,
    -- 取得を試みた回数。ジョブが落ちて拾い直すたびに増える。上限を超えたら failed にする
    attempts        int         NOT NULL DEFAULT 0,
    -- 取得のジョブが取っている間。過ぎたら拾い直す（ジョブが途中で落ちたとき）
    claimed_until   timestamptz,
    removed_at      timestamptz,
    created_at      timestamptz NOT NULL,
    -- メッセージの行が消えたら（ルームの削除）一緒に消える。論理削除では、削除のトランザクションで消す
    FOREIGN KEY (room_id, message_id) REFERENCES messages (room_id, id) ON DELETE CASCADE,
    UNIQUE (message_id, url),
    CHECK ((status = 'ok') = (link_preview_id IS NOT NULL))
);
-- 取得のジョブが取得待ちを古い順に拾う
CREATE INDEX message_link_previews_pending_idx ON message_link_previews (created_at)
    WHERE status = 'pending' AND removed_at IS NULL;
-- 掃除のジョブが「参照のない link_previews」を探す
CREATE INDEX message_link_previews_link_preview_id_idx ON message_link_previews (link_preview_id);

-- +goose Down

DROP TABLE message_link_previews;
DROP TABLE link_previews;
