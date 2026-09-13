package db_test

import (
	"context"
	"crypto/rand"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/db"
	"github.com/shun2218-dev/hibari/internal/platform/id"
	"github.com/shun2218-dev/hibari/internal/platform/testenv"
)

func TestULIDRoundTrip(t *testing.T) {
	ctx := t.Context()
	pool, err := db.Open(ctx, testenv.DatabaseURL(t))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(pool.Close)

	gen := id.NewGenerator(clock.NewFake(time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)), rand.Reader)
	want := gen.New()

	// 既定のモードに加え、パラメータの型を DB に問い合わせず Go の型から推測するモードでも確かめる。
	// 後者は PgBouncer の transaction モードなどで使うことになる。
	modes := []pgx.QueryExecMode{pgx.QueryExecModeCacheStatement, pgx.QueryExecModeExec, pgx.QueryExecModeSimpleProtocol}
	for _, mode := range modes {
		t.Run(mode.String(), func(t *testing.T) {
			t.Run("scalar", func(t *testing.T) {
				var got ulid.ULID
				if err := pool.QueryRow(ctx, "SELECT $1::uuid", mode, want).Scan(&got); err != nil {
					t.Fatalf("scan: %v", err)
				}
				if got != want {
					t.Fatalf("got %s, want %s", got, want)
				}
			})

			t.Run("stored bytes are the ULID bytes", func(t *testing.T) {
				// psql で見える UUID 表記と ULID のバイト列が一致していること（ADR 0005 のデバッグ用変換の前提）。
				var raw []byte
				if err := pool.QueryRow(ctx, "SELECT uuid_send($1::uuid)", mode, want).Scan(&raw); err != nil {
					t.Fatalf("scan: %v", err)
				}
				if [16]byte(raw) != [16]byte(want) {
					t.Fatalf("stored bytes = %x, want %x", raw, want[:])
				}
			})

			t.Run("nullable", func(t *testing.T) {
				var got *ulid.ULID
				if err := pool.QueryRow(ctx, "SELECT NULL::uuid", mode).Scan(&got); err != nil {
					t.Fatalf("scan NULL: %v", err)
				}
				if got != nil {
					t.Fatalf("got %s, want nil", got)
				}

				var in *ulid.ULID
				var isNull bool
				if err := pool.QueryRow(ctx, "SELECT $1::uuid IS NULL", mode, in).Scan(&isNull); err != nil {
					t.Fatalf("encode nil: %v", err)
				}
				if !isNull {
					t.Fatal("nil *ulid.ULID should be encoded as NULL")
				}

				if err := pool.QueryRow(ctx, "SELECT $1::uuid", mode, &want).Scan(&got); err != nil {
					t.Fatalf("scan non-NULL into pointer: %v", err)
				}
				if got == nil || *got != want {
					t.Fatalf("got %v, want %s", got, want)
				}
			})

			t.Run("array", func(t *testing.T) {
				in := []ulid.ULID{want, gen.New()}
				var got []ulid.ULID
				if err := pool.QueryRow(ctx, "SELECT $1::uuid[]", mode, in).Scan(&got); err != nil {
					t.Fatalf("scan array: %v", err)
				}
				if len(got) != len(in) || got[0] != in[0] || got[1] != in[1] {
					t.Fatalf("got %v, want %v", got, in)
				}
			})
		})
	}

	t.Run("NULL into non-pointer is an error", func(t *testing.T) {
		var got ulid.ULID
		err := pool.QueryRow(ctx, "SELECT NULL::uuid").Scan(&got)
		if err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestOpenFailsFast(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()

	// 到達できない接続先なら、プールを返さずにエラーにする。
	_, err := db.Open(ctx, "postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable&connect_timeout=1")
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("should fail by connection refusal, not by test timeout: %v", err)
	}
}
