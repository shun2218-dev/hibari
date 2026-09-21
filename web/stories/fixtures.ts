/**
 * story のモックデータ。docs/ui/screenshots/ の画面と同じ内容にする。
 *
 * ID はアバターの色（ID のハッシュで決まる。lib/avatar.ts）がスクリーンショットと同じになるものを選んである。
 */
import type { DmCandidateView, RoomMemberRowView } from "@/components/chat/room-dialogs";
import type {
  MessageAttachmentView,
  MessageLinkCardView,
  MessageReactionView,
  ProfileView,
  MessageView,
  RoomMemberView,
  RoomSummaryView,
  ThreadListItemView,
  TimelineItem,
  UserRef,
  UserStatusView,
  WorkspaceRef,
} from "@/components/chat/types";
import type { TransferCandidate } from "@/components/workspace/member-dialogs";
import type { InviteRowView, MemberRowView, WorkspaceRole } from "@/components/workspace/types";
import type { DeviceView } from "@/components/settings/settings-sections";
import type { MentionCandidate } from "@/lib/chat/mentions";
import type { PresenceView } from "@/lib/presence";

/**
 * story のモックのアバター画像（public/dev/。Storybook は staticDirs で配る）。
 * 本物は署名付き URL（ADR 0020）で、ここでは静的なファイルで代用する。
 */
export const mockAvatars = {
  you: "/dev/avatar-1.png",
  miyuki: "/dev/avatar-2.png",
  naoki: "/dev/avatar-3.png",
} as const;

export const users = {
  you: { id: "01J8ZH5K000000000000000001", name: "あなた", handle: "you" },
  naoki: { id: "01J8ZH5K000000000000000002", name: "佐藤 直樹", handle: "naoki" },
  miyuki: { id: "01J8ZH5K000000000000000005", name: "高橋 みゆき", handle: "miyuki" },
  ryo: { id: "01J8ZH5K000000000000000008", name: "中村 涼", handle: "nakamura" },
  misaki: { id: "01J8ZH5K000000000000000009", name: "田中 美咲", handle: "misaki" },
  suzuki: { id: "01J8ZH5K00000000000000000B", name: "鈴木 涼", handle: "ryo" },
  haru: { id: "01J8ZH5K00000000000000000G", name: "小林 陽向", handle: "haru" },
  kei: { id: "01J8ZH5K00000000000000000H", name: "森田 圭", handle: "kei" },
} as const;

export const workspaces = {
  dev: { id: "01J8ZH5K00000000000000000N", name: "hibari 開発" },
  memo: { id: "01J8ZH5K00000000000000000Q", name: "個人メモ" },
  yama: { id: "01J8ZH5K00000000000000000R", name: "山と印刷" },
} satisfies Record<string, WorkspaceRef>;

export const currentUser: UserRef = users.you;

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

const you = { id: users.you.id, name: users.you.name };
const naoki = { id: users.naoki.id, name: users.naoki.name };
const miyuki = { id: users.miyuki.id, name: users.miyuki.name };
const ryo = { id: users.ryo.id, name: users.ryo.name };


function message(
  key: string,
  sender: UserRef,
  timeLabel: string,
  body: string,
  extra: Partial<Extract<TimelineItem, { type: "message" }>["message"]> = {},
): TimelineItem {
  return {
    type: "message",
    message: { key, sender, timeLabel, body, status: "sent", deleted: false, edited: false, attachments: [], grouped: false, ...extra },
  };
}

/** 送信中のメッセージの key。ホバーの再現に使う。 */
export const pendingMessageKey = "m-1052";

export const timeline: TimelineItem[] = [
  { type: "date", key: "d-0912", label: "2026年9月12日" },
  message("m-1402", miyuki, "14:02", "新しいチャンネル一覧のモック、共有フォルダに置きました。行の高さを少し詰めた版も一緒に入れてあります。", {
    attachments: [{ kind: "image", id: "a-1", fileName: "サイドバー改訂 01", width: 260, height: 160 }],
  }),
  message("m-1402b", miyuki, "14:02", "未読バッジの色だけ、まだ迷っています。", { grouped: true }),
  message("m-1411", naoki, "14:11", "", { deleted: true }),
  message("m-1420", ryo, "14:20", "未読バッジは押せる要素ではないので、ボタンと同じ色にしないほうがいいと思います。"),
  { type: "date", key: "d-0913", label: "2026年9月13日" },
  message("m-0941", you, "09:41", "おはようございます。昨日の続きで、未読まわりを琥珀に寄せてみました。"),
  message("m-0941b", you, "09:41", "緑はボタンとリンク、選択中のチャンネルだけに残しています。", { grouped: true }),
  message("m-0941c", you, "09:41", "「いま起きていること」は琥珀、「操作できるもの」は緑、という分け方です。", { grouped: true }),
  message("m-0955", miyuki, "09:55", "それ、かなり分かりやすいです。入力中の表示も琥珀にそろえますか？"),
  message("m-0957", you, "09:57", "はい、そろえるつもりです。", { status: "failed" }),
  message("m-1012", naoki, "10:12", "賛成です。あとサイドバーの選択中の行、左の縦バーは 2px で十分でした。"),
  message("m-1012b", naoki, "10:12", "4px だと主張が強すぎて、名前より先に目が行ってしまう。", { grouped: true, edited: true }),
  message("m-1030", ryo, "10:30", "タイムスタンプを等幅にしたの、地味に効いてますね。数字が揃うと視線が上下に動かない。"),
  message("m-1041", miyuki, "10:41", "行送りは 1.75 で確定にしましょう。半日開きっぱなしでも目が疲れませんでした。", {
    attachments: [{ kind: "file", id: "a-2", fileName: "hibari-type-scale.pdf", sizeLabel: "248 KB" }],
  }),
  message(pendingMessageKey, you, "10:52", "了解です。今日の夕方までに一覧を更新して、また共有します。", { status: "pending" }),
  { type: "unread", key: "unread" },
  message("m-1105", ryo, "11:05", "ありがとうございます。こちらはメンバー一覧の presence 表示を確認しておきます。"),
];

/**
 * 本文に貼られたパーマリンクのカード（chat/link/message-link-card.png。ADR 0040）。
 * 読めるリンクは中身を出し、読めない・存在しない・削除済みは区別せずに「表示できません」にする。
 */
const linkCards: MessageLinkCardView[] = [
  {
    key: "card-ok",
    state: "ok",
    href: "#",
    room: { kind: "private", name: "リリース準備" },
    sender: miyuki,
    timeLabel: "昨日",
    body:
      "リリースの手順、いったん書き出しました。develop から release ブランチを切って、バージョンを更新して、main への PR を作ってマージ、そのあと develop にも戻す PR を作ります。タグは main のマージコミットに打って、最後に Releases でリリースノートを書く、という流れです。ここまでで詰まりそうなところがあれば教えてください。次のリリースからは手順書として使えるように、このメッセージをピン留めしておくつもりです。手順の細かいところは ADR とロードマップにも書いてあるので、あわせて見てもらえると助かります。抜けがあれば、このスレッドで指摘してください。",
    clampedBody:
      "リリースの手順、いったん書き出しました。develop から release ブランチを切って、バージョンを更新して、main への PR を作ってマージ、そのあと develop にも戻す PR を作ります。タグは main のマージコミットに打って、最後に Releases でリリースノートを書く、という流れです。ここまでで詰まりそうなところがあれば教えてください。次のリリースからは手順書として使えるように、このメッセージをピン留めしておくつもりです。手順の細かいところは ADR とロードマップにも書いてあるので、あわせて見てもらえると助かります。抜けがあれば、このスレッドで指摘してくださ…",
    clamped: true,
    attachmentCount: 1,
    inThread: false,
  },
  { key: "card-unavailable", state: "unavailable" },
];

/** 本文にリンクを貼ったタイムライン（chat/link/message-link-card.png）。 */
export const timelineWithLinkCards: TimelineItem[] = timeline.map((item) =>
  item.type === "message" && item.message.key === "m-1030"
    ? {
        type: "message",
        message: {
          ...item.message,
          body: "手順はこのメッセージにまとまっています。あとこっちも見てもらえますか。",
          linkCards,
        },
      }
    : item,
);

// ---- 絵文字のリアクション（ADR 0044）----

/** リアクションの付いているメッセージの key（chat/reaction/reaction-names.png のホバーに使う）。 */
export const reactedMessageKey = "m-1030";

/** ピッカーを開いているメッセージの key（chat/reaction/reaction-picker.png）。まだ何も付いていない行から開く。 */
export const reactionPickerKey = "m-1012";

/**
 * いちばん下のメッセージの key（chat/reaction/reaction-picker-above.png）。
 * ここで開くと下に入りきらないので、ピッカーは上に開く。
 */
export const lastMessageKey = "m-1105";

/** ホバーで名前を出しているリアクション（chat/reaction/reaction-names.png）。 */
export const hoveredReaction = { key: reactedMessageKey, emoji: "👍" };

const reactionsByKey: Record<string, MessageReactionView[]> = {
  // 自分が付けているもの（緑）と、付けていないもの（枠だけ）を 1 行に並べる
  [reactedMessageKey]: [
    { emoji: "👍", count: 5, me: true, names: [users.miyuki.name, users.ryo.name, users.you.name] },
    { emoji: "🎉", count: 2, me: false, names: [users.naoki.name, users.misaki.name] },
    { emoji: "👀", count: 1, me: false, names: [users.haru.name] },
  ],
  // 1 種類だけ・自分は付けていない
  "m-1105": [{ emoji: "💯", count: 1, me: false, names: [users.miyuki.name] }],
  // 数の多いもの。名前は先頭 8 人までしか来ないので「他 N 人」になる（ADR 0044 決定 3）
  "m-1041": [
    {
      emoji: "🙏",
      count: 12,
      me: true,
      names: [users.you.name, users.naoki.name, users.ryo.name, users.misaki.name],
    },
  ],
};

/** リアクションの付いたタイムライン（chat/reaction/reactions.png）。 */
export const timelineWithReactions: TimelineItem[] = timeline.map((item) =>
  item.type === "message" && reactionsByKey[item.message.key] !== undefined
    ? { type: "message", message: { ...item.message, reactions: reactionsByKey[item.message.key] } }
    : item,
);

// ---- 添付ファイルの拡大表示と削除（ADR 0045）----

/**
 * 拡大表示に出すモックの画像（public/dev/）。本物は署名付き URL（ADR 0028）で、ここでは静的なファイルで代用する。
 * 寸法は実物と同じ値を入れてあるので、タイムラインの枠も読み込み前から正しい大きさになる（ADR 0013）。
 */
export const imageAttachments: MessageAttachmentView[] = [
  { kind: "image", id: "a-3", fileName: "サイドバー改訂 01.png", url: "/dev/photo-1.png", width: 1200, height: 800 },
  { kind: "image", id: "a-4", fileName: "サイドバー改訂 02.png", url: "/dev/photo-2.png", width: 1200, height: 800 },
  { kind: "image", id: "a-5", fileName: "サイドバー改訂 03.png", url: "/dev/photo-3.png", width: 1200, height: 800 },
];

/** 1 枚だけ付いているメッセージの画像（縦長。拡大表示で上下に余白が出る）。 */
export const singleImageAttachment: MessageAttachmentView = {
  kind: "image",
  id: "a-6",
  fileName: "未読バッジの候補.png",
  url: "/dev/photo-4.png",
  width: 800,
  height: 1200,
};

/** 画像とファイルを付けたメッセージの key（拡大表示とファイルのメニューの画面で使う）。 */
export const attachmentMessageKey = "m-1041";

/**
 * 画像 3 枚とファイル 1 件を付けたタイムライン（chat/attachment/image-viewer.png、chat/attachment/attachment-menu.png）。
 * 1 枚だけの画像は、上のメッセージ（m-1402）をモックの画像に差し替えて出す。
 */
export const timelineWithImages: TimelineItem[] = timeline.map((item) => {
  if (item.type !== "message") return item;
  if (item.message.key === attachmentMessageKey) {
    return { type: "message", message: { ...item.message, attachments: [...item.message.attachments, ...imageAttachments] } };
  }
  if (item.message.key === "m-1402") {
    return { type: "message", message: { ...item.message, attachments: [singleImageAttachment] } };
  }
  return item;
});

/** 拡大表示に渡す画像（そのメッセージのインライン表示の画像だけ。ADR 0045 決定 2）。 */
export const viewerImages = imageAttachments.map((attachment) => ({
  id: attachment.id,
  fileName: attachment.fileName,
  url: attachment.kind === "image" ? attachment.url : undefined,
}));

/** 1 枚だけの画像を開いたときに拡大表示に渡すもの（送る導線が出ない）。 */
export const singleViewerImage = {
  id: singleImageAttachment.id,
  fileName: singleImageAttachment.fileName,
  url: singleImageAttachment.kind === "image" ? singleImageAttachment.url : undefined,
};

/** 拡大表示から削除するときのファイル名（chat/attachment/attachment-delete-dialog.png）。 */
export const deletedAttachmentName = imageAttachments[1].fileName;

/** 飛んできた先の key（chat/link/jump-highlight.png。ADR 0042）。 */
export const jumpTargetKey = "m-1012";

/**
 * 飛ぶ動きの画面（ADR 0042）のタイムライン。「ここから未読」の線を外してある。
 * 未読のバーは「未読が読み込んだページより古い」ときにだけ出るので、線とは同時に出ない。
 */
export const timelineJumped: TimelineItem[] = timeline.filter((item) => item.type !== "unread");

/**
 * 参加や名前の変更のログを挟んだタイムライン（chat/timeline/system-messages.png。ADR 0033）。
 * ログは人の発言ではないので、アバターも名前も出さず、中央に控えめに置く。
 */
export const timelineWithSystemMessages: TimelineItem[] = [
  { type: "date", key: "d-0913", label: "2026年9月13日" },
  { type: "system", key: "s-created", text: "あなた がこのチャンネルを作成しました", timeLabel: "09:30" },
  { type: "system", key: "s-joined-naoki", text: "佐藤 直樹 がチャンネルに参加しました", timeLabel: "09:31" },
  { type: "system", key: "s-joined-miyuki", text: "高橋 みゆき がチャンネルに参加しました", timeLabel: "09:33" },
  message("m-0941", you, "09:41", "おはようございます。昨日の続きで、未読まわりを琥珀に寄せてみました。"),
  message("m-0955", miyuki, "09:55", "それ、かなり分かりやすいです。"),
  {
    type: "system",
    key: "s-renamed",
    text: "あなた がチャンネル名を 雑談 から デザインレビュー に変更しました",
    timeLabel: "10:02",
  },
  message("m-1012", naoki, "10:12", "名前、こちらのほうが分かりやすいです。"),
  { type: "system", key: "s-left", text: "中村 涼 がチャンネルを退出しました", timeLabel: "10:20" },
];

/**
 * 画像を設定している人と、していない人が混ざった状態（chat/timeline/avatar-images.png）。
 * 一覧では、画像のある人だけが差し替わる。
 */
export const timelineWithAvatars: TimelineItem[] = timeline.map((item) => {
  if (item.type !== "message") return item;
  const avatarUrl = { [users.miyuki.id]: mockAvatars.miyuki, [users.naoki.id]: mockAvatars.naoki }[item.message.sender.id];
  if (!avatarUrl) return item;
  return { ...item, message: { ...item.message, sender: { ...item.message.sender, avatarUrl } } };
});

// ---- スレッド（ADR 0036）----

function messageView(item: TimelineItem): MessageView {
  if (item.type !== "message") throw new Error("message ではない");
  return item.message;
}

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
    unreadCount: 1
  },
  {
    key: "m-chat-0930",
    room: { kind: "public", name: "雑談" },
    root: { sender: miyuki, timeLabel: "09:30", body: "近所に新しい喫茶店ができたらしい。今度の金曜、誰か一緒に行きませんか？", deleted: false },
    replyCount: 5,
    lastReplyLabel: "10:02",
    unreadCount: 2
  },
  {
    key: "m-release-1740",
    room: { kind: "private", name: "リリース準備" },
    root: { sender: naoki, timeLabel: "昨日", body: "", deleted: true },
    replyCount: 2,
    lastReplyLabel: "昨日",
    unreadCount: 0
  },
  {
    key: "m-dm-1612",
    room: { kind: "dm", name: users.naoki.name },
    root: { sender: you, timeLabel: "9月11日", body: "縦バーの件、画面の録画を撮っておきました。あとで見てもらえますか？", deleted: false },
    replyCount: 1,
    lastReplyLabel: "9月11日",
    unreadCount: 0
  },
];

/** サイドバーの「スレッド」のバッジ（未読のあるスレッドの数）。 */
export const unreadThreadCount = threadList.filter((thread) => thread.unreadCount > 0).length;

/**
 * メンションのあるタイムライン（ADR 0043）。本文は保存される形のトークンで持ち、表示のときに名前へ置き換える。
 * 自分宛て（`mentionsMe`）の行だけ琥珀にする。
 */
export const timelineWithMentions: TimelineItem[] = [
  { type: "date", key: "d-0913m", label: "2026年9月13日" },
  message("m-m01", miyuki, "10:02", `<@${users.you.id}> サイドバーのバッジの色、決まりました？`, {
    mentionNames: { [users.you.id]: users.you.name },
    mentionsMe: true,
  }),
  message("m-m02", you, "10:04", `<@${users.miyuki.id}> 琥珀で確定です。緑は押せるものだけに残します。`, {
    mentionNames: { [users.miyuki.id]: users.miyuki.name },
  }),
  message("m-m03", ryo, "10:20", "<!here> いまから 10 分だけ、配色の確認に付き合える人いますか？", { mentionsMe: true }),
  message("m-m04", naoki, "10:26", `<!channel> 金曜のリリース、<@${users.you.id}> が手順をまとめてくれています。`, {
    mentionNames: { [users.you.id]: users.you.name },
    mentionsMe: true,
  }),
  message("m-m05", naoki, "10:27", "確認だけお願いします。", { grouped: true }),
];

/**
 * 書式のあるタイムライン（ADR 0051）。本文は保存される形（mrkdwn 寄りの記法）のまま持ち、表示のときに解釈する。
 * 最後の行は、HTML を書いても文字のまま出ることを見せる。
 */
export const timelineWithFormatting: TimelineItem[] = [
  { type: "date", key: "d-0914f", label: "2026年9月14日" },
  message(
    "m-f01",
    naoki,
    "10:02",
    "金曜のリリースの手順です。*本番の前に必ずステージングで確認*してください。\n1. `make migrate` を流す\n2. ステージングで確認する\n  - ログイン・送信・_再接続_\n  - 添付のアップロード\n3. 本番に出す",
  ),
  message("m-f02", naoki, "10:03", "手順書は https://example.com/runbook/release にまとめてあります。~木曜~ 金曜の 17 時からです。", {
    grouped: true,
  }),
  message("m-f03", miyuki, "10:10", "> 本番の前に必ずステージングで確認\n了解です。マイグレーションはこれで合っていますか？\n```\nmake migrate\ngo run ./cmd/server -check\n```", {
    edited: true,
  }),
  message("m-f04", ryo, "10:15", "ドキュメントに `<script>` と書いたら消えないか試します: <script>alert(1)</script>"),
];

/** メンションの未読があるサイドバー（バッジが `@N` になる。ADR 0043）。 */
export const roomsWithMentions: RoomSummaryView[] = rooms.map((room) =>
  room.id === "room-chat"
    ? { ...room, unreadCount: 7, mentionCount: 2 }
    : room.id === "room-release"
      ? { ...room, unreadCount: 3, mentionCount: 0 }
      : room,
);

/** `@` の補完に出す候補（ルームのメンバーと全員宛て。ADR 0043）。 */
export const mentionCandidates: MentionCandidate[] = [
  { kind: "user", id: users.naoki.id, handle: users.naoki.handle, name: users.naoki.name },
  { kind: "user", id: users.miyuki.id, handle: users.miyuki.handle, name: users.miyuki.name },
  { kind: "user", id: users.ryo.id, handle: users.ryo.handle, name: users.ryo.name },
  { kind: "user", id: users.misaki.id, handle: users.misaki.handle, name: users.misaki.name },
  { kind: "channel", description: "このチャンネルの全員" },
  { kind: "here", description: "いまオンラインの人" },
];

export const roomMembers: RoomMemberView[] = [
  { ...naoki, presence: "online", roleLabel: "オーナー" },
  { ...miyuki, presence: "online", roleLabel: "管理者" },
  { ...you, presence: "online", roleLabel: "メンバー" },
  { ...ryo, presence: "offline", roleLabel: "メンバー" },
];

export const typingNames = [users.miyuki.name];

// ---- 離席とカスタムステータス（ADR 0049。chat/presence/） ----

/** 自分のステータス。アカウントメニューと設定のダイアログに出す。 */
export const myStatus: UserStatusView = { emoji: "🍵", text: "休憩中", expiresLabel: "今日 17:00 まで" };

/** 誰がどのステータスを出しているか。名前の横・メンバーパネル・サイドバーの DM で同じ表を使う。 */
const statuses: Readonly<Record<string, UserStatusView>> = {
  [users.naoki.id]: { emoji: "📅", text: "会議中", expiresLabel: "11:30 まで" },
  [users.miyuki.id]: { emoji: "🎧", text: "集中しています" },
  [users.ryo.id]: { emoji: "🌴", text: "休暇中" },
};

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

/** 名前の横にステータスの絵文字が出るタイムライン。文言はホバーでだけ読める（ADR 0049 決定 10）。 */
export const timelineWithStatus: TimelineItem[] = timeline.map((item) =>
  item.type === "message" && statuses[item.message.sender.id]
    ? { ...item, message: { ...item.message, sender: { ...item.message.sender, status: statuses[item.message.sender.id] } } }
    : item,
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

// ---- ワークスペースの管理（山と印刷） ----

export const lockedReason = "自分と同じか上のロールのメンバーは変更できません。";

type Viewer = Exclude<WorkspaceRole, never>;

const roster: Array<{ user: (typeof users)[keyof typeof users]; presence: PresenceView; role: WorkspaceRole }> = [
  { user: users.you, presence: "online", role: "owner" },
  { user: users.naoki, presence: "online", role: "admin" },
  { user: users.misaki, presence: "online", role: "admin" },
  { user: users.suzuki, presence: "offline", role: "member" },
  { user: users.haru, presence: "offline", role: "member" },
  { user: users.kei, presence: "offline", role: "member" },
];

const rank: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };

/**
 * 表示する人の立場ごとのメンバー一覧。スクリーンショットでは、オーナーの画面は「あなた」がオーナー、
 * 管理者とメンバーの画面は佐藤 直樹がオーナーで「あなた」が 3 番目に並ぶ。
 * 操作できるかは canManage（actor のロールが target より上）と canGrant（actor 以下で owner 以外）で決める。
 */
export function membersAs(viewer: Viewer): MemberRowView[] {
  const people: typeof roster =
    viewer === "owner"
      ? roster
      : [
          { user: users.naoki, presence: "online" as const, role: "owner" as const },
          { user: users.misaki, presence: "online" as const, role: "admin" as const },
          { user: users.you, presence: "online", role: viewer },
          ...roster.slice(3),
        ];
  return people.map(({ user, presence, role }) => {
    const canManage = user.id !== users.you.id && rank[viewer] > rank[role];
    return {
      id: user.id,
      name: user.name,
      handle: user.handle,
      presence,
      role,
      isSelf: user.id === users.you.id,
      manage: canManage
        ? {
            kind: "menu",
            grantableRoles: (["admin", "member"] as const).filter((r) => rank[r] <= rank[viewer]),
            canRemove: true,
          }
        : { kind: "locked", reason: lockedReason },
    };
  });
}

export function invitesAs(viewer: Viewer): InviteRowView[] {
  const admin = viewer !== "member";
  return [
    { id: "i-1", status: "active", createdByName: users.misaki.name, usesLabel: "3 / 10 回使用", expiryLabel: "9月20日 18:00 まで", canRevoke: admin },
    { id: "i-2", status: "exhausted", createdByName: users.naoki.name, usesLabel: "10 / 10 回使用", expiryLabel: "9月30日 09:00 まで", canRevoke: admin },
    { id: "i-3", status: "expired", createdByName: users.misaki.name, usesLabel: "1 / 無制限 回使用", expiryLabel: "9月1日 12:00 に失効", canRevoke: admin },
    { id: "i-4", status: "revoked", createdByName: users.you.name, usesLabel: "2 / 5 回使用", expiryLabel: "9月18日 20:00 まで", canRevoke: true },
  ];
}

export const transferCandidates: TransferCandidate[] = [
  { id: users.naoki.id, name: users.naoki.name, handle: users.naoki.handle, role: "admin" },
  { id: users.misaki.id, name: users.misaki.name, handle: users.misaki.handle, role: "admin" },
  { id: users.suzuki.id, name: users.suzuki.name, handle: users.suzuki.handle, role: "member" },
  { id: users.haru.id, name: users.haru.name, handle: users.haru.handle, role: "member" },
  { id: users.kei.id, name: users.kei.name, handle: users.kei.handle, role: "member" },
];

export const devices: DeviceView[] = [
  { id: "s-1", kind: "browser", name: "Chrome · macOS", lastActiveLabel: "現在アクティブ", current: true },
  { id: "s-2", kind: "phone", name: "hibari for iOS · iPhone 15", lastActiveLabel: "2分前", current: false },
  { id: "s-3", kind: "desktop", name: "hibari for macOS · MacBook Air", lastActiveLabel: "昨日 18:24", current: false },
  { id: "s-4", kind: "browser", name: "Safari · iPadOS", lastActiveLabel: "3日前", current: false },
  { id: "s-5", kind: "desktop", name: "Firefox · Windows 11", lastActiveLabel: "9月2日", current: false },
];


// ---- プロフィールのカード（Phase 6.9。ADR 0050） ----

/** ホバーのカードを出すメッセージ。どれもアバターと名前のある先頭の行。 */
export const profileKeys = { naoki: "m-1012", ryo: "m-1030", miyuki: "m-0955", you: "m-0941", former: "m-1420" } as const;

/** 外された人（森田 圭）の過去のメッセージがあるタイムライン。ステータスの表と合わせる。 */
export const timelineWithFormerMember: TimelineItem[] = timelineWithStatus.map((item) =>
  item.type === "message" && item.message.key === profileKeys.former
    ? { ...item, message: { ...item.message, sender: { id: users.kei.id, name: users.kei.name } } }
    : item,
);

const cardUser = (user: { id: string; name: string; handle: string }) => ({
  id: user.id,
  name: user.name,
  handle: user.handle,
  status: statuses[user.id],
});

/** カードとパネルの中身。名前・ロール・presence・ステータスはメンバーパネル（roomMembersWithPresence）とそろえる。 */
export const profiles = {
  /** 他人（オーナー）。member の自分からは管理の入口が出ない。 */
  naoki: {
    kind: "member",
    user: cardUser(users.naoki),
    presence: "online",
    role: "owner",
    email: { state: "ready", value: "naoki.sato@example.com" },
    isSelf: false,
  },
  /** 管理者の自分から見た member。ロールの変更と削除が出る。 */
  ryo: {
    kind: "member",
    user: cardUser(users.ryo),
    presence: "offline",
    role: "member",
    email: { state: "ready", value: "ryo.nakamura@example.com" },
    isSelf: false,
    manage: { grantableRoles: ["admin", "member"], canRemove: true },
  },
  /** email の応答を待っている（行の高さだけ先に取る）。 */
  miyukiLoading: {
    kind: "member",
    user: cardUser(users.miyuki),
    presence: "away",
    role: "admin",
    email: { state: "loading" },
    isSelf: false,
  },
  /** email が未検証（行もコピーも出さない。決定 2）。 */
  miyukiUnverified: {
    kind: "member",
    user: cardUser(users.miyuki),
    presence: "away",
    role: "admin",
    email: { state: "none" },
    isSelf: false,
  },
  you: {
    kind: "member",
    user: { ...cardUser(users.you), status: myStatus },
    presence: "online",
    role: "member",
    email: { state: "ready", value: "you@example.com" },
    isSelf: true,
  },
  /** 外された人。メッセージが持っている名前・handle・アバターだけ（決定 5）。 */
  former: { kind: "former", user: { id: users.kei.id, name: users.kei.name, handle: users.kei.handle } },
} satisfies Record<string, ProfileView>;
