-- 添付ファイル（ADR 0008 / 0013）。
--
-- 状態は pending（URL を発行した）→ uploaded（HEAD で検証した）→ attached（メッセージに付いた）→ deleted（メッセージが削除された）。
-- 状態を進める UPDATE は、どれも WHERE に「進める前の状態」を含める。並行した操作のうち 1 つだけが行を更新できる。

-- name: CreateAttachment :exec
INSERT INTO attachments (id, room_id, uploader_id, status, object_key, file_name, mime_type, size_bytes, width, height, created_at)
VALUES (sqlc.arg(id), sqlc.arg(room_id), sqlc.arg(uploader_id), 'pending', sqlc.arg(object_key), sqlc.arg(file_name),
        sqlc.arg(mime_type), sqlc.arg(size_bytes), sqlc.narg(width), sqlc.narg(height), sqlc.arg(now)::timestamptz);

-- name: GetAttachment :one
SELECT *
  FROM attachments
 WHERE id = sqlc.arg(id);

-- name: MarkAttachmentUploaded :one
-- complete の HEAD はトランザクションの外で行い、その後にこの 1 文で状態を進める。
-- 並行した complete や掃除ジョブに先を越されていれば行を返さないので、呼び出し側が読み直す。
UPDATE attachments
   SET status = 'uploaded'
 WHERE id = sqlc.arg(id)
   AND status = 'pending'
RETURNING *;

-- name: AttachToMessage :many
-- 送信のトランザクションで、メッセージの INSERT の後に呼ぶ。返った件数が ids の数と違えば、呼び出し側がロールバックする。
-- 他人の添付、別のルームの添付、未検証の添付、使用済みの添付は、どれもこの条件で弾かれる。
-- 同じ添付を並行した送信が使おうとしても、2 本目は行ロックを待ってから status の条件を満たさなくなる。
UPDATE attachments
   SET status = 'attached',
       message_id = sqlc.arg(message_id)
 WHERE id = ANY(sqlc.arg(ids)::uuid[])
   AND room_id = sqlc.arg(room_id)
   AND uploader_id = sqlc.arg(uploader_id)
   AND status = 'uploaded'
RETURNING id;

-- name: MarkMessageAttachmentsDeleted :exec
-- メッセージの論理削除と同じトランザクションで呼ぶ。ストレージのオブジェクトは掃除ジョブが消す。
UPDATE attachments
   SET status = 'deleted'
 WHERE room_id = sqlc.arg(room_id)
   AND message_id = sqlc.arg(message_id)
   AND status = 'attached';

-- name: ListAttachmentsForMessages :many
-- メッセージの一覧に添付を載せる。メッセージを読んだ後に 1 文でまとめて読む（N+1 にしない）。
-- インデックス attachments_room_id_message_id_idx を使う。並びは発行順（id）。
SELECT id, message_id, file_name, mime_type, size_bytes, width, height
  FROM attachments
 WHERE room_id = sqlc.arg(room_id)
   AND message_id = ANY(sqlc.arg(message_ids)::uuid[])
   AND status = 'attached'
 ORDER BY message_id, id;

-- name: LockAttachmentsForCleanup :many
-- 掃除ジョブの対象を行ロックして取る。SKIP LOCKED で、複数台が同時に実行しても同じ行を取り合わない。
-- 「status <> 'attached'」は冗長に見えるが、部分インデックス attachments_cleanup_idx の条件と一致させて、インデックスを使わせるために書く。
SELECT id, object_key
  FROM attachments
 WHERE status <> 'attached'
   AND (status = 'deleted' OR created_at < sqlc.arg(stale_before)::timestamptz)
 ORDER BY created_at
 LIMIT sqlc.arg(max_rows)
   FOR UPDATE SKIP LOCKED;

-- name: DeleteAttachments :exec
DELETE FROM attachments
 WHERE id = ANY(sqlc.arg(ids)::uuid[]);
