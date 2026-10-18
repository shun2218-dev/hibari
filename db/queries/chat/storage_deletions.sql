-- ストレージのオブジェクトの掃除の列（ADR 0059 決定 6）。

-- name: LockDueStorageDeletions :many
-- not_before を過ぎた行を古い順に行ロックして取る。SKIP LOCKED で、複数台が同時に実行しても同じ行を取り合わない（添付の掃除と同じ）。
SELECT object_key
  FROM storage_deletions
 WHERE not_before <= sqlc.arg(now)::timestamptz
 ORDER BY not_before
 LIMIT sqlc.arg(max_rows)
   FOR UPDATE SKIP LOCKED;

-- name: DeleteStorageDeletions :exec
DELETE FROM storage_deletions
 WHERE object_key = ANY(sqlc.arg(object_keys)::text[]);
