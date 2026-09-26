import type { RoomKind, RoomSummaryView, UserStatusView } from "@/components/chat/types";
import type { Room } from "@/lib/api/types.gen";
import { formatListTime } from "@/lib/chat/format/time";
import { isMuted } from "@/lib/chat/notifications/mute";
import type { PresenceView } from "@/lib/chat/presence";

import { roomHuddleBadge } from "./huddles";
import { memberPresence } from "./members";
import { ATTACHMENT_ONLY_TEXT, DELETED_MESSAGE_TEXT, systemMessageText, type UrlTable } from "./message";

/**
 * ルームの一覧（サイドバー）とルームの名前。
 */
/** ルームの表示名。DM に名前はないので、相手の表示名にする。 */
export function roomName(room: Room): string {
  return room.kind === "dm" ? (room.dm_peer?.display_name ?? "") : (room.name ?? "");
}

export function toRoomSummaryView(
  room: Room,
  now: Date,
  {
    timeZone,
    avatarUrls = {},
    members = {},
    names = {},
  }: {
    timeZone?: string;
    avatarUrls?: UrlTable;
    /** user_id → 表示名（ワークスペースのメンバー一覧から作る）。ハドルに入っている人の顔に使う（ADR 0066）。 */
    names?: Readonly<Record<string, string | undefined>>;
    /** user_id → その人の presence とステータス（ワークスペースのメンバー一覧から作る。ADR 0049）。 */
    members?: Readonly<Record<string, { presence: PresenceView; status?: UserStatusView } | undefined>>;
  } = {},
): RoomSummaryView {
  const peer = room.dm_peer ? members[room.dm_peer.id] : undefined;
  const last = room.last_message;
  let lastMessage: string | undefined;
  if (last?.kind === "system") {
    // ログは文そのものが「誰が何をした」なので、送信者を前に付けない（ADR 0033）
    lastMessage = systemMessageText(last);
  } else if (last) {
    const body = last.deleted ? DELETED_MESSAGE_TEXT : last.body === "" ? ATTACHMENT_ONLY_TEXT : last.body;
    // DM は相手と自分しかいないので送信者を省く（sidebar のデザイン）
    lastMessage = room.kind === "dm" ? body : `${last.sender.display_name}: ${body}`;
  }
  return {
    id: room.id,
    kind: room.kind,
    name: roomName(room),
    peer: room.dm_peer
      ? {
          // DM の相手の away とステータスは、ワークスペースのメンバー一覧から引く（ADR 0049 決定 7 の追記）。
          // 引けないとき（一覧をまだ読んでいない）は、自動の presence だけで描く
          id: room.dm_peer.id,
          presence: peer?.presence ?? memberPresence(room.dm_peer),
          avatarUrl: avatarUrls[room.dm_peer.id] ?? undefined,
          status: peer?.status,
        }
      : undefined,
    lastMessage,
    timeLabel: room.last_message_at ? formatListTime(new Date(room.last_message_at), now, timeZone) : undefined,
    huddle: roomHuddleBadge(room, names, avatarUrls),
    unreadCount: room.unread_count,
    mentionCount: room.mention_count,
    // 期限の来たミュートは、ストアがタイマーで戻す前でも、ここで「していない」とみなす（ADR 0055）
    muted: isMuted(room.notifications, now.getTime()),
    // サイドバーのチャンネルの節には出さず、検索したときだけ印を付けて出す（ADR 0059。Sidebar が決める）
    archived: room.archived_at !== null,
  };
}

/**
 * 「チャンネルにも投稿する」まわりの文言（ADR 0039、docs/ui/README.md）。DM には「チャンネル」がないので言い換える。
 * チャンネルの行の「スレッドに返信しました」だけは、どのルームでも同じなのでコンポーネント側に置いてある。
 */
export function alsoInChannelLabel(kind: RoomKind): string {
  return kind === "dm" ? "DM にも投稿する" : "チャンネルにも投稿する";
}

export function alsoInChannelDoneLabel(kind: RoomKind): string {
  return kind === "dm" ? "DM にも投稿しました" : "チャンネルにも投稿しました";
}
