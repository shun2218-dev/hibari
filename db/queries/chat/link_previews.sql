-- 外部のリンクのプレビュー（ADR 0065）。

-- ---- URL ごとの取得の結果（link_previews）----

-- name: FindFreshLinkPreview :one
-- この URL の since より新しい取得の結果（決定 2 の 30 分の使い回し）。失敗も返す（取り直さない）。
-- FOR KEY SHARE で、これを指す行を足すまでの間に掃除のジョブが消さないようにする（掃除は SKIP LOCKED で飛ばす）。
SELECT *
  FROM link_previews
 WHERE url = sqlc.arg(url)
   AND fetched_at >= sqlc.arg(since)::timestamptz
 ORDER BY fetched_at DESC
 LIMIT 1
   FOR KEY SHARE;

-- name: CreateLinkPreview :exec
INSERT INTO link_previews (
    id, url, status, title, description, site_name,
    image_object_key, image_content_type, image_width, image_height,
    icon_object_key, icon_content_type, fetched_at
) VALUES (
    sqlc.arg(id), sqlc.arg(url), sqlc.arg(status), sqlc.arg(title), sqlc.arg(description), sqlc.arg(site_name),
    sqlc.narg(image_object_key), sqlc.narg(image_content_type), sqlc.narg(image_width), sqlc.narg(image_height),
    sqlc.narg(icon_object_key), sqlc.narg(icon_content_type), sqlc.arg(fetched_at)
);

-- name: LockUnreferencedLinkPreviews :many
-- どのメッセージからも指されていない、before より古い結果を行ロックして取る（掃除。決定 10）。
-- 使い回しの 30 分より十分に長い before を渡し、送信が指そうとしている行を消さないようにする。
SELECT id, image_object_key, icon_object_key
  FROM link_previews lp
 WHERE fetched_at < sqlc.arg(before)::timestamptz
   AND NOT EXISTS (SELECT 1 FROM message_link_previews m WHERE m.link_preview_id = lp.id)
 ORDER BY fetched_at
 LIMIT sqlc.arg(max_rows)
   FOR UPDATE SKIP LOCKED;

-- name: DeleteLinkPreviews :exec
DELETE FROM link_previews
 WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: EnqueueStorageDeletions :exec
-- 消した結果の画像とアイコンのオブジェクトを、ストレージの掃除の列に積む（ADR 0059 決定 6 の列を使う）。
INSERT INTO storage_deletions (object_key, not_before, created_at)
SELECT unnest(sqlc.arg(object_keys)::text[]), sqlc.arg(not_before)::timestamptz, sqlc.arg(now)::timestamptz
ON CONFLICT (object_key) DO NOTHING;

-- ---- メッセージに付いたプレビュー（message_link_previews）----

-- name: CreateMessageLinkPreview :exec
INSERT INTO message_link_previews (id, room_id, message_id, url, position, status, link_preview_id, removed_at, created_at)
VALUES (
    sqlc.arg(id), sqlc.arg(room_id), sqlc.arg(message_id), sqlc.arg(url), sqlc.arg(position), sqlc.arg(status),
    sqlc.narg(link_preview_id), sqlc.narg(removed_at), sqlc.arg(now)
);

-- name: ListMessageLinkPreviewURLs :many
-- 編集のときに、いまある行（消したものも含む）を読む（決定 4）。
SELECT url, removed_at
  FROM message_link_previews
 WHERE message_id = sqlc.arg(message_id);

-- name: DeleteMessageLinkPreviewsExcept :exec
-- 編集で本文から無くなった URL の行を消す。本人が消した行は残す（書き戻しても出さないため。決定 4）。
DELETE FROM message_link_previews
 WHERE message_id = sqlc.arg(message_id)
   AND removed_at IS NULL
   AND NOT (url = ANY(sqlc.arg(urls)::text[]));

-- name: UpdateMessageLinkPreviewPositions :exec
-- 編集で URL の並びが変わったときに、並びだけを直す（取り直さない。決定 4）。
UPDATE message_link_previews m
   SET position = v.position
  FROM (SELECT unnest(sqlc.arg(urls)::text[]) AS url, unnest(sqlc.arg(positions)::int[]) AS position) AS v
 WHERE m.message_id = sqlc.arg(message_id)
   AND m.url = v.url;

-- name: DeleteMessageLinkPreviews :exec
-- メッセージを削除したとき。tombstone にカードは要らない（決定 10）。指していた結果は掃除のジョブが消す。
DELETE FROM message_link_previews
 WHERE message_id = sqlc.arg(message_id);

-- name: ClaimPendingMessageLinkPreview :one
-- 取得待ちを 1 件取り、claimed_until を立てる（決定 10）。取ってから commit し、ネットワークを待つ間はトランザクションを持たない。
-- SKIP LOCKED で、複数台で動かしても同じ行を取り合わない。claimed_until が過ぎた行（ジョブが落ちた）も拾い直す。
-- room_id はテストだけが渡す（テスト用 DB を共有するほかのテストの行を取らないため）。本番のジョブは null。
UPDATE message_link_previews
   SET claimed_until = sqlc.arg(claimed_until)::timestamptz,
       attempts = attempts + 1
 WHERE id = (
        SELECT id
          FROM message_link_previews
         WHERE status = 'pending'
           AND removed_at IS NULL
           AND (claimed_until IS NULL OR claimed_until <= sqlc.arg(now)::timestamptz)
           AND (sqlc.narg(room_id)::uuid IS NULL OR room_id = sqlc.narg(room_id)::uuid)
         ORDER BY created_at
         LIMIT 1
           FOR UPDATE SKIP LOCKED
       )
RETURNING id, room_id, message_id, url, attempts;

-- name: GetMessageLinkPreviewForUpdate :one
-- 取得の結果を書く前・本人が消す前に行をロックする。メッセージの行をロックしてから取る（編集と同じ順序）。
SELECT *
  FROM message_link_previews
 WHERE id = sqlc.arg(id)
   AND message_id = sqlc.arg(message_id)
   FOR UPDATE;

-- name: CompleteMessageLinkPreview :exec
UPDATE message_link_previews
   SET status = sqlc.arg(status),
       link_preview_id = sqlc.narg(link_preview_id),
       claimed_until = NULL
 WHERE id = sqlc.arg(id);

-- name: RemoveMessageLinkPreview :exec
-- 本人が消した（決定 5）。行は残す。
UPDATE message_link_previews
   SET removed_at = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(id);

-- name: ListMessageLinkPreviews :many
-- ページの全メッセージの、見せるプレビューを 1 回で読む（N+1 にしない）。取得待ち・失敗・消したものは返さない（決定 6）。
SELECT m.id,
       m.message_id,
       m.url,
       lp.site_name,
       lp.title,
       lp.description,
       lp.image_width,
       lp.image_height,
       (lp.icon_object_key IS NOT NULL)::bool AS has_icon
  FROM message_link_previews m
  JOIN link_previews lp ON lp.id = m.link_preview_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.message_id = ANY(sqlc.arg(message_ids)::uuid[])
   AND m.status = 'ok'
   AND m.removed_at IS NULL
 ORDER BY m.message_id, m.position;

-- name: GetMessageLinkPreviewObjects :one
-- 見せているプレビューの画像とアイコンのオブジェクト（決定 7 の URL の API）。削除済みのメッセージのものは返さない。
SELECT lp.image_object_key,
       lp.image_content_type,
       lp.icon_object_key,
       lp.icon_content_type
  FROM message_link_previews m
  JOIN link_previews lp ON lp.id = m.link_preview_id
  JOIN messages msg ON msg.room_id = m.room_id AND msg.id = m.message_id
 WHERE m.room_id = sqlc.arg(room_id)
   AND m.message_id = sqlc.arg(message_id)
   AND m.id = sqlc.arg(id)
   AND m.status = 'ok'
   AND m.removed_at IS NULL
   AND msg.deleted_at IS NULL;
