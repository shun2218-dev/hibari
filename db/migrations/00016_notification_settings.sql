-- ミュートと通知の設定（ADR 0055）。
--
-- どれも本人が選んだ設定なので Postgres に置く（CLAUDE.md ルール 5）。未読数とメンションの件数はこの設定で変えない（決定 1）。
-- 変えるのは見せ方（サイドバーの薄い表示）と、6.14b のブラウザ通知を出すかどうかだけ。

-- +goose Up

-- 全体の「通知する内容」はワークスペースごと（決定 2）。カスタムステータス（00013）と同じく、
-- 主キーがすでに「ワークスペース × ユーザー」の workspace_members に列を足す。NULL は未設定で、読む側が mentions にする。
ALTER TABLE workspace_members
    ADD COLUMN notify_level text CHECK (notify_level IN ('all', 'mentions', 'none'));

-- チャンネルごとの上書きとミュート（決定 3）。ルームを抜けると行ごと消えるので、入り直したら既定に戻る。
ALTER TABLE room_members
    -- NULL は「全体の設定に従う」。DM では使わない（サービスが 422 で拒む）。none を持たないのは、止めたいならミュートするため。
    ADD COLUMN notify_level text CHECK (notify_level IN ('all', 'mentions')),
    ADD COLUMN muted        boolean NOT NULL DEFAULT false,
    -- muted_until は Phase 2 のスキーマから列だけあった（どこからも書いていない）。期限つきのミュートの期限にする。
    -- 期限の来た行は、読むときに Clock で落とす（掃除のジョブは作らない）。
    ADD CONSTRAINT room_members_muted_until_check CHECK (muted OR muted_until IS NULL);

-- +goose Down

ALTER TABLE room_members
    DROP CONSTRAINT room_members_muted_until_check,
    DROP COLUMN muted,
    DROP COLUMN notify_level;

ALTER TABLE workspace_members DROP COLUMN notify_level;
