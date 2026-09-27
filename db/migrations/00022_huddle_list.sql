-- ハドルの一覧と提案のカード（ADR 0067 決定 6・7）。テーブルは増やさず、引くための索引だけを足す。

-- +goose Up

-- 自分が入ったハドルを新しい順に引く（一覧の「すべて」「参加しなかった」の判定と、提案のカード）。
-- 主キーは (huddle_id, user_id) で、ユーザーからは引けない。
CREATE INDEX huddle_participants_user_idx ON huddle_participants (user_id, huddle_id DESC);

-- メンバーのルームのハドルを新しい順に引く（一覧）。いまあるのは進行中の部分索引（room_id）だけ。
-- ハドルの ID は始めたときの ULID なので、ID の降順が始めた時刻の新しい順になる。
CREATE INDEX huddles_room_idx ON huddles (room_id, id DESC);

-- +goose Down

DROP INDEX huddles_room_idx;
DROP INDEX huddle_participants_user_idx;
