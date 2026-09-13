-- ワークスペースドメイン: workspaces / workspace_members / workspace_invites（ADR 0006）

-- +goose Up

CREATE TABLE workspaces (
    id            uuid        PRIMARY KEY,
    slug          citext      NOT NULL,
    name          text        NOT NULL,
    invite_policy text        NOT NULL DEFAULT 'admins_only'
                              CHECK (invite_policy IN ('admins_only', 'all_members')),
    created_by    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at    timestamptz NOT NULL,
    updated_at    timestamptz NOT NULL,
    deleted_at    timestamptz,

    CONSTRAINT workspaces_slug_key UNIQUE (slug)
);

CREATE TABLE workspace_members (
    workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role         text        NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    -- 退出したら行を削除する（在籍期間の履歴は持たない）。
    joined_at    timestamptz NOT NULL,

    PRIMARY KEY (workspace_id, user_id)
);
-- 「自分が所属するワークスペース一覧」に使う。主キーは workspace_id が先頭なので使えない。
CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);
-- owner はワークスペースに常に 1 人。アプリのチェックだけだと、並行した譲渡で 2 人になりうるので DB で保証する。
-- 部分 UNIQUE インデックスは遅延評価できないので、譲渡は「旧 owner を admin に降格 → 新 owner を昇格」の順に行う。
CREATE UNIQUE INDEX workspace_members_one_owner_idx ON workspace_members (workspace_id) WHERE role = 'owner';

CREATE TABLE workspace_invites (
    id           uuid        PRIMARY KEY,
    workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    -- SHA-256 の 32 バイト。生のコードは作成時に 1 度だけ返し、保存しない。
    code_hash    bytea       NOT NULL CHECK (octet_length(code_hash) = 32),
    created_by   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- NULL なら無制限。
    max_uses     integer     CHECK (max_uses > 0),
    use_count    integer     NOT NULL DEFAULT 0,
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL,

    CONSTRAINT workspace_invites_code_hash_key UNIQUE (code_hash),
    -- 使用回数の加算は条件付き UPDATE で行う。条件を書き間違えても上限を超えないよう、DB でも保証する。
    CONSTRAINT workspace_invites_use_count_range CHECK (use_count >= 0 AND (max_uses IS NULL OR use_count <= max_uses))
);
CREATE INDEX workspace_invites_workspace_id_idx ON workspace_invites (workspace_id);

-- +goose Down

DROP TABLE workspace_invites;
DROP TABLE workspace_members;
DROP TABLE workspaces;
