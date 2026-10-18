-- システムメッセージ（参加・退出・作成・名前の変更をチャンネルのログに残す。ADR 0033）

-- +goose Up

-- kind は列挙値ではなく text + CHECK にする（CLAUDE.md「DB / SQL」）。
ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'system'));
ALTER TABLE messages ADD COLUMN system_type text CHECK (
    system_type IN ('room_created', 'member_joined', 'member_left', 'member_removed', 'room_renamed')
);
-- system_data は system_type ごとに要る値だけを入れる。いまは room_renamed の old_name / new_name だけ。
ALTER TABLE messages ADD COLUMN system_data jsonb;
ALTER TABLE messages ADD CONSTRAINT messages_system_fields_check CHECK (
    (kind = 'user' AND system_type IS NULL AND system_data IS NULL) OR (kind = 'system' AND system_type IS NOT NULL)
);

-- 人の発言だけを数えた番号。未読数をシステムメッセージ抜きで O(1) に求める（ADR 0033）。
-- 順序と表示は seq、未読数は user_seq と役割を分ける。system の行は直前の user_seq をそのまま持つ（増えない）。
ALTER TABLE rooms ADD COLUMN last_user_seq bigint NOT NULL DEFAULT 0 CHECK (last_user_seq >= 0);
ALTER TABLE room_members ADD COLUMN last_read_user_seq bigint NOT NULL DEFAULT 0 CHECK (last_read_user_seq >= 0);
-- DEFAULT を付けないのは、採番の書き忘れを INSERT のエラーとして検出するため（change_seq と同じ）。
ALTER TABLE messages ADD COLUMN user_seq bigint CHECK (user_seq >= 0);

-- 既存の行はすべて人の発言なので、ルームごとに seq の順で数え直す。
UPDATE messages m
   SET user_seq = numbered.user_seq
  FROM (SELECT id, row_number() OVER (PARTITION BY room_id ORDER BY seq) AS user_seq FROM messages) AS numbered
 WHERE m.id = numbered.id;
ALTER TABLE messages ALTER COLUMN user_seq SET NOT NULL;

UPDATE rooms r SET last_user_seq = (SELECT count(*) FROM messages m WHERE m.room_id = r.id);
UPDATE room_members rm
   SET last_read_user_seq = COALESCE(
       (SELECT max(m.user_seq) FROM messages m WHERE m.room_id = rm.room_id AND m.seq <= rm.last_read_seq), 0);

-- +goose Down

ALTER TABLE messages DROP CONSTRAINT messages_system_fields_check;
ALTER TABLE messages DROP COLUMN user_seq;
ALTER TABLE messages DROP COLUMN system_data;
ALTER TABLE messages DROP COLUMN system_type;
ALTER TABLE messages DROP COLUMN kind;
ALTER TABLE room_members DROP COLUMN last_read_user_seq;
ALTER TABLE rooms DROP COLUMN last_user_seq;
