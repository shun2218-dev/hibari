-- 添付ファイル: ファイル名と、検証済み・削除待ちの状態（ADR 0013）
--
-- 00004 を書き換えずに足すのは、すでに 00004 を適用した環境（ローカルの DB）でもそのまま up できるようにするため。

-- +goose Up

-- 画面にファイル名を表示し、ダウンロード時の Content-Disposition にも使う。オブジェクトキーには入れない。
ALTER TABLE attachments ADD COLUMN file_name text NOT NULL;

--   pending  : URL を発行した。まだ検証していない
--   uploaded : complete で HEAD の結果を検証した。メッセージに付けられる
--   attached : メッセージに付いている
--   deleted  : メッセージが削除された。掃除ジョブがオブジェクトと行を消す
ALTER TABLE attachments DROP CONSTRAINT attachments_status_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_status_check
    CHECK (status IN ('pending', 'uploaded', 'attached', 'deleted'));
-- deleted もどのメッセージの添付だったかを残す（掃除までの間の調査用）。
ALTER TABLE attachments DROP CONSTRAINT attachments_status_message;
ALTER TABLE attachments ADD CONSTRAINT attachments_status_message
    CHECK ((status IN ('attached', 'deleted')) = (message_id IS NOT NULL));
-- 寸法は画像のプレビューの枠に使うので、片方だけでは意味がない。
ALTER TABLE attachments ADD CONSTRAINT attachments_dimensions
    CHECK ((width IS NULL) = (height IS NULL));

-- 掃除ジョブ用。attached（大多数）を含めないので、走査は消す対象の件数だけに比例する。
CREATE INDEX attachments_cleanup_idx ON attachments (created_at) WHERE status <> 'attached';

-- +goose Down

DROP INDEX attachments_cleanup_idx;
ALTER TABLE attachments DROP CONSTRAINT attachments_dimensions;
-- 戻した後の制約を満たさない行は、戻す前に消す（ストレージのオブジェクトは残る）。
DELETE FROM attachments WHERE status IN ('uploaded', 'deleted');
ALTER TABLE attachments DROP CONSTRAINT attachments_status_message;
ALTER TABLE attachments ADD CONSTRAINT attachments_status_message
    CHECK ((status = 'attached') = (message_id IS NOT NULL));
ALTER TABLE attachments DROP CONSTRAINT attachments_status_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_status_check
    CHECK (status IN ('pending', 'attached'));
ALTER TABLE attachments DROP COLUMN file_name;
