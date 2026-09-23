-- メッセージの検索（ADR 0061）。

-- +goose Up

-- 2-gram の索引を提供する拡張。イメージに同梱してある（db/postgres/Dockerfile）。
-- shared_preload_libraries は要らない。
CREATE EXTENSION IF NOT EXISTS pg_bigm;

-- 検索は「正規化した本文」に対して LIKE で引き、その式に索引を張る（ADR 0061 決定 2）。
--
--   - lower(): 素の pg_bigm は ILIKE で索引が使えない（計画が Seq Scan になる）ので、両側を小文字にしてから LIKE で引く
--   - normalize(..., NFKC): 全角で打った `ｄｅｐｌｏｙ` を半角の `deploy` に当てる。半角カナも全角にそろう
--     normalize は IMMUTABLE（PostgreSQL 13 以降の組み込み）なので式索引に使える
--
-- 検索する側も、同じ式（lower(normalize(q, NFKC))）を検索語に通すこと。片方だけだと索引が使われない。
--
-- 部分索引にして、検索の対象でない行を最初から入れない。
--   - deleted_at IS NOT NULL: 削除済みは結果に出さない
--   - kind = 'system': 参加や名前の変更のログは人の発言ではない（ADR 0033）
CREATE INDEX messages_body_search_idx ON messages
    USING gin (lower(normalize(body, NFKC)) gin_bigm_ops)
    WHERE deleted_at IS NULL AND kind = 'user';

-- +goose Down

DROP INDEX messages_body_search_idx;
DROP EXTENSION pg_bigm;
