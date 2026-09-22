/**
 * ピン留め（ADR 0054）の、状態を持たない計算。
 *
 * ピン留めの一覧はサーバーが「ピン留めした新しい順」で返す。届いたメッセージ（message.updated・差分）で
 * 手元の一覧を直すときも、同じ並びを作る。
 */
import type { Message } from "@/lib/api/types.gen";

/** ルームごとのピン留めの上限（ADR 0054 決定 4）。超えるとサーバーが 422（`pinned: too_many`）を返す。 */
export const MAX_ROOM_PINS = 100;

/** ピン留めの一覧の並び。ピン留めした時刻の新しい順で、同じ時刻ならメッセージの ID の大きい順（サーバーと同じ）。 */
export function comparePins(a: Message, b: Message): number {
  const at = (b.pinned?.at ?? "").localeCompare(a.pinned?.at ?? "");
  return at !== 0 ? at : b.id.localeCompare(a.id);
}

/**
 * 届いたメッセージで、手元のピン留めの一覧を直す。
 *
 * - ピン留めされていて削除されていなければ、一覧に入れる（すでにあれば、change_seq の大きい方に置き換える）
 * - ピンが外れた・削除された（削除でピンも外れる。ADR 0054 決定 4）なら、一覧から除く
 *
 * 何も変わらなければ、同じ配列をそのまま返す（描き直しを起こさない）。
 */
export function applyPinnedMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  let next: Message[] | undefined;
  for (const message of incoming) {
    const list = next ?? (current as Message[]);
    const index = list.findIndex((m) => m.id === message.id);
    const existing = index >= 0 ? list[index] : undefined;
    if (existing && existing.change_seq > message.change_seq) continue;
    const pinned = message.pinned !== null && message.deleted_at === null;
    if (!pinned && !existing) continue;
    const without = list.filter((m) => m.id !== message.id);
    next = pinned ? [...without, message].sort(comparePins) : without;
  }
  return next ?? (current as Message[]);
}
