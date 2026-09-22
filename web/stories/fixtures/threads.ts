import type { MessageView, ThreadListItemView, TimelineItem } from "@/components/chat/types";

import { message, messageView } from "./timeline";
import { miyuki, naoki, ryo, users, you } from "./users";

/**
 * スレッド（ADR 0036 / 0037）。
 */
/** スレッドを開いている親の key。 */
export const threadRootKey = "m-0941";

/**
 * 返信がチャンネルから分かれたタイムライン（chat/thread/thread-panel.png）。
 * 返信はチャンネルに出ず、親の下に「N 件の返信」が出る。
 */
export const timelineWithThreads: TimelineItem[] = [
  { type: "date", key: "d-0913", label: "2026年9月13日" },
  message(threadRootKey, you, "09:41", "おはようございます。昨日の続きで、未読まわりを琥珀に寄せてみました。", {
    thread: { replyCount: 3, lastReplyLabel: "10:18" },
  }),
  message("m-0941b", you, "09:41", "緑はボタンとリンク、選択中のチャンネルだけに残しています。", { grouped: true }),
  message("m-1012", naoki, "10:12", "賛成です。あとサイドバーの選択中の行、左の縦バーは 2px で十分でした。"),
  message("m-1012b", naoki, "10:12", "4px だと主張が強すぎて、名前より先に目が行ってしまう。", { grouped: true, edited: true }),
  message("m-1030", ryo, "10:30", "タイムスタンプを等幅にしたの、地味に効いてますね。数字が揃うと視線が上下に動かない。", {
    thread: { replyCount: 1, lastReplyLabel: "10:44" },
  }),
  message("m-1041", miyuki, "10:41", "行送りは 1.75 で確定にしましょう。半日開きっぱなしでも目が疲れませんでした。"),
  message("m-1105", ryo, "11:05", "ありがとうございます。こちらはメンバー一覧の presence 表示を確認しておきます。"),
];

export const threadRoot: MessageView = messageView(timelineWithThreads[1]);

export const threadReplies: MessageView[] = [
  messageView(message("r-0955", miyuki, "09:55", "それ、かなり分かりやすいです。入力中の表示も琥珀にそろえますか？")),
  messageView(message("r-0957", you, "09:57", "はい、そろえるつもりです。")),
  messageView(message("r-0957b", you, "09:57", "接続状態のバナーも琥珀にします。", { grouped: true })),
  messageView(message("r-1018", naoki, "10:18", "入力中は琥珀、送信ボタンは緑、で筋が通りますね。")),
];

/** スレッドのパネルの並び（親・「N 件の返信」・返信）。データ層の toThreadTimelineItems と同じ形にする。 */
export function threadItems(root: MessageView, replies: MessageView[]): TimelineItem[] {
  return [
    { type: "message", message: { ...root, thread: undefined, grouped: false } },
    { type: "thread-divider", key: `divider-${root.key}`, replyCount: root.thread?.replyCount ?? 0 },
    ...replies.map((message): TimelineItem => ({ type: "message", message })),
  ];
}

/** 返信がまだない親（「返信」から開いた直後。chat/thread/thread-panel-empty.png）。 */
export const threadRootWithoutReplies: MessageView = messageView(timelineWithThreads[7]);

/** 親が削除されたスレッド（chat/thread/thread-root-deleted.png）。返信は残る。 */
export const deletedThreadRoot: MessageView = {
  ...messageView(message("m-0930", naoki, "09:30", "", { deleted: true })),
  thread: { replyCount: 2, lastReplyLabel: "09:48" },
};

export const deletedThreadReplies: MessageView[] = [
  messageView(message("r-0936", miyuki, "09:36", "消える前に読めました。色の件はこのスレッドで続けましょう。")),
  messageView(message("r-0948", ryo, "09:48", "了解です。まとめは午後に出します。")),
];

/**
 * 「チャンネルにも投稿する」を付けた返信（chat/thread/thread-broadcast.png。ADR 0039）。
 * スレッドでは最後の返信に控えめな注記が付き、チャンネルではルームの seq の位置（10:12 と 10:30 の間）に「スレッドに返信しました」付きで並ぶ。
 */
const broadcastReplyKey = "r-1018";

export const threadRepliesWithBroadcast: MessageView[] = threadReplies.map((reply) =>
  reply.key === broadcastReplyKey ? { ...reply, broadcast: { in: "thread", label: "チャンネルにも投稿しました" } } : reply,
);

export const timelineWithBroadcast: TimelineItem[] = timelineWithThreads.flatMap((item): TimelineItem[] => {
  if (item.type !== "message" || item.message.key !== "m-1012b") return [item];
  const reply = threadReplies.find((r) => r.key === broadcastReplyKey)!;
  return [item, { type: "message", message: { ...reply, grouped: false, broadcast: { in: "channel" } } }];
});

/** 参加しているスレッドの一覧（chat/thread/threads.png）。最後の返信が新しい順。 */
export const threadList: ThreadListItemView[] = [
  {
    key: threadRootKey,
    room: { kind: "public", name: "デザインレビュー" },
    root: { sender: you, timeLabel: "09:41", body: "おはようございます。昨日の続きで、未読まわりを琥珀に寄せてみました。", deleted: false },
    replyCount: 3,
    lastReplyLabel: "10:18",
    unreadCount: 1,
    notifyReplies: true,
    mentionCount: 0,
  },
  {
    key: "m-chat-0930",
    room: { kind: "public", name: "雑談" },
    root: { sender: miyuki, timeLabel: "09:30", body: "近所に新しい喫茶店ができたらしい。今度の金曜、誰か一緒に行きませんか？", deleted: false },
    replyCount: 5,
    lastReplyLabel: "10:02",
    unreadCount: 2,
    notifyReplies: true,
    mentionCount: 0,
  },
  {
    key: "m-release-1740",
    room: { kind: "private", name: "リリース準備" },
    root: { sender: naoki, timeLabel: "昨日", body: "", deleted: true },
    replyCount: 2,
    lastReplyLabel: "昨日",
    unreadCount: 0,
    notifyReplies: true,
    mentionCount: 0,
  },
  {
    key: "m-dm-1612",
    room: { kind: "dm", name: users.naoki.name },
    root: { sender: you, timeLabel: "9月11日", body: "縦バーの件、画面の録画を撮っておきました。あとで見てもらえますか？", deleted: false },
    replyCount: 1,
    lastReplyLabel: "9月11日",
    unreadCount: 0,
    notifyReplies: true,
    mentionCount: 0,
  },
];

/**
 * 返信の通知をオフにしたスレッドの混ざった一覧（ADR 0056 決定 2）。
 * 雑談のスレッドは未読があっても強調せず、リリース準備のスレッドは自分宛てのメンションがあるので `@1` を出す。
 */
export const threadListWithNotifyOff: ThreadListItemView[] = threadList.map((thread) =>
  thread.key === "m-chat-0930"
    ? { ...thread, notifyReplies: false }
    : thread.key === "m-release-1740"
      ? { ...thread, notifyReplies: false, unreadCount: 2, mentionCount: 1 }
      : thread,
);

/** サイドバーの「スレッド」のバッジ（未読のあるスレッドの数）。 */
export const unreadThreadCount = threadList.filter((thread) => thread.unreadCount > 0).length;

/** 返信の通知をオフにしたスレッドは、未読のメンションがなければサイドバーのバッジに数えない（ADR 0056 決定 2）。 */
export const unreadThreadCountWithNotifyOff = threadListWithNotifyOff.filter((thread) =>
  thread.notifyReplies ? thread.unreadCount > 0 : thread.mentionCount > 0,
).length;
