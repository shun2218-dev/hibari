/**
 * 絵文字のリアクション（ADR 0044）の、状態を持たない計算。
 *
 * 表示の文言と、楽観的更新（手元で先に反映する）の計算をここに閉じ込める。
 * 実際に送るのも、失敗したら戻すのもデータ層（store.ts）の仕事。
 */
import type { MessageReaction } from "@/lib/api/types.gen";

/** 1 つのメッセージに付けられる絵文字の種類の上限（ADR 0044 決定 5）。超えるとサーバーが 422 を返す。 */
export const MAX_REACTION_KINDS = 20;

/** レスポンスの `users` に載る人数の上限（ADR 0044 決定 3）。楽観的更新でもこれ以上は増やさない。 */
export const MAX_REACTION_USERS = 8;

/**
 * リアクションのチップにホバーしたときに出す「誰が付けたか」（ADR 0044 決定 3）。
 *
 * API が返す名前は先頭 8 人までなので、`count` に足りないぶんは「他 N 人」でまとめる。
 * 名前が 1 つも引けない（全員がルームを抜けたあとなど）ときは、人数だけで言う。
 */
export function reactionNamesLabel(reaction: { emoji: string; count: number; names: string[] }): string {
  const { emoji, count, names } = reaction;
  const rest = Math.max(0, count - names.length);
  const who =
    names.length === 0
      ? `${count} 人`
      : rest === 0
        ? names.join("、")
        : `${names.join("、")} 他 ${rest} 人`;
  return `${who}が ${emoji} を付けました`;
}

/**
 * `#2f6f62` を emoji-mart の CSS 変数が求める `47, 111, 98` に直す（ADR 0044 決定 7）。
 *
 * emoji-mart は `rgba(var(--em-rgb-accent), 0.1)` のように色を組み立てるので、16 進のままでは渡せない。
 * 読めない値（`rgb(...)` や空文字）は undefined を返し、呼ぶ側はライブラリの既定色に任せる。
 */
export function rgbTriplet(color: string): string | undefined {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (hex === undefined) return undefined;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const value = Number.parseInt(full, 16);
  return `${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}`;
}

/**
 * 手元のリアクションに、自分の付け外しを先に反映する（ADR 0044 決定 8 の楽観的更新）。
 *
 * サーバーと同じ結果を作るのが目的なので、規則もサーバーに合わせる。
 * - 並びは最初に付いた順。新しい絵文字は末尾に足す
 * - `users` は先頭 8 人までなので、すでに 8 人いるときは自分を足さない（数だけ増える）
 * - 数が 0 になった絵文字は行ごと消す
 *
 * すでにその状態なら、同じ配列をそのまま返す（描き直しを起こさない）。
 */
export function toggleReaction(
  reactions: readonly MessageReaction[],
  emoji: string,
  userId: string,
  add: boolean,
): MessageReaction[] {
  const current = reactions.find((r) => r.emoji === emoji);
  const mine = current?.me ?? false;
  if (mine === add) return reactions as MessageReaction[];

  if (add) {
    if (!current) return [...reactions, { emoji, count: 1, me: true, users: [userId] }];
    return reactions.map((r) =>
      r.emoji === emoji
        ? { ...r, count: r.count + 1, me: true, users: r.users.length < MAX_REACTION_USERS ? [...r.users, userId] : r.users }
        : r,
    );
  }
  if (!current) return reactions as MessageReaction[];
  if (current.count <= 1) return reactions.filter((r) => r.emoji !== emoji);
  return reactions.map((r) =>
    r.emoji === emoji ? { ...r, count: r.count - 1, me: false, users: r.users.filter((u) => u !== userId) } : r,
  );
}

/**
 * 届いたメッセージのリアクションに、手元の `me` を引き継ぐ（ADR 0044 決定 3 の追記）。
 *
 * `message.updated` は購読者全員に同じペイロードを配るので `me` が入っていない。
 * `me` が変わるのは自分が押したときだけで、そのときは `PUT` / `DELETE` の応答が `me` 付きで返るから、
 * 届いた更新では手元の値をそのまま保てばよい。
 */
export function keepMyReactions(
  previous: readonly MessageReaction[],
  incoming: readonly MessageReaction[],
): MessageReaction[] {
  if (incoming.every((r) => r.me !== undefined)) return incoming as MessageReaction[];
  return incoming.map((r) =>
    r.me === undefined ? { ...r, me: previous.find((p) => p.emoji === r.emoji)?.me ?? false } : r,
  );
}
