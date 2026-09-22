import type { PinnedMessageView, TimelineItem } from "@/components/chat/types";

import { timeline } from "./timeline";
import { miyuki, naoki, ryo, users, you } from "./users";

/**
 * ピン留め（ADR 0054）。
 */
// ---- ピン留めと「後で」（ADR 0054）----

/** 「…」を開いて「チャンネルへピン留めする」を見せるメッセージ（chat/pin/menu.png）。 */
export const pinCandidateKey = "m-1030";

/** ピン留めされたメッセージ（chat/pin/menu-pinned.png で「チャンネルからピンを外す」を見せる）。 */
export const pinnedMessageKey = "m-1041";

/** ピン留めした人。key → 表示名。 */
const pinnedByKey: Readonly<Record<string, string>> = {
  [pinnedMessageKey]: users.you.name,
  "m-1012": users.ryo.name,
};

/** ピン留めのあるタイムライン（chat/pin/timeline.png）。本文の上に「〜がピン留めしました」、行に黄土の地（ADR 0054）。 */
export const timelineWithPins: TimelineItem[] = timeline.map((item) => {
  if (item.type !== "message") return item;
  const pinnedBy = pinnedByKey[item.message.key];
  return pinnedBy ? { ...item, message: { ...item.message, pinnedBy } } : item;
});

/** ピン留めの一覧（chat/pin/list.png）。ピン留めした新しい順。 */
export const pinnedMessages: PinnedMessageView[] = [
  {
    key: pinnedMessageKey,
    href: "#",
    sender: miyuki,
    timeLabel: "今日 10:41",
    body: "行送りは 1.75 で確定にしましょう。半日開きっぱなしでも目が疲れませんでした。",
    attachmentCount: 1,
    inThread: false,
  },
  {
    key: "m-1012",
    href: "#",
    sender: naoki,
    timeLabel: "今日 10:12",
    body: "賛成です。あとサイドバーの選択中の行、左の縦バーは 2px で十分でした。",
    attachmentCount: 0,
    inThread: false,
  },
  {
    key: "r-0948",
    href: "#",
    sender: ryo,
    timeLabel: "今日 09:48",
    body: "*色の決まり*\n- 緑: 押せるもの（ボタン・リンク・選択中）\n- 琥珀: いま起きていること（未読・入力中・接続）",
    attachmentCount: 0,
    inThread: true,
  },
  {
    key: "m-0905",
    href: "#",
    sender: you,
    timeLabel: "9月5日",
    body: "デザインレビューの進め方: 月曜に論点を出して、水曜までにこのチャンネルで結論を出します。決まったことは `docs/ui/` に残してください。",
    attachmentCount: 0,
    inThread: false,
  },
];
