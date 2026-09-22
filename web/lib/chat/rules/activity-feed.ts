import type { ActivityFilter, ActivityItem, Message, Room } from "@/lib/api/types.gen";

import { inChannel } from "./messages";

/**
 * アクティビティ（ADR 0058）の一覧を、手元で動かすための純粋な関数。ストア（chat-store.ts）が呼ぶ。
 *
 * サーバーは行を持たず、読むたびに通知の規則と既読位置から組み立てる。手元でも同じ考え方で、
 * 新しいメッセージは notifyReasons（desktop-notification.ts）で理由を求めて足し、既読は既読位置から求め直す。
 * 手元で合わせきれないもの（設定を変えた、外された、再接続した）は一覧ごと取り直す。
 */

/** 一覧 1 つの状態。タブ（filter）と「未読メッセージ」の組ごとに持つ。 */
export type ActivityListState = {
  status: "loading" | "ready" | "error";
  /** 新しい順（API と同じ）。 */
  items: ActivityItem[];
  /** 次のページの before。続きがなければ null。 */
  nextCursor: string | null;
  loadingMore: boolean;
};

/** 一覧の組を 1 つの文字列にする（ストアの Record のキー）。 */
export function activityListKey(filter: ActivityFilter, unreadOnly: boolean): string {
  return `${filter}:${unreadOnly ? "unread" : "all"}`;
}

export function parseActivityListKey(key: string): { filter: ActivityFilter; unreadOnly: boolean } {
  const [filter, unread] = key.split(":");
  return { filter: filter as ActivityFilter, unreadOnly: unread === "unread" };
}

/** その一覧に並ぶ 1 件か（タブは理由で、「未読メッセージ」は未読で絞る。リアクションは未読を持たない）。 */
export function belongsTo(item: ActivityItem, filter: ActivityFilter, unreadOnly: boolean): boolean {
  if (unreadOnly && !item.unread) return false;
  return filter === "all" || item.reasons.includes(filter);
}

/**
 * 届いたメッセージの 1 件を作る。サーバーの id（m:<uuid>）とは表記が違うので、メッセージの 1 件はメッセージの ID で
 * 同じものかを決める（insertActivity）。一覧を取り直せば、サーバーの id に置き換わる。
 */
export function messageActivityItem(message: Message, room: Room, reasons: ActivityItem["reasons"], unread: boolean): ActivityItem {
  return {
    id: `m:${message.id}`,
    type: "message",
    reasons,
    unread,
    occurred_at: message.created_at,
    room: { id: room.id, kind: room.kind, name: room.name ?? "", dm_peer: room.dm_peer ?? null },
    message,
    reaction: null,
  };
}

/**
 * 1 件を足す。すでにあれば置き換える。並びは新しい順（occurred_at、同じなら id）で、届いたものはふつう先頭に入る。
 */
export function insertActivity(items: readonly ActivityItem[], item: ActivityItem): ActivityItem[] {
  const rest = items.filter((i) => !sameItem(i, item));
  const index = rest.findIndex((i) => compareNewestFirst(item, i) < 0);
  const at = index === -1 ? rest.length : index;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

function sameItem(a: ActivityItem, b: ActivityItem): boolean {
  if (a.type === "message" && b.type === "message") return a.message.id === b.message.id;
  return a.id === b.id;
}

function compareNewestFirst(a: ActivityItem, b: ActivityItem): number {
  if (a.occurred_at !== b.occurred_at) return a.occurred_at > b.occurred_at ? -1 : 1;
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}

/** 条件に当たる 1 件を外す。変わらなければ同じ配列を返す。 */
export function removeActivity(items: ActivityItem[], match: (item: ActivityItem) => boolean): ActivityItem[] {
  return items.some(match) ? items.filter((i) => !match(i)) : items;
}

/**
 * ルームの既読位置が進んだ。チャンネルに出たメッセージ（DM を含む）は未読数と同じ物差しで決める（決定 5）。
 * 変わらなければ同じ配列を返す。
 */
export function applyRoomReadToActivity(items: ActivityItem[], roomId: string, lastReadUserSeq: number): ActivityItem[] {
  return markRead(
    items,
    (i) => i.room.id === roomId && inChannel(i.message) && i.message.user_seq <= lastReadUserSeq,
  );
}

/** スレッドの既読位置が進んだ。スレッドだけの返信は、スレッドの物差しで決める。 */
export function applyThreadReadToActivity(items: ActivityItem[], rootId: string, lastReadThreadSeq: number): ActivityItem[] {
  return markRead(
    items,
    (i) =>
      i.message.thread_root_id === rootId &&
      !inChannel(i.message) &&
      i.message.thread_seq !== null &&
      i.message.thread_seq <= lastReadThreadSeq,
  );
}

function markRead(items: ActivityItem[], read: (item: ActivityItem) => boolean): ActivityItem[] {
  if (!items.some((i) => i.unread && read(i))) return items;
  return items.map((i) => (i.unread && read(i) ? { ...i, unread: false } : i));
}
