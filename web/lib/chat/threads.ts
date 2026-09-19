import type { FollowedThread, Message } from "@/lib/api/types.gen";

/**
 * スレッド（ADR 0036）の状態を、届いたメッセージやイベントに合わせて作り直す関数。ストア（store.ts）から呼ぶ。
 *
 * 未読数は「親の last_thread_seq - 自分の last_read_thread_seq」で求め直す（足し引きしない）。
 * 同じイベントが 2 回届いても（ADR 0016）、順序が入れ替わっても数がずれない。
 */

/** 返信を seq の昇順に保ったまま、id で上書きする（mergeMessages と同じ規則。新しい change_seq を残す）。 */
export function mergeReplies(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (!existing || existing.change_seq <= message.change_seq) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * 読み込んである範囲（いちばん古い返信から最新まで）にだけ合わせる（mergeIntoWindow と同じ理由）。
 * 古い返信を読み込んでいないのに、その編集や削除が届いたら足さない。
 */
export function mergeRepliesIntoWindow(
  current: readonly Message[],
  hasOlder: boolean,
  incoming: readonly Message[],
): Message[] {
  const oldest = current[0]?.seq;
  const inWindow = hasOlder && oldest !== undefined ? incoming.filter((m) => m.seq >= oldest) : incoming;
  return inWindow.length === 0 ? (current as Message[]) : mergeReplies(current, inWindow);
}

function withUnread(thread: FollowedThread): FollowedThread {
  const unread = Math.max(0, thread.last_thread_seq - thread.last_read_thread_seq);
  return unread === thread.unread_count ? thread : { ...thread, unread_count: unread };
}

/** 最後の返信が新しい順（API と同じ）。同じ時刻なら親の ID の大きい順。 */
function byLastReply(a: FollowedThread, b: FollowedThread): number {
  const diff = Date.parse(b.last_reply_at) - Date.parse(a.last_reply_at);
  return diff !== 0 ? diff : b.root.id.localeCompare(a.root.id);
}

/**
 * 親のメッセージ（message.updated など）の返信数・最後の返信・本文を、参加中のスレッドの一覧に反映する。
 * 参加していないスレッドの親なら何もしない（参加は thread.followed で取り直す）。
 */
export function applyRootToThreads(threads: readonly FollowedThread[], root: Message): FollowedThread[] {
  const index = threads.findIndex((t) => t.root.id === root.id);
  const current = threads[index];
  if (!current || !root.thread) return threads as FollowedThread[];
  // 古い親（change_seq の小さいもの）が後から届いても、数を戻さない
  if (root.thread.last_thread_seq < current.last_thread_seq) return threads as FollowedThread[];
  const next = withUnread({
    ...current,
    root: { ...current.root, body: root.body, deleted: root.deleted_at !== null },
    reply_count: root.thread.reply_count,
    last_thread_seq: root.thread.last_thread_seq,
    last_reply_at: root.thread.last_reply_at,
  });
  return threads.map((t, i) => (i === index ? next : t)).sort(byLastReply);
}

/** 自分の既読位置を進める（thread.read、自分の返信）。後退させない。 */
export function applyThreadRead(
  threads: readonly FollowedThread[],
  rootId: string,
  lastReadThreadSeq: number,
): FollowedThread[] {
  const index = threads.findIndex((t) => t.root.id === rootId);
  const current = threads[index];
  if (!current || current.last_read_thread_seq >= lastReadThreadSeq) return threads as FollowedThread[];
  const next = withUnread({ ...current, last_read_thread_seq: lastReadThreadSeq });
  return threads.map((t, i) => (i === index ? next : t));
}

/** 未読の返信があるスレッドの数（サイドバーの「スレッド」のバッジ）。 */
export function countUnreadThreads(threads: readonly FollowedThread[]): number {
  return threads.filter((t) => t.unread_count > 0).length;
}
