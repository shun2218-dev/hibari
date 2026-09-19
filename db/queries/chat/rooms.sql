-- ルーム（ADR 0006 / 0011）。

-- name: AllocateMessageSeq :one
-- ルームの次の seq と change_seq を採番して返す（ADR 0002「採番方式の確定」/ ADR 0014）。
-- 送信と同じトランザクションの中で呼ぶ。rooms の行ロックで同じルームへの送信・編集・削除が直列化され、
-- ロールバックすれば採番も取り消されるので欠番にならない。
-- 人の発言なので user_seq も 1 進める（ADR 0033）。
UPDATE rooms
   SET last_message_seq = last_message_seq + 1,
       last_change_seq  = last_change_seq + 1,
       last_user_seq    = last_user_seq + 1,
       last_message_at  = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(room_id)
RETURNING last_message_seq, last_change_seq, last_user_seq;

-- name: AllocateSystemMessageSeq :one
-- システムメッセージ（ADR 0033）の採番。seq と change_seq は進め、user_seq は進めない（未読数に数えない）。
UPDATE rooms
   SET last_message_seq = last_message_seq + 1,
       last_change_seq  = last_change_seq + 1,
       last_message_at  = sqlc.arg(now)::timestamptz
 WHERE id = sqlc.arg(room_id)
RETURNING last_message_seq, last_change_seq, last_user_seq;

-- name: AllocateThreadReplySeq :one
-- スレッドの返信の採番（ADR 0036）。seq はルームのものを 1 つ、change_seq は返信と親の 2 つ分を進める
-- （返信は last_change_seq - 1、親は last_change_seq を使う）。
-- スレッドだけの返信はチャンネルに出ないので、user_seq（チャンネルの未読）・last_message_at（サイドバーの並び）は進めない。
-- 「チャンネルにも投稿する」（in_channel）の返信はチャンネルの発言として数え、どちらも進める（ADR 0039）。
UPDATE rooms
   SET last_message_seq = last_message_seq + 1,
       last_change_seq  = last_change_seq + 2,
       last_user_seq    = last_user_seq + CASE WHEN sqlc.arg(in_channel)::boolean THEN 1 ELSE 0 END,
       last_message_at  = CASE WHEN sqlc.arg(in_channel)::boolean THEN sqlc.arg(now)::timestamptz ELSE last_message_at END
 WHERE id = sqlc.arg(room_id)
RETURNING last_message_seq, last_change_seq, last_user_seq;

-- name: AllocateChangeSeq :one
-- 既存のメッセージの編集・削除のために change_seq だけを n 個採番し、最後の番号を返す（ADR 0014）。seq は進めない。
-- 返信の削除は、返信と親（返信数が減る）の 2 つを使う（ADR 0036）。
UPDATE rooms
   SET last_change_seq = last_change_seq + sqlc.arg(n)::bigint
 WHERE id = sqlc.arg(room_id)
RETURNING last_change_seq;

-- name: CreateRoom :one
-- public / private のルーム。名前の重複は部分 UNIQUE インデックス（rooms_workspace_id_name_idx）で検出する。
INSERT INTO rooms (id, workspace_id, kind, name, created_by, created_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(kind), sqlc.arg(name), sqlc.arg(created_by), sqlc.arg(now)::timestamptz)
RETURNING *;

-- name: CreateDMRoom :one
-- DM を作る。同じ 2 人の DM がすでにあれば何もせず、行を返さない（呼び出し側で既存を読む）。
-- 並行して同じ DM を作ると、2 本目は 1 本目の UNIQUE の確定を待ってから DO NOTHING になる。
INSERT INTO rooms (id, workspace_id, kind, dm_key, created_by, created_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), 'dm', sqlc.arg(dm_key), sqlc.arg(created_by), sqlc.arg(now)::timestamptz)
ON CONFLICT (workspace_id, dm_key) WHERE kind = 'dm' DO NOTHING
RETURNING *;

-- name: GetDMRoom :one
SELECT *
  FROM rooms
 WHERE workspace_id = sqlc.arg(workspace_id)
   AND kind = 'dm'
   AND dm_key = sqlc.arg(dm_key);

-- name: GetRoom :one
-- 削除済みのワークスペースのルームは見つからないものとして扱う。
SELECT r.*
  FROM rooms r
  JOIN workspaces w ON w.id = r.workspace_id
 WHERE r.id = sqlc.arg(id)
   AND w.deleted_at IS NULL;

-- name: GetRoomMemberCount :one
SELECT count(*)
  FROM room_members
 WHERE room_id = sqlc.arg(room_id);

-- name: GetRoomMemberships :many
-- user_ids のうち、ルームのメンバーである人。
SELECT user_id
  FROM room_members
 WHERE room_id = sqlc.arg(room_id)
   AND user_id = ANY(sqlc.arg(user_ids)::uuid[]);

-- name: ListRoomsForUser :many
-- サイドバーのルーム一覧: 参加しているルーム（全種類）と、参加していない public ルーム。
-- 読めない private / dm は含めない。並びは最近メッセージがあった順（インデックス rooms_workspace_id_last_message_at_idx）。
-- 最終メッセージは「チャンネルに出ていて、削除されていない最後の行」（ADR 0038）。スレッドの返信（ADR 0036）と削除済みを飛ばす。
-- その seq をルームごとの相関サブクエリ（max）で引く。Postgres は max を部分インデックス messages_room_id_channel_seq_idx の
-- 新しい順の走査に置き換え、条件に合う最初の 1 行で止まる（1 文のクエリなので N+1 にはならない。ADR 0012）。
-- 削除済みが続く分だけ多く読むが、削除はまれなので受け入れる。LATERAL で書かないのは、sqlc が列を NULL にならないものとして扱うため。
-- 未読数はクライアントにも出せるよう last_read_seq をそのまま返し、サービスで last_user_seq との差を取る
-- （システムメッセージは数えない。ADR 0033）。
SELECT sqlc.embed(r), (rm.user_id IS NOT NULL)::boolean AS is_member, rm.last_read_seq, rm.last_read_user_seq,
       -- 自分宛ての未読のメンションの数（ADR 0041）。条件は CountRoomMentions（mentions.sql）と同じ。片方だけ直さないこと。
       -- 参加していない public ルームでは rm.user_id が NULL になるので 0 になる。
       (SELECT count(*) FROM message_mentions mm
          JOIN messages m ON m.room_id = mm.room_id AND m.id = mm.message_id
          LEFT JOIN thread_members tm ON tm.thread_root_id = m.thread_root_id AND tm.user_id = rm.user_id
         WHERE mm.room_id = r.id
           AND rm.user_id IS NOT NULL
           AND (mm.user_id IS NULL OR mm.user_id = rm.user_id)
           AND CASE WHEN m.in_channel THEN m.user_seq > rm.last_read_user_seq
                    ELSE tm.user_id IS NOT NULL AND m.thread_seq > tm.last_read_thread_seq
               END)::bigint AS mention_count,
       lm.id AS last_message_id, lm.sender_id AS last_message_sender_id, lm.body AS last_message_body,
       lm.kind AS last_message_kind, lm.system_type AS last_message_system_type,
       lm.system_data AS last_message_system_data,
       lm.created_at AS last_message_created_at, lm.deleted_at AS last_message_deleted_at,
       lu.handle AS last_message_sender_handle, lu.display_name AS last_message_sender_display_name
  FROM rooms r
  LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = sqlc.arg(user_id)
  LEFT JOIN messages lm ON lm.room_id = r.id AND lm.seq = (
        SELECT max(m.seq) FROM messages m WHERE m.room_id = r.id AND m.in_channel AND m.deleted_at IS NULL)
  LEFT JOIN users lu ON lu.id = lm.sender_id
 WHERE r.workspace_id = sqlc.arg(workspace_id)
   AND (r.kind = 'public' OR rm.user_id IS NOT NULL)
 ORDER BY r.last_message_at DESC NULLS LAST, r.id;

-- name: GetRoomSummary :one
-- 1 件のルームについて、ListRoomsForUser と同じ列（既読位置と最終メッセージ）を返す。読めるかどうかの判定は呼び出し側で済ませる。
SELECT sqlc.embed(r), (rm.user_id IS NOT NULL)::boolean AS is_member, rm.last_read_seq, rm.last_read_user_seq,
       -- 自分宛ての未読のメンションの数（ADR 0041）。条件は CountRoomMentions（mentions.sql）と同じ。片方だけ直さないこと。
       -- 参加していない public ルームでは rm.user_id が NULL になるので 0 になる。
       (SELECT count(*) FROM message_mentions mm
          JOIN messages m ON m.room_id = mm.room_id AND m.id = mm.message_id
          LEFT JOIN thread_members tm ON tm.thread_root_id = m.thread_root_id AND tm.user_id = rm.user_id
         WHERE mm.room_id = r.id
           AND rm.user_id IS NOT NULL
           AND (mm.user_id IS NULL OR mm.user_id = rm.user_id)
           AND CASE WHEN m.in_channel THEN m.user_seq > rm.last_read_user_seq
                    ELSE tm.user_id IS NOT NULL AND m.thread_seq > tm.last_read_thread_seq
               END)::bigint AS mention_count,
       lm.id AS last_message_id, lm.sender_id AS last_message_sender_id, lm.body AS last_message_body,
       lm.kind AS last_message_kind, lm.system_type AS last_message_system_type,
       lm.system_data AS last_message_system_data,
       lm.created_at AS last_message_created_at, lm.deleted_at AS last_message_deleted_at,
       lu.handle AS last_message_sender_handle, lu.display_name AS last_message_sender_display_name
  FROM rooms r
  LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = sqlc.arg(user_id)
  LEFT JOIN messages lm ON lm.room_id = r.id AND lm.seq = (
        SELECT max(m.seq) FROM messages m WHERE m.room_id = r.id AND m.in_channel AND m.deleted_at IS NULL)
  LEFT JOIN users lu ON lu.id = lm.sender_id
 WHERE r.id = sqlc.arg(room_id);

-- name: ListUserProfiles :many
-- DM の相手などの公開プロフィールをまとめて引く（N+1 にしない）。退会済みでも匿名化した値を返す。
SELECT id, handle, display_name
  FROM users
 WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: UpdateRoom :one
-- NULL を渡した項目は変更しない（PATCH）。
UPDATE rooms
   SET name       = coalesce(sqlc.narg(name), name),
       is_default = coalesce(sqlc.narg(is_default), is_default)
 WHERE id = sqlc.arg(id)
RETURNING *;

-- name: AddRoomMember :execrows
-- ルームに参加する。すでにメンバーなら何もせず 0 を返す（冪等）。
-- last_read_seq / last_read_user_seq は同じ文の中で rooms から読み、参加前のメッセージを未読にしない。
INSERT INTO room_members (room_id, user_id, last_read_seq, last_read_user_seq, joined_at)
SELECT r.id, sqlc.arg(user_id), r.last_message_seq, r.last_user_seq, sqlc.arg(now)::timestamptz
  FROM rooms r
 WHERE r.id = sqlc.arg(room_id)
ON CONFLICT DO NOTHING;

-- name: DeleteRoomMember :execrows
DELETE FROM room_members
 WHERE room_id = sqlc.arg(room_id)
   AND user_id = sqlc.arg(user_id);

-- name: ListRoomMemberIDs :many
-- ルームのメンバーの user_id をすべて返す。@here の対象を presence に問い合わせるために使う（ADR 0041）。
-- 表示用ではないので、ページングもプロフィールの JOIN もしない。
SELECT user_id
  FROM room_members
 WHERE room_id = sqlc.arg(room_id)
 ORDER BY user_id;

-- name: ListRoomMembers :many
-- ルームのメンバーと、ワークスペースでのロール。主キー (room_id, user_id) の順に走査するので user_id をカーソルにする。
SELECT rm.user_id, rm.joined_at, wm.role, u.handle, u.display_name
  FROM room_members rm
  JOIN rooms r ON r.id = rm.room_id
  JOIN workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = rm.user_id
  JOIN users u ON u.id = rm.user_id
 WHERE rm.room_id = sqlc.arg(room_id)
   AND rm.user_id > sqlc.arg(after)
   AND u.deleted_at IS NULL
 ORDER BY rm.user_id
 LIMIT sqlc.arg(max_rows);
