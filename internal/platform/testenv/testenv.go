// Package testenv は、統合テストが使う実物の Postgres / Redis の接続先を返す。
//
// DB を使う処理はモックにせず実物でテストする（CLAUDE.md「テスト」）。
// 接続先がない環境（ホストで素の `go test` を実行した場合など）ではスキップするが、
// CI では環境変数の設定漏れで「全部スキップされて緑」にならないよう失敗させる。
package testenv

import (
	"os"
	"testing"
)

// DatabaseURL は統合テスト用の Postgres の URL を返す。
func DatabaseURL(t testing.TB) string {
	t.Helper()
	return lookup(t, "TEST_DATABASE_URL")
}

// RedisURL は統合テスト用の Redis の URL を返す。
func RedisURL(t testing.TB) string {
	t.Helper()
	return lookup(t, "TEST_REDIS_URL")
}

// S3Env は統合テスト用の S3 API（MinIO）の接続先。バケットは compose の minio-init（CI では workflow）が作る。
type S3Env struct {
	Endpoint        string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
}

// S3 は統合テスト用の S3 API の接続先を返す。
func S3(t testing.TB) S3Env {
	t.Helper()
	return S3Env{
		Endpoint:        lookup(t, "TEST_S3_ENDPOINT"),
		Bucket:          lookup(t, "TEST_S3_BUCKET"),
		AccessKeyID:     lookup(t, "TEST_S3_ACCESS_KEY_ID"),
		SecretAccessKey: lookup(t, "TEST_S3_SECRET_ACCESS_KEY"),
	}
}

func lookup(t testing.TB, key string) string {
	t.Helper()
	if v := os.Getenv(key); v != "" {
		return v
	}
	if os.Getenv("CI") != "" {
		t.Fatalf("%s is not set (CI では統合テストをスキップしない)", key)
	}
	t.Skipf("%s is not set; `make test` でコンテナ内から実行する", key)
	return ""
}
