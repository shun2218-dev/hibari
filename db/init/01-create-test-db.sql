-- 統合テスト用の DB。開発用の DB（POSTGRES_DB）とデータを混ぜないために分ける。
-- postgres イメージがボリュームの初回作成時にだけ実行する。
CREATE DATABASE hibari_test;
