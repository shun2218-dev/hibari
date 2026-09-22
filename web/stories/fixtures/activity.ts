import type { ActivityItemView } from "@/components/chat/types";

import { miyuki, naoki, ryo, users } from "./users";

/**
 * アクティビティ（ADR 0058）。
 */
// ---- アクティビティと DM の一覧（ADR 0058） ----

/**
 * アクティビティの一覧。メッセージ単位で、同じチャンネルの通知も 1 件ずつ並ぶ（オーナーの要望）。
 * 理由（DM・メンション・スレッド・「すべての新しい投稿」・リアクション）がひととおり混ざるようにしてある。
 */
export const activityItems: ActivityItemView[] = [
  {
    key: "a-dm-miyuki",
    href: "#",
    reasons: ["dm"],
    unread: true,
    room: { kind: "dm", name: users.miyuki.name },
    actor: miyuki,
    body: "モックのリンク送りますね",
    attachmentCount: 0,
    dateLabel: "今日",
    timeLabel: "09:58",
  },
  {
    key: "a-mention-design",
    href: "#",
    reasons: ["mention"],
    unread: true,
    room: { kind: "public", name: "デザインレビュー" },
    actor: ryo,
    body: `<@${users.you.id}> サイドバーの左のメニュー、アイコンの下に文字を置く形で見てもらえますか？`,
    mentionNames: { [users.you.id]: users.you.name },
    attachmentCount: 0,
    dateLabel: "今日",
    timeLabel: "09:41",
  },
  {
    key: "a-thread-release",
    href: "#",
    reasons: ["thread"],
    unread: true,
    room: { kind: "private", name: "リリース準備" },
    actor: naoki,
    threadRootExcerpt: "金曜のリリース手順です",
    body: "バックアップの確認は私がやります。終わったらこのスレッドに書きます。",
    attachmentCount: 0,
    dateLabel: "今日",
    timeLabel: "09:20",
  },
  {
    key: "a-reaction-chat",
    href: "#",
    reasons: ["reaction"],
    unread: false,
    room: { kind: "public", name: "雑談" },
    actor: miyuki,
    reactionEmoji: "☕",
    body: "駅前の喫茶店、朝 7 時から開いてました",
    attachmentCount: 0,
    dateLabel: "今日",
    timeLabel: "08:47",
  },
  {
    key: "a-mention-design-2",
    href: "#",
    reasons: ["mention"],
    unread: false,
    room: { kind: "public", name: "デザインレビュー" },
    actor: naoki,
    body: `<@${users.you.id}> 昨日の件、presence のドットの色で合意しました`,
    mentionNames: { [users.you.id]: users.you.name },
    attachmentCount: 0,
    dateLabel: "昨日",
    timeLabel: "17:32",
  },
  {
    key: "a-channel-release",
    href: "#",
    reasons: ["channel"],
    unread: false,
    room: { kind: "private", name: "リリース準備" },
    actor: naoki,
    body: "金曜の夕方で確定しました",
    attachmentCount: 1,
    dateLabel: "昨日",
    timeLabel: "16:05",
  },
  {
    key: "a-dm-ryo",
    href: "#",
    reasons: ["dm", "mention"],
    unread: false,
    room: { kind: "dm", name: users.ryo.name },
    actor: ryo,
    body: `<@${users.you.id}> ありがとうございます、確認しました`,
    mentionNames: { [users.you.id]: users.you.name },
    attachmentCount: 0,
    dateLabel: "昨日",
    timeLabel: "11:12",
  },
];
