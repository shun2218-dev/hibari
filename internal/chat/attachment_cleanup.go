package chat

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/oklog/ulid/v2"

	"github.com/shun2218-dev/hibari/internal/chat/store"
)

// アップロードされないまま残った添付と、消したオブジェクトの後片付け（ADR 0013）。
// リクエストの処理ではなく、サーバーが動いている間ずっと回る常駐のジョブ。

// CleanupAttachments は、メッセージに付かないまま attachmentRetention を過ぎた添付と、削除されたメッセージの添付を、
// ストレージのオブジェクトと行ごと消す。続けて、削除したルームの添付のオブジェクト（storage_deletions。ADR 0059 決定 6）も消す。
// 消したオブジェクトの件数を返す。
//
// 対象がなくなるまで、cleanupBatchSize 件ずつのトランザクションを繰り返す。行は FOR UPDATE SKIP LOCKED で取るので、
// 複数台で同時に実行しても同じ行を取り合わない（ロードマップ Phase 3c / Phase 5）。
func (s *Service) CleanupAttachments(ctx context.Context) (int, error) {
	total := 0
	for _, batch := range []func(context.Context) (int, error){s.cleanupAttachmentBatch, s.cleanupStorageDeletionBatch} {
		for {
			n, err := batch(ctx)
			total += n
			if err != nil {
				return total, err
			}
			if n < cleanupBatchSize {
				break
			}
		}
	}
	return total, nil
}

// cleanupStorageDeletionBatch は、猶予を過ぎた storage_deletions の行のオブジェクトを消してから行を消す。
// 失敗したらロールバックして、次の実行でやり直す（添付の掃除と同じ。S3 の DELETE は冪等）。
func (s *Service) cleanupStorageDeletionBatch(ctx context.Context) (int, error) {
	var n int
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		keys, err := q.LockDueStorageDeletions(ctx, store.LockDueStorageDeletionsParams{Now: s.clock.Now(), MaxRows: cleanupBatchSize})
		if err != nil {
			return fmt.Errorf("lock storage deletions: %w", err)
		}
		for _, key := range keys {
			if err := s.storage.Delete(ctx, key); err != nil {
				return fmt.Errorf("delete object: %w", err)
			}
		}
		if len(keys) > 0 {
			if err := q.DeleteStorageDeletions(ctx, keys); err != nil {
				return fmt.Errorf("delete storage deletions: %w", err)
			}
		}
		n = len(keys)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return n, nil
}

func (s *Service) cleanupAttachmentBatch(ctx context.Context) (int, error) {
	var n int
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q := store.New(tx)
		rows, err := q.LockAttachmentsForCleanup(ctx, store.LockAttachmentsForCleanupParams{
			StaleBefore: s.clock.Now().Add(-attachmentRetention),
			MaxRows:     cleanupBatchSize,
		})
		if err != nil {
			return fmt.Errorf("lock attachments for cleanup: %w", err)
		}
		ids := make([]ulid.ULID, len(rows))
		for i, r := range rows {
			// オブジェクトを先に消す。消せなければロールバックして、次の実行でやり直す。
			// 消した後にコミットが失敗しても、行が残るので次の実行でもう一度消す（S3 の DELETE は冪等）。
			if err := s.storage.Delete(ctx, r.ObjectKey); err != nil {
				return fmt.Errorf("delete attachment object: %w", err)
			}
			ids[i] = r.ID
		}
		if len(ids) > 0 {
			if err := q.DeleteAttachments(ctx, ids); err != nil {
				return fmt.Errorf("delete attachments: %w", err)
			}
		}
		n = len(rows)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return n, nil
}

// RunAttachmentCleanup は、ctx がキャンセルされるまで interval ごとに CleanupAttachments を実行する。
// 失敗はログに残して次の実行を待つ（掃除が遅れてもユーザーの操作は失敗しない）。
//
// 起動直後には実行しない。開発中は air がソースの変更のたびにサーバーを再起動するので、そのたびに走らせても意味がない。
// また、サーバーを起動する統合テストが、共有のテスト用 DB にあるほかのテストの添付を消さないようにするため。
func (s *Service) RunAttachmentCleanup(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		n, err := s.CleanupAttachments(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			s.logger.ErrorContext(ctx, "attachment cleanup failed", slog.Int("deleted", n), slog.Any("error", err))
		case n > 0:
			s.logger.InfoContext(ctx, "attachment cleanup", slog.Int("deleted", n))
		}
	}
}
