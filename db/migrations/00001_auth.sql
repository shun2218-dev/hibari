-- 認証ドメイン: users / oauth_accounts / devices / refresh_tokens / one_time_tokens
--
-- このスキーマ全体の方針（以降のマイグレーションも同じ）
-- - ID は uuid 型で、アプリが生成した ULID を入れる。DEFAULT gen_random_uuid() は付けない（ADR 0005）。
-- - 時刻は timestamptz。DEFAULT now() は付けず、アプリが Clock の時刻を入れる（テストで時刻を固定するため）。
-- - 列挙値は enum 型ではなく text + CHECK（値の追加・削除が ALTER TYPE より楽なため）。
-- - users は物理削除しない（退会は deleted_at + 匿名化）。そのため users への FK は
--   「ユーザーに付属するもの（トークン・端末・所属）」は CASCADE、
--   「他人も見る記録（メッセージ・ワークスペース・ルームの作成者など）」は RESTRICT にして、
--   誤って物理削除しようとしたときに記録ごと消えないようにする。

-- +goose Up

-- handle / email の大文字小文字を区別せずに一意にする。lower() の関数インデックスより、
-- 比較のたびに lower() を書き忘れる余地がない citext を選ぶ。
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id                uuid        PRIMARY KEY,
    handle            citext      NOT NULL,
    display_name      text        NOT NULL,
    -- OAuth だけで登録したユーザーでも必須にする（連絡・パスワードリセットの手段を 1 つに揃える）。
    email             citext      NOT NULL,
    -- NULL なら未検証。未検証の email を根拠に OAuth アカウントを紐付けない（CLAUDE.md）。
    email_verified_at timestamptz,
    -- Argon2id の PHC 文字列。OAuth だけのユーザーは NULL。
    password_hash     text,
    avatar_object_key text,
    created_at        timestamptz NOT NULL,
    updated_at        timestamptz NOT NULL,
    -- 退会。email / handle / display_name は匿名化するので、UNIQUE は退会済みを含めて張ったままでよい。
    deleted_at        timestamptz,

    CONSTRAINT users_handle_key UNIQUE (handle),
    CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE oauth_accounts (
    id                  uuid        PRIMARY KEY,
    user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider            text        NOT NULL CHECK (provider IN ('google', 'github')),
    provider_account_id text        NOT NULL,
    -- プロバイダの API を呼ぶ必要がなければ持たない。持つ場合は暗号化した値だけ。
    refresh_token_enc   text,
    created_at          timestamptz NOT NULL,

    CONSTRAINT oauth_accounts_provider_account_key UNIQUE (provider, provider_account_id)
);
CREATE INDEX oauth_accounts_user_id_idx ON oauth_accounts (user_id);

-- Phase 7 の Push 通知用。器だけ先に作り、refresh_tokens から参照できるようにしておく。
CREATE TABLE devices (
    id           uuid        PRIMARY KEY,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform     text        NOT NULL CHECK (platform IN ('web', 'ios', 'android', 'desktop')),
    push_token   text,
    last_seen_at timestamptz NOT NULL,
    created_at   timestamptz NOT NULL
);
CREATE INDEX devices_user_id_idx ON devices (user_id);

CREATE TABLE refresh_tokens (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- 端末の登録を消してもセッションの監査記録は残す。
    device_id      uuid        REFERENCES devices (id) ON DELETE SET NULL,
    -- ローテーションのチェーン ID。JWT の sid として使い、失効はこの単位で行う（ADR 0007）。
    family_id      uuid        NOT NULL,
    -- SHA-256 の 32 バイト。長さの CHECK は「生値を入れてしまう」ミスを DB で止めるため。
    token_hash     bytea       NOT NULL CHECK (octet_length(token_hash) = 32),
    -- 監査・デバッグ用。失効は family_id で行うので、チェーンを辿るためには使わない。
    rotated_from   uuid        REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    expires_at     timestamptz NOT NULL,
    revoked_at     timestamptz,
    revoked_reason text        CHECK (revoked_reason IN ('rotated', 'logout', 'reuse_detected', 'password_reset')),
    user_agent     text,
    ip             inet,
    created_at     timestamptz NOT NULL,

    CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash),
    -- 失効日時と理由は必ず揃える（理由のない失効、失効していないのに理由がある、を作らない）。
    CONSTRAINT refresh_tokens_revoked_consistent CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
-- family 単位の一括失効（UPDATE ... WHERE family_id = $1 AND revoked_at IS NULL）に使う。
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
-- パスワードリセットなどでユーザーの全セッションを失効させるときに使う。
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);

CREATE TABLE one_time_tokens (
    id          uuid        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     text        NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
    token_hash  bytea       NOT NULL CHECK (octet_length(token_hash) = 32),
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL,

    CONSTRAINT one_time_tokens_token_hash_key UNIQUE (token_hash)
);
-- 新しいトークンを発行するときに、同じ用途の古いトークンを無効にするために使う。
CREATE INDEX one_time_tokens_user_id_purpose_idx ON one_time_tokens (user_id, purpose);

-- +goose Down

DROP TABLE one_time_tokens;
DROP TABLE refresh_tokens;
DROP TABLE devices;
DROP TABLE oauth_accounts;
DROP TABLE users;
-- citext は他のスキーマが使っている可能性があるので残す。
