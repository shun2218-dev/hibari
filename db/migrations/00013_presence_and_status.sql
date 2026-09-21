-- 離席とカスタムステータス（ADR 0049）。
--
-- 自動で決まる presence（接続の有無と、その接続が画面を見ているか）は今までどおり Redis の TTL だけで持つ。
-- ここに置くのは**本人が選んだ設定**だけで、再起動や Redis のデータが消えても残らなければ困るもの（CLAUDE.md ルール 5）。
--
-- 手動の離席は人の状態なのでユーザーごと、カスタムステータスは Slack と同じくワークスペースごとにする。

-- +goose Up

-- 本人が固定した離席。行が無ければ false（設定したときだけ行を作る）。
CREATE TABLE user_presence_settings (
    user_id     uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    manual_away boolean     NOT NULL,
    updated_at  timestamptz NOT NULL
);

-- カスタムステータスは workspace_members の列にする。主キーがすでに「ワークスペース × ユーザー」で、
-- メンバー一覧と同じクエリで一緒に読める（N+1 にしない）。ワークスペースを抜ければ行ごと消えるので後始末も要らない。
ALTER TABLE workspace_members
    -- 絵文字は必須、文言は任意（文言だけのときは、クライアントが既定の絵文字を入れて送る）。
    ADD COLUMN status_emoji      text,
    ADD COLUMN status_text       text,
    -- NULL なら消えない。過ぎたステータスは読むときに落とす（掃除のジョブは作らない。ADR 0049 決定 6）。
    ADD COLUMN status_expires_at timestamptz,
    -- 「絵文字なしの文言」「絵文字なしの期限」という、画面に出せない組み合わせを DB で拒む。
    ADD CONSTRAINT workspace_members_status_check
        CHECK (status_emoji IS NOT NULL OR (status_text IS NULL AND status_expires_at IS NULL));

-- +goose Down

ALTER TABLE workspace_members
    DROP CONSTRAINT workspace_members_status_check,
    DROP COLUMN status_expires_at,
    DROP COLUMN status_text,
    DROP COLUMN status_emoji;

DROP TABLE user_presence_settings;
