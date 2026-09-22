-- アクティビティ（ADR 0058）。
--
-- 行を持たない。通知の規則（ADR 0055 決定 1・ADR 0056 決定 3・ADR 0057 決定 1）と、ルーム・スレッドの既読位置から
-- 読むたびに組み立てる。@channel や「すべての新しい投稿」で人数分の行を書かないため（決定 5 の理由）。
--
-- 規則は web/lib/chat/desktop-notification.ts の shouldNotify と同じ。違うのは次の 2 点だけ（決定 2）。
--   - 「どのタブも見えていない」を見ない（後から見る一覧なので）
--   - @here もメンションに数える（行があるのは送った瞬間にアクティブだった人だけ）
-- 規則の表は testdata/notification-rules.json にあり、Go と Vitest の両方のテストが読む。片方だけ直さないこと。
--
-- 3 つのクエリの CTE（my_rooms / candidates / items）は同じもの。sqlc はクエリをまたいで CTE を共有できないので、
-- 3 か所に同じ形で書いてある。直すときは 3 か所とも直すこと。

-- name: ListActivity :many
-- 一覧の 1 ページ。新しい順で、同じ時刻は sort_key で決める（決定 6）。
-- 並びは created_at だが、ルームをまたいだ一覧の見せ方にしか使わない（同期の根拠は seq のまま。CLAUDE.md ルール 3 の範囲外）。
WITH my_rooms AS (
    -- 自分がメンバーのルームだけを見る（決定 4）。外されたら room_members の行が消えるので、何もしなくても出なくなる。
    -- ミュート中と「なし」のルームは、ここで落とす（規則の最初の 2 行）。
    SELECT rm.room_id, r.kind AS room_kind, rm.last_read_user_seq,
           coalesce(rm.notify_level, wm.notify_level, 'mentions') AS effective_level
      FROM room_members rm
      JOIN rooms r ON r.id = rm.room_id
      JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = rm.user_id
     WHERE rm.user_id = sqlc.arg(user_id)
       AND r.workspace_id = sqlc.arg(workspace_id)
       AND NOT (rm.muted AND (rm.muted_until IS NULL OR rm.muted_until > sqlc.arg(now)::timestamptz))
       -- DM は全体の設定が none でなければ対象。チャンネルは「通知する内容」（上書き、なければ全体）が none なら何も出さない
       AND CASE WHEN r.kind = 'dm' THEN coalesce(wm.notify_level, 'mentions') <> 'none'
                ELSE coalesce(rm.notify_level, wm.notify_level, 'mentions') <> 'none'
           END
),
candidates AS (
    -- 理由ごとの候補。1 つのメッセージが複数の理由に当たれば、ここでは複数行になる（items でまとめる）。
    -- メンション: 自分宛て（user_id = 自分。@here の解決結果も含む）か @channel（user_id が NULL）
    SELECT mm.message_id, 'mention'::text AS reason
      FROM my_rooms mr
      JOIN message_mentions mm ON mm.room_id = mr.room_id
     WHERE mm.user_id IS NULL OR mm.user_id = sqlc.arg(user_id)
    UNION ALL
    -- DM: すべて（スレッドの返信も。ADR 0057 決定 1 の表）
    SELECT m.id, 'dm'
      FROM my_rooms mr
      JOIN messages m ON m.room_id = mr.room_id
     WHERE mr.room_kind = 'dm'
    UNION ALL
    -- スレッド: 参加していて返信の通知がオンのスレッドの返信（ADR 0056 決定 3）
    SELECT m.id, 'thread'
      FROM thread_members tm
      JOIN my_rooms mr ON mr.room_id = tm.room_id
      JOIN messages m ON m.thread_root_id = tm.thread_root_id
     WHERE tm.user_id = sqlc.arg(user_id)
       AND tm.notify_replies
    UNION ALL
    -- 「すべての新しい投稿」: チャンネルに出た投稿だけ（スレッドだけの返信は、上の 2 つに当たるときだけ）
    SELECT m.id, 'channel'
      FROM my_rooms mr
      JOIN messages m ON m.room_id = mr.room_id AND m.in_channel
     WHERE mr.room_kind <> 'dm'
       AND mr.effective_level = 'all'
),
items AS (
    SELECT 'message'::text AS item_type, m.id AS message_id, m.room_id, NULL::uuid AS reactor_id, NULL::text AS emoji,
           m.created_at AS occurred_at, ('m:' || m.id::text)::text AS sort_key,
           array_agg(DISTINCT c.reason ORDER BY c.reason)::text[] AS reasons,
           -- 未読は未読数と同じ物差し（決定 5）。スレッドだけの返信は、参加していなければ未読にしない
           bool_or(CASE WHEN m.in_channel THEN m.user_seq > mr.last_read_user_seq
                        ELSE coalesce(m.thread_seq > tm.last_read_thread_seq, false)
                   END) AS unread
      FROM candidates c
      JOIN messages m ON m.id = c.message_id
      JOIN my_rooms mr ON mr.room_id = m.room_id
      LEFT JOIN thread_members tm ON tm.thread_root_id = m.thread_root_id AND tm.user_id = sqlc.arg(user_id)
     WHERE m.kind = 'user'
       AND m.sender_id <> sqlc.arg(user_id)
       AND m.deleted_at IS NULL
     GROUP BY m.id
    UNION ALL
    -- 自分のメッセージに、ほかの人が付けたリアクション。1 行が 1 件で、未読の状態は持たない（決定 5）
    SELECT 'reaction', m.id, m.room_id, re.user_id, re.emoji,
           re.created_at, 'r:' || m.id::text || ':' || re.user_id::text || ':' || re.emoji,
           ARRAY['reaction']::text[], false
      FROM my_rooms mr
      JOIN messages m ON m.room_id = mr.room_id AND m.sender_id = sqlc.arg(user_id)
      JOIN message_reactions re ON re.message_id = m.id
     WHERE re.user_id <> sqlc.arg(user_id)
       AND m.kind = 'user'
       AND m.deleted_at IS NULL
)
SELECT item_type, message_id, room_id, reactor_id, emoji, occurred_at, sort_key, reasons, unread
  FROM items
 WHERE (sqlc.arg(filter)::text = 'all' OR sqlc.arg(filter)::text = ANY(reasons))
   AND (NOT sqlc.arg(unread_only)::boolean OR unread)
   AND (occurred_at, sort_key) < (sqlc.arg(before_at)::timestamptz, sqlc.arg(before_key)::text)
 ORDER BY occurred_at DESC, sort_key DESC
 LIMIT sqlc.arg(max_rows);

-- name: CountUnreadActivity :one
-- 未読のアクティビティの件数（メニューのバッジ）。max_rows で打ち切る（100 以上は「99+」。決定 5）。
-- リアクションは未読を持たないので数えない。
WITH my_rooms AS (
    SELECT rm.room_id, r.kind AS room_kind, rm.last_read_user_seq,
           coalesce(rm.notify_level, wm.notify_level, 'mentions') AS effective_level
      FROM room_members rm
      JOIN rooms r ON r.id = rm.room_id
      JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = rm.user_id
     WHERE rm.user_id = sqlc.arg(user_id)
       AND r.workspace_id = sqlc.arg(workspace_id)
       AND NOT (rm.muted AND (rm.muted_until IS NULL OR rm.muted_until > sqlc.arg(now)::timestamptz))
       AND CASE WHEN r.kind = 'dm' THEN coalesce(wm.notify_level, 'mentions') <> 'none'
                ELSE coalesce(rm.notify_level, wm.notify_level, 'mentions') <> 'none'
           END
),
candidates AS (
    SELECT mm.message_id
      FROM my_rooms mr
      JOIN message_mentions mm ON mm.room_id = mr.room_id
     WHERE mm.user_id IS NULL OR mm.user_id = sqlc.arg(user_id)
    UNION
    SELECT m.id
      FROM my_rooms mr
      JOIN messages m ON m.room_id = mr.room_id
     WHERE mr.room_kind = 'dm'
    UNION
    SELECT m.id
      FROM thread_members tm
      JOIN my_rooms mr ON mr.room_id = tm.room_id
      JOIN messages m ON m.thread_root_id = tm.thread_root_id
     WHERE tm.user_id = sqlc.arg(user_id)
       AND tm.notify_replies
    UNION
    SELECT m.id
      FROM my_rooms mr
      JOIN messages m ON m.room_id = mr.room_id AND m.in_channel
     WHERE mr.room_kind <> 'dm'
       AND mr.effective_level = 'all'
)
SELECT count(*)::bigint
  FROM (
    SELECT 1
      FROM candidates c
      JOIN messages m ON m.id = c.message_id
      JOIN my_rooms mr ON mr.room_id = m.room_id
      LEFT JOIN thread_members tm ON tm.thread_root_id = m.thread_root_id AND tm.user_id = sqlc.arg(user_id)
     WHERE m.kind = 'user'
       AND m.sender_id <> sqlc.arg(user_id)
       AND m.deleted_at IS NULL
       AND CASE WHEN m.in_channel THEN m.user_seq > mr.last_read_user_seq
                ELSE coalesce(m.thread_seq > tm.last_read_thread_seq, false)
           END
     LIMIT sqlc.arg(max_rows)
  ) unread;

-- name: ReactionActivityTarget :one
-- リアクションを付けた・外したとき、送信者のアクティビティに載るルームか（本人宛てのイベントを配るか。決定 9）。
-- 一覧の my_rooms と同じ条件（メンバーで、ミュート中でも「なし」でもない）。
SELECT EXISTS (
    SELECT 1
      FROM room_members rm
      JOIN rooms r ON r.id = rm.room_id
      JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = rm.user_id
     WHERE rm.room_id = sqlc.arg(room_id)
       AND rm.user_id = sqlc.arg(user_id)
       AND NOT (rm.muted AND (rm.muted_until IS NULL OR rm.muted_until > sqlc.arg(now)::timestamptz))
       AND CASE WHEN r.kind = 'dm' THEN coalesce(wm.notify_level, 'mentions') <> 'none'
                ELSE coalesce(rm.notify_level, wm.notify_level, 'mentions') <> 'none'
           END
)::boolean;

-- name: GetReaction :one
-- 付けたリアクションの 1 行（本人宛てのイベントの occurred_at に使う）。
SELECT created_at
  FROM message_reactions
 WHERE message_id = sqlc.arg(message_id)
   AND user_id = sqlc.arg(user_id)
   AND emoji = sqlc.arg(emoji);
