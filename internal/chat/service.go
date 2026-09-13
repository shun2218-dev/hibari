package chat

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/platform/clock"
	"github.com/shun2218-dev/hibari/internal/platform/id"
)

// Deps は Service の依存。
type Deps struct {
	DB     *pgxpool.Pool
	Clock  clock.Clock
	IDs    id.Generator
	Random io.Reader
	Logger *slog.Logger
	// Storage は添付ファイルを置くオブジェクトストレージ。
	Storage          Storage
	AttachmentLimits AttachmentLimits
	// Delivery はコミット済みの変更を配信する（ADR 0015）。
	Delivery Delivery
	// Presence はユーザーがオンラインかを読む。REST で presence の初期値を返すのに使う（ADR 0015）。
	Presence PresenceReader
}

// PresenceReader は presence（Redis に TTL 付きで置く。CLAUDE.md ルール 5）を読む。
type PresenceReader interface {
	// Online は userIDs のうちオンラインのユーザーを返す。
	Online(ctx context.Context, userIDs []ulid.ULID) (map[ulid.ULID]bool, error)
}

// Service はチャットのユースケース。
type Service struct {
	db     *pgxpool.Pool
	clock  clock.Clock
	ids    id.Generator
	random io.Reader
	logger *slog.Logger

	storage          Storage
	attachmentLimits AttachmentLimits
	delivery         Delivery
	presence         PresenceReader
}

// NewService は Service を返す。
func NewService(d Deps) *Service {
	return &Service{
		db:     d.DB,
		clock:  d.Clock,
		ids:    d.IDs,
		random: d.Random,
		logger: d.Logger,

		storage:          d.Storage,
		attachmentLimits: d.AttachmentLimits,
		delivery:         d.Delivery,
		presence:         d.Presence,
	}
}

// inTx は fn をトランザクションの中で実行し、エラーがなければコミットする。
func (s *Service) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer rollback(ctx, tx)
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// rollback はコミットしなかったトランザクションを戻す。コミット後に呼んでも何もしない（defer で使う）。
func rollback(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(context.WithoutCancel(ctx))
}

// notFoundIfNoRows は行がないことを ErrNotFound に変える。
func notFoundIfNoRows(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return fmt.Errorf("%s: %w", what, err)
}
