import type { RoomMemberRowView } from "@/components/chat/dialogs/room-settings";
import type { DmCandidateView } from "@/components/chat/dialogs/start-dm";
import type { RoomMemberView, RoomSummaryView } from "@/components/chat/types";

import { activityItems } from "./activity";
import { miyuki, myStatus, naoki, ryo, statuses, users, you } from "./users";

/**
 * ルームの一覧とメンバー、DM（ADR 0011）。
 */
export const rooms: RoomSummaryView[] = [
  {
    id: "room-design",
    kind: "public",
    name: "デザインレビュー",
    lastMessage: "中村 涼: presence 表示を確認しておきます",
    timeLabel: "11:05",
    unreadCount: 0,
    mentionCount: 0,
  },
  {
    id: "room-chat",
    kind: "public",
    name: "雑談",
    lastMessage: "高橋 みゆき: 近所に新しい喫茶店ができたらしい",
    timeLabel: "10:22",
    unreadCount: 3,
    mentionCount: 0,
  },
  {
    id: "room-release",
    kind: "private",
    name: "リリース準備",
    lastMessage: "佐藤 直樹: 金曜の夕方で確定しました",
    timeLabel: "昨日",
    unreadCount: 0,
    mentionCount: 0,
  },
  {
    id: "dm-naoki",
    kind: "dm",
    name: users.naoki.name,
    peer: { id: users.naoki.id, presence: "online" },
    lastMessage: "縦バーの件、あとで画面で見ます",
    timeLabel: "10:14",
    unreadCount: 0,
    mentionCount: 0,
  },
  {
    id: "dm-miyuki",
    kind: "dm",
    name: users.miyuki.name,
    peer: { id: users.miyuki.id, presence: "online" },
    lastMessage: "モックのリンク送りますね",
    timeLabel: "09:58",
    unreadCount: 1,
    mentionCount: 0,
  },
  {
    id: "dm-ryo",
    kind: "dm",
    name: users.ryo.name,
    peer: { id: users.ryo.id, presence: "offline" },
    lastMessage: "ありがとうございます、確認しました",
    timeLabel: "昨日",
    unreadCount: 0,
    mentionCount: 0,
  },
];

export const selectedRoom = { id: "room-design", kind: "public", name: "デザインレビュー", memberCount: 4 } as const;

/** サイドバーの検索で、アーカイブしたチャンネルが混ざるところ（chat/archive/search.png。ADR 0059）。 */
export const roomsSearchedWithArchived: RoomSummaryView[] = [
  rooms[0],
  {
    id: "room-design-old",
    kind: "public",
    name: "デザインレビュー旧案",
    lastMessage: "あなた: レビューは全部終わったので、このチャンネルはアーカイブしておきます",
    timeLabel: "9/12",
    unreadCount: 0,
    mentionCount: 0,
    archived: true,
  },
  {
    id: "room-design-private",
    kind: "private",
    name: "デザイン採用",
    lastMessage: "佐藤 直樹: 採用の連絡は済みました",
    timeLabel: "8/30",
    unreadCount: 0,
    mentionCount: 0,
    archived: true,
  },
];

/** メンションの未読があるサイドバー（バッジが `@N` になる。ADR 0043）。 */
export const roomsWithMentions: RoomSummaryView[] = rooms.map((room) =>
  room.id === "room-chat"
    ? { ...room, unreadCount: 7, mentionCount: 2 }
    : room.id === "room-release"
      ? { ...room, unreadCount: 3, mentionCount: 0 }
      : room,
);

export const roomMembers: RoomMemberView[] = [
  { ...naoki, presence: "online", roleLabel: "オーナー" },
  { ...miyuki, presence: "online", roleLabel: "管理者" },
  { ...you, presence: "online", roleLabel: "メンバー" },
  { ...ryo, presence: "offline", roleLabel: "メンバー" },
];

export const typingNames = [users.miyuki.name];

/**
 * 3 つの状態が並ぶメンバーパネル（ADR 0049）。
 * オンライン（緑）・離席（アウトライン）・オフライン（ドットなし）を 1 枚で見比べられるようにする。
 */
export const roomMembersWithPresence: RoomMemberView[] = [
  { ...naoki, status: statuses[users.naoki.id], presence: "online", roleLabel: "オーナー" },
  { ...miyuki, status: statuses[users.miyuki.id], presence: "away", roleLabel: "管理者" },
  { ...you, status: myStatus, presence: "online", roleLabel: "メンバー" },
  { ...ryo, status: statuses[users.ryo.id], presence: "offline", roleLabel: "メンバー" },
];

/** DM の相手にステータスと離席が付いたサイドバー。 */
export const roomsWithStatus: RoomSummaryView[] = rooms.map((room) =>
  room.peer
    ? { ...room, peer: { ...room.peer, status: statuses[room.peer.id], presence: room.peer.id === users.miyuki.id ? "away" : room.peer.presence } }
    : room,
);

/** DM の相手の候補。hibari 開発のメンバーから自分を除いたもの。 */
export const dmCandidates: DmCandidateView[] = [
  { id: users.naoki.id, name: users.naoki.name, handle: users.naoki.handle, presence: "online" },
  { id: users.miyuki.id, name: users.miyuki.name, handle: users.miyuki.handle, presence: "online" },
  { id: users.ryo.id, name: users.ryo.name, handle: users.ryo.handle, presence: "offline" },
];

/** 非公開チャンネル「リリース準備」の参加者。 */
export const roomSettingsMembers: RoomMemberRowView[] = [
  { id: users.naoki.id, name: users.naoki.name, isSelf: false, canRemove: true },
  { id: users.you.id, name: users.you.name, isSelf: true, canRemove: false },
  { id: users.ryo.id, name: users.ryo.name, isSelf: false, canRemove: true },
];

// ---- ミュートと通知の設定（ADR 0055） ----

/**
 * ミュートしたルームの混ざったサイドバー。薄くなるだけで並びは変わらない（ADR 0055 決定 6）。
 * - 雑談: 未読はあるが、太字にならない
 * - リリース準備: 自分宛てのメンションがあるので `@1` は出る
 * - 高橋 みゆき（DM）: 未読の数のバッジが出ない
 */
export const roomsWithMuted: RoomSummaryView[] = rooms.map((room) =>
  room.id === "room-chat"
    ? { ...room, unreadCount: 5, muted: true }
    : room.id === "room-release"
      ? { ...room, unreadCount: 4, mentionCount: 1, muted: true }
      : room.id === "dm-miyuki"
        ? { ...room, unreadCount: 2, muted: true }
        : room,
);

/** 通知のメニューを開いた DM（佐藤 直樹）。 */
export const dmRoom = { id: "dm-naoki", kind: "dm", name: users.naoki.name, memberCount: 2 } as const;

/** 左のメニューのバッジ。DM は未読の会話の数、アクティビティは未読の件数（ADR 0058 決定 1）。 */
export const sideNavBadges = {
  dms: rooms.filter((room) => room.kind === "dm" && room.unreadCount > 0).length,
  activity: activityItems.filter((item) => item.unread).length,
};

/** DM の一覧。最後のメッセージの新しい順（ADR 0058 決定 7）。 */
export const dmRooms: RoomSummaryView[] = [
  ...rooms.filter((room) => room.kind === "dm"),
  {
    id: "dm-misaki",
    kind: "dm",
    name: users.misaki.name,
    peer: { id: users.misaki.id, presence: "offline" },
    lastMessage: "資料、共有フォルダに置いておきました",
    timeLabel: "9月18日",
    unreadCount: 0,
    mentionCount: 0,
  },
  {
    id: "dm-haru",
    kind: "dm",
    name: users.haru.name,
    peer: { id: users.haru.id, presence: "online" },
    lastMessage: "了解です！",
    timeLabel: "9月15日",
    unreadCount: 0,
    mentionCount: 0,
  },
];
