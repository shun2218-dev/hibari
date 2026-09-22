import type { SavedItemView } from "@/components/chat/types";

import { miyuki, naoki, ryo, users, you } from "./users";

/**
 * 「後で」（ADR 0054）。
 */
/** ホバーで「後で」を見せるメッセージ（chat/saved/hover.png / hover-saved.png）。 */
export const saveCandidateKey = "m-1030";

/** 「後で」の進行中（chat/saved/list.png）。保存した新しい順。読めない行を 1 つ混ぜる。 */
export const savedInProgress: SavedItemView[] = [
  {
    key: "m-1030",
    status: "ok",
    href: "#",
    room: { kind: "public", name: "デザインレビュー" },
    sender: ryo,
    timeLabel: "今日 10:30",
    body: "タイムスタンプを等幅にしたの、地味に効いてますね。数字が揃うと視線が上下に動かない。",
    attachmentCount: 0,
  },
  {
    key: "m-release-1612",
    status: "ok",
    href: "#",
    room: { kind: "private", name: "リリース準備" },
    sender: naoki,
    timeLabel: "昨日",
    body: "金曜のリリース手順です。`make migrate` の前に、必ずバックアップの取得を確認してください。",
    attachmentCount: 1,
  },
  { key: "m-gone", status: "unavailable" },
  {
    key: "m-dm-0911",
    status: "ok",
    href: "#",
    room: { kind: "dm", name: users.miyuki.name },
    sender: miyuki,
    timeLabel: "9月11日",
    body: "来週の打ち合わせ、火曜の 15 時でどうでしょう？",
    attachmentCount: 0,
  },
];

/** 「後で」のアーカイブ済み（chat/saved/archived.png）。 */
export const savedArchived: SavedItemView[] = [
  {
    key: "m-0905",
    status: "ok",
    href: "#",
    room: { kind: "public", name: "デザインレビュー" },
    sender: you,
    timeLabel: "9月5日",
    body: "デザインレビューの進め方: 月曜に論点を出して、水曜までにこのチャンネルで結論を出します。",
    attachmentCount: 0,
  },
];

/** 「後で」の完了済み（chat/saved/completed.png）。 */
export const savedCompleted: SavedItemView[] = [
  {
    key: "m-chat-0930",
    status: "ok",
    href: "#",
    room: { kind: "public", name: "雑談" },
    sender: miyuki,
    timeLabel: "9月10日",
    body: "近所に新しい喫茶店ができたらしい。今度の金曜、誰か一緒に行きませんか？",
    attachmentCount: 0,
  },
];
