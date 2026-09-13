// Package db は Postgres への接続（pgx v5 のプール）を組み立てる。
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Open は接続プールを作り、疎通を確認してから返す。
// 起動時に DB へ到達できないなら、リクエストを受け始める前に落とす。
func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	// 型の登録は接続ごとに必要。プールが新しい接続を作るたびに呼ばれる。
	cfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		RegisterTypes(conn.TypeMap())
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}
