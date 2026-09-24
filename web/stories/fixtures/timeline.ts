import type { MessageView, TimelineItem, UserRef } from "@/components/chat/types";
import type { MentionCandidate } from "@/lib/chat/format/mentions";

import { channelIds } from "./rooms";
import { miyuki, mockAvatars, naoki, profileKeys, ryo, statuses, users, you } from "./users";

/**
 * タイムラインのメッセージ（ADR 0018 の表示用の型）。
 */
export function message(
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
  { type: "date", key: "d-0912", label: "9月12日" },
  message("m-1402", miyuki, "14:02", "新しいチャンネル一覧のモック、共有フォルダに置きました。行の高さを少し詰めた版も一緒に入れてあります。", {
    attachments: [{ kind: "image", id: "a-1", fileName: "サイドバー改訂 01", width: 260, height: 160 }],
  }),
  message("m-1402b", miyuki, "14:02", "未読バッジの色だけ、まだ迷っています。", { grouped: true }),
  message("m-1411", naoki, "14:11", "", { deleted: true }),
  message("m-1420", ryo, "14:20", "未読バッジは押せる要素ではないので、ボタンと同じ色にしないほうがいいと思います。"),
  { type: "date", key: "d-0913", label: "9月13日" },
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
 * いちばん下のメッセージの key（chat/reaction/reaction-picker-above.png）。
 * ここで開くと下に入りきらないので、ピッカーは上に開く。
 */
export const lastMessageKey = "m-1105";

/** ホバーの操作の名前を出すメッセージ（chat/message/hover-tooltip.png）。 */
export const hoverTooltipKey = "m-1030";

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
  { type: "date", key: "d-0913", label: "9月13日" },
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

/** アーカイブしたルームのタイムライン（chat/archive/room.png。ADR 0059）。最後の行がアーカイブのログになる。 */
export const timelineArchived: TimelineItem[] = [
  { type: "date", key: "d-0912", label: "9月12日" },
  message("m-1402", miyuki, "14:02", "新しいチャンネル一覧のモック、共有フォルダに置きました。"),
  message("m-1410", naoki, "14:10", "ありがとうございます。今日中に見ます。"),
  message("m-1655", you, "16:55", "レビューは全部終わったので、このチャンネルはアーカイブしておきます。続きは #雑談 でお願いします。"),
  { type: "system", key: "s-archived", text: "あなた がチャンネルをアーカイブしました", timeLabel: "16:56" },
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

export function messageView(item: TimelineItem): MessageView {
  if (item.type !== "message") throw new Error("message ではない");
  return item.message;
}

/**
 * メンションのあるタイムライン（ADR 0043）。本文は保存される形のトークンで持ち、表示のときに名前へ置き換える。
 * 自分宛て（`mentionsMe`）の行だけ琥珀にする。
 */
export const timelineWithMentions: TimelineItem[] = [
  { type: "date", key: "d-0913m", label: "9月13日" },
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
 * チャンネルへのリンクのあるタイムライン（ADR 0062）。public は `#名前`、private は鍵、引けないものは「アクセスできないチャンネル」。
 */
export const timelineWithChannelLinks: TimelineItem[] = [
  { type: "date", key: "d-0913c", label: "9月13日" },
  message("m-c01", miyuki, "10:02", `配色の話は <#${channelIds.design}> に移しましょう。雑談は <#${channelIds.chat}> で。`),
  message("m-c02", naoki, "10:14", `リリースの手順は <#${channelIds.release}> にまとめました。`),
  message("m-c03", ryo, "10:20", `前に <#${channelIds.hidden}> で話した件、どうなりました？`),
];

/**
 * 書式のあるタイムライン（ADR 0051）。本文は保存される形（mrkdwn 寄りの記法）のまま持ち、表示のときに解釈する。
 * 最後の行は、HTML を書いても文字のまま出ることを見せる。
 */
export const timelineWithFormatting: TimelineItem[] = [
  { type: "date", key: "d-0914f", label: "9月14日" },
  message(
    "m-f01",
    naoki,
    "10:02",
    "金曜のリリースの手順です。*本番の前に必ずステージングで確認*してください。\n1. `make migrate` を流す\n2. ステージングで確認する\n  - ログイン・送信・_再接続_\n  - 添付のアップロード\n    - 画像とファイルの両方\n3. 本番に出す",
  ),
  message("m-f02", naoki, "10:03", "手順は<https://example.com/runbook/release|リリースの手順書>に、画面は https://example.com/screens にあります。~木曜~ __金曜の 17 時__からです。", {
    grouped: true,
  }),
  message("m-f03", miyuki, "10:10", "> 本番の前に必ずステージングで確認\n了解です。マイグレーションはこれで合っていますか？\n```\nmake migrate\ngo run ./cmd/server -check\n```", {
    edited: true,
  }),
  message("m-f04", ryo, "10:15", "ドキュメントに `<script>` と書いたら消えないか試します: <script>alert(1)</script>"),
];

/** `@` の補完に出す候補（ルームのメンバーと全員宛て。ADR 0043）。 */
export const mentionCandidates: MentionCandidate[] = [
  { kind: "user", id: users.naoki.id, handle: users.naoki.handle, name: users.naoki.name },
  { kind: "user", id: users.miyuki.id, handle: users.miyuki.handle, name: users.miyuki.name },
  { kind: "user", id: users.ryo.id, handle: users.ryo.handle, name: users.ryo.name },
  { kind: "user", id: users.misaki.id, handle: users.misaki.handle, name: users.misaki.name },
  { kind: "channel", description: "このチャンネルの全員" },
  { kind: "here", description: "いまオンラインの人" },
];

/** 名前の横にステータスの絵文字が出るタイムライン。文言はホバーでだけ読める（ADR 0049 決定 10）。 */
export const timelineWithStatus: TimelineItem[] = timeline.map((item) =>
  item.type === "message" && statuses[item.message.sender.id]
    ? { ...item, message: { ...item.message, sender: { ...item.message.sender, status: statuses[item.message.sender.id] } } }
    : item,
);

/** 外された人（森田 圭）の過去のメッセージがあるタイムライン。ステータスの表と合わせる。 */
export const timelineWithFormerMember: TimelineItem[] = timelineWithStatus.map((item) =>
  item.type === "message" && item.message.key === profileKeys.former
    ? { ...item, message: { ...item.message, sender: { id: users.kei.id, name: users.kei.name } } }
    : item,
);

/** DM のタイムライン。 */
export const dmTimeline: TimelineItem[] = [
  { type: "date", key: "d-0912", label: "9月12日" },
  message("m-dm-1010", naoki, "10:10", "サイドバーの縦バー、選択中だけ緑にする案で進めてよさそうです。"),
  message("m-dm-1012", you, "10:12", "ありがとうございます。ホバーの色も合わせて直しておきます。"),
  message("m-dm-1014", naoki, "10:14", "縦バーの件、あとで画面で見ます"),
];
