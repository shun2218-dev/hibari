-- メンション（ADR 0041）。
-- 行 1 つが「この本文にあるメンション 1 件」。件数を数えるためだけに持ち、表示には使わない（表示はサーバーが本文から作る）。
-- カウンタの列を持たないのは、@channel で全員の行を増やすと同時送信どうしが取り合い、
-- 減らす側（編集・削除）を 1 回でも間違えると二度と 0 に戻らないバッジが残るため。
-- 行を積んでおけば、件数は「既読位置より後の行の数」として未読と同じ物差しから導ける。

-- +goose Up

CREATE TABLE message_mentions (
    room_id    uuid        NOT NULL,
    message_id uuid        NOT NULL,
    -- NULL は「ルームの全員」（@channel）。@channel がルームの人数によらず 1 行で済むのは、この NULL のおかげ。
    -- @here は送った瞬間にオンラインだった人に解決するので、1 人 1 行になる。
    user_id    uuid,
    -- 数え方には使わない（宛先の広さは user_id だけで表す）。表示と、後から使える人を絞るときのために持つ。
    kind       text        NOT NULL CHECK (kind IN ('user', 'channel', 'here')),
    created_at timestamptz NOT NULL,

    CONSTRAINT message_mentions_message_fkey FOREIGN KEY (room_id, message_id)
        REFERENCES messages (room_id, id) ON DELETE CASCADE,
    -- ルームを抜けた・外された・ワークスペースから外れた人の行は DB が消す（thread_members と同じ。ADR 0036）。
    -- 読めないルームのメンションが件数に残らないことを、アプリのコードに頼らずに保証する。
    CONSTRAINT message_mentions_room_member_fkey FOREIGN KEY (room_id, user_id)
        REFERENCES room_members (room_id, user_id) ON DELETE CASCADE,
    -- @channel の行だけが user_id を持たない。取り違えを DB で止める。
    CONSTRAINT message_mentions_kind_target_check CHECK ((kind = 'channel') = (user_id IS NULL))
);
-- 同じ本文で同じ人を 2 回メンションしても 1 件。NULL は UNIQUE 制約で重複を防げないので、2 本に分ける。
CREATE UNIQUE INDEX message_mentions_message_id_user_id_idx ON message_mentions (message_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX message_mentions_message_id_channel_idx ON message_mentions (message_id) WHERE user_id IS NULL;
-- 件数を数えるとき（ルームごと・自分宛て）の入口。@channel の行も NULL として並ぶので、同じインデックスで拾える。
CREATE INDEX message_mentions_room_id_user_id_idx ON message_mentions (room_id, user_id);
-- 本文を作り直すときの DELETE と、messages を消すときの CASCADE の検索。
-- 上の部分インデックスは行の一部しか覆わないので、全部の行を 1 本で引けるものを別に張る。
CREATE INDEX message_mentions_room_id_message_id_idx ON message_mentions (room_id, message_id);

-- +goose Down

DROP TABLE message_mentions;
