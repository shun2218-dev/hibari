// Package redis は Redis クライアントを組み立てる。
//
// Redis に置くのは失われても再構築できるものだけ（Pub/Sub、presence、typing、ws-ticket、レート制限）。
// 正は常に Postgres にある（CLAUDE.md ルール 4・5）。
package redis

import (
	"context"
	"fmt"

	goredis "github.com/redis/go-redis/v9"
)

// Open はクライアントを作り、疎通を確認してから返す。
func Open(ctx context.Context, redisURL string) (*goredis.Client, error) {
	opts, err := goredis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	client := goredis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return client, nil
}
