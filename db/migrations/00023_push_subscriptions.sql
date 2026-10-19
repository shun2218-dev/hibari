-- プッシュ通知の購読（ADR 0069 決定 3）。使われなかった devices と refresh_tokens.device_id を消し、push_subscriptions に置き換える。
--
-- devices は 00001 で「Phase 7 の Push 用」に器だけ作った。hibari で通知を受ける「端末」はブラウザのセッション（sid）だったので、
-- 端末を表す方法を 2 通りにしないよう消す。どこからも行を作っていないので、消しても失うものはない。

-- +goose Up

ALTER TABLE refresh_tokens DROP COLUMN device_id;
DROP TABLE devices;

CREATE TABLE push_subscriptions (
    id          uuid        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- refresh_tokens.family_id（JWT の sid）。family_id は行ごとに一意でないので外部キーは張れない。
    -- ログアウトでは chat が auth:revoked を受けて消し、取りこぼしは送る直前のセッションの確認で消す（ADR 0007 と同じ二段構え）。
    sid         uuid        NOT NULL,
    -- APNs / FCM を足すときに値を足す（ADR 0069 決定 1）。
    kind        text        NOT NULL CHECK (kind IN ('webpush')),
    -- サーバーが POST する宛先。登録の前に既知のプッシュのサービスの https の URL だけに絞る（webpush.CheckEndpoint）。
    endpoint    text        NOT NULL,
    -- 長さの CHECK は、base64url のまま入れてしまうミスを DB で止めるため（refresh_tokens.token_hash と同じ）。
    p256dh      bytea       NOT NULL CHECK (octet_length(p256dh) = 65),
    auth        bytea       NOT NULL CHECK (octet_length(auth) = 16),
    user_agent  text,
    created_at  timestamptz NOT NULL,

    -- 同じブラウザで別の人がログインし直したら、行をその人に移す（前の人に届き続けないように）。
    CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
    -- 1 つのセッションに購読は 1 つ。同じ sid で別の endpoint を登録したら置き換える。
    CONSTRAINT push_subscriptions_sid_key UNIQUE (sid)
);
-- 自分の購読の一覧と、全セッションの失効（パスワードの再設定）で消すのに使う。
CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- +goose Down

DROP TABLE push_subscriptions;

CREATE TABLE devices (
    id           uuid        PRIMARY KEY,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    platform     text        NOT NULL CHECK (platform IN ('web', 'ios', 'android', 'desktop')),
    push_token   text,
    last_seen_at timestamptz NOT NULL,
    created_at   timestamptz NOT NULL
);
CREATE INDEX devices_user_id_idx ON devices (user_id);

ALTER TABLE refresh_tokens ADD COLUMN device_id uuid REFERENCES devices (id) ON DELETE SET NULL;
