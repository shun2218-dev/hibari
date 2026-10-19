-- プッシュ通知の購読（ADR 0069 決定 3・4）。

-- name: LockPushEndpoint :exec
-- 同じ endpoint の登録を 1 つずつにする（トランザクションの終わりまで）。
-- 制約が 2 つ（endpoint と sid）あり、INSERT ... ON CONFLICT は 1 つしか受けられない。endpoint を書く人がみなこの鍵を取れば、
-- 「ほかのセッションの同じ endpoint を消す → 自分の sid の行に書く」の間に、別のセッションが同じ endpoint を入れることはない。
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(endpoint)::text, 0));

-- name: DeletePushSubscriptionsForEndpointElsewhere :exec
-- 同じブラウザで別のセッション（別の人を含む）が登録していた行を消す。endpoint はブラウザに 1 つなので、前のセッションには届かなくなる。
DELETE FROM push_subscriptions
 WHERE endpoint = sqlc.arg(endpoint) AND sid <> sqlc.arg(sid);

-- name: UpsertPushSubscription :one
-- セッションの購読を登録する。すでにあれば endpoint と鍵を置き換え、ID と作った時刻は残す
-- （ページを開くたびに PUT し直すので、そのたびに ID が変わると一覧の行が入れ替わって見える）。
INSERT INTO push_subscriptions (id, user_id, sid, kind, endpoint, p256dh, auth, user_agent, created_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(sid), sqlc.arg(kind), sqlc.arg(endpoint), sqlc.arg(p256dh), sqlc.arg(auth),
        sqlc.narg(user_agent), sqlc.arg(created_at))
ON CONFLICT ON CONSTRAINT push_subscriptions_sid_key DO UPDATE
   SET user_id    = EXCLUDED.user_id,
       kind       = EXCLUDED.kind,
       endpoint   = EXCLUDED.endpoint,
       p256dh     = EXCLUDED.p256dh,
       auth       = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent
RETURNING id, user_agent, created_at;

-- name: DeletePushSubscriptionBySID :exec
DELETE FROM push_subscriptions
 WHERE user_id = sqlc.arg(user_id) AND sid = sqlc.arg(sid);

-- name: DeletePushSubscriptionByID :execrows
-- 本人の行だけを消す。ほかの人の ID なら 0 行（呼び出し側が 404 にする）。
DELETE FROM push_subscriptions
 WHERE user_id = sqlc.arg(user_id) AND id = sqlc.arg(id);

-- name: DeletePushSubscriptionsByUser :exec
-- 全セッションの失効（パスワードの再設定）で、その人のすべての購読を消す。
DELETE FROM push_subscriptions
 WHERE user_id = sqlc.arg(user_id);

-- name: DeletePushSubscriptionsForSession :exec
-- 1 セッションの失効のイベントには sid しか入っていない（ADR 0007）。
DELETE FROM push_subscriptions
 WHERE sid = sqlc.arg(sid);

-- name: ListPushSubscriptions :many
-- 設定の「通知を受け取る端末」。行の数はその人のセッションの数までなので、ページに分けない。
-- 新しく登録した順（ID は ULID）。
SELECT id, sid, user_agent, created_at
  FROM push_subscriptions
 WHERE user_id = sqlc.arg(user_id)
 ORDER BY id DESC;

-- name: ListPushTargets :many
-- 送る先: 通知を受け取る人たちの購読を 1 回で読む（PushDelivery。人ごとに引くと N+1 になる）。
-- sid も返すのは、送る直前にセッションがまだ有効かを確かめるため（ADR 0069 決定 3 の二段構え）。
SELECT id, user_id, sid, endpoint, p256dh, auth
  FROM push_subscriptions
 WHERE user_id = ANY(sqlc.arg(user_ids)::uuid[])
   AND kind = 'webpush'
 ORDER BY user_id, id;

-- name: DeleteGonePushSubscription :exec
-- プッシュのサービスが 404 / 410 を返した購読を消す（ADR 0069 決定 8）。
-- endpoint も条件に入れるのは、送っている間に同じセッションが新しい endpoint で登録し直していたら（同じ ID のまま置き換わる）、
-- その新しい購読まで消さないため。
DELETE FROM push_subscriptions
 WHERE id = sqlc.arg(id) AND endpoint = sqlc.arg(endpoint);
