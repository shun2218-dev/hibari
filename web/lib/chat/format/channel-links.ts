/**
 * 本文の `<#ULID>`（チャンネルへのリンク。ADR 0062）の名前を引く表と、入力欄の補完・手で打った `#名前` の一致。
 *
 * 名前はサーバーから受け取らず、手元のルーム一覧（参加しているルームと、参加していない public ルーム）から引く（決定 2）。
 * 読めない private ルームの名前は一覧に最初から入っていないので、表にも入らない。
 */

import type { Room } from "@/lib/api/types.gen";

/** 本文から指せるチャンネル。DM は入れない（決定 1）。 */
export type ChannelRef = {
  id: string;
  name: string;
  private: boolean;
  /** アーカイブ済み。本文のリンクは押せるが、補完には出さない（決定 4）。 */
  archived: boolean;
};

/** room_id → チャンネル。 */
export type ChannelTable = Readonly<Record<string, ChannelRef>>;

/** 引けないとき（参加していない private、削除済み）の文言（決定 3）。どちらかは手元の情報では見分けられない。 */
export const UNRESOLVED_CHANNEL_NAME = "アクセスできないチャンネル";

/** ルーム一覧から表を作る。 */
export function channelTable(rooms: readonly Room[]): ChannelTable {
  const table: Record<string, ChannelRef> = {};
  for (const room of rooms) {
    if (room.kind === "dm" || room.name === null) continue;
    table[room.id] = { id: room.id, name: room.name, private: room.kind === "private", archived: room.archived_at !== null };
  }
  return table;
}

/** 平文にするときの `#名前`（決定 5）。 */
export function channelLabel(table: ChannelTable, id: string): string {
  return `#${table[id]?.name ?? UNRESOLVED_CHANNEL_NAME}`;
}

const byName = (a: ChannelRef, b: ChannelRef) => a.name.localeCompare(b.name, "ja");

/** 補完の候補（決定 4）。前方一致を先、部分一致を後に、それぞれ名前の順。アーカイブ済みは出さない。 */
export function filterChannels(table: ChannelTable, query: string, limit = 8): ChannelRef[] {
  const q = query.toLowerCase();
  const open = Object.values(table).filter((c) => !c.archived);
  const prefix = open.filter((c) => c.name.toLowerCase().startsWith(q)).sort(byName);
  const partial = open.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)).sort(byName);
  return [...prefix, ...partial].slice(0, limit);
}

/** 名前の後ろに来てよい文字。手で打った `@ハンドル` と同じ（typed-mentions.tsx）。 */
const BOUNDARY = /[\s、。,.!?！？)）」』]/u;

/**
 * `#` の直後の文字列 text が、どのチャンネルの名前で始まるか（決定 4）。
 * 名前には空白を含められるので、後ろが区切り（空白・句読点・文字の終わり）になる**いちばん長い名前**を選ぶ。
 * 大文字小文字は区別しない。アーカイブ済みも一致させる（補完に出さないだけで、指すことはできる）。
 */
export function matchTypedChannel(table: ChannelTable, text: string): { channel: ChannelRef; length: number } | null {
  const lower = text.toLowerCase();
  let best: ChannelRef | null = null;
  for (const channel of Object.values(table)) {
    const name = channel.name.toLowerCase();
    if (!lower.startsWith(name)) continue;
    const next = text[name.length];
    if (next !== undefined && !BOUNDARY.test(next)) continue;
    if (best === null || channel.name.length > best.name.length) best = channel;
  }
  return best && { channel: best, length: best.name.length };
}
