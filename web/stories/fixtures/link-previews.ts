import type { ComposerLinkPreviewView, LinkPreviewView, MessageView, TimelineItem } from "@/components/chat/types";

import { threadReplies, threadRoot } from "./threads";
import { message, messageView, myMessageKey, timeline } from "./timeline";
import { naoki } from "./users";

/**
 * 外部のリンクのプレビュー（ADR 0065）。
 *
 * サイトは架空のもの（`.example`）。画像とアイコンは public/dev/ のモックで、本物は自前のストレージの署名付き URL（決定 7）。
 * 寸法は実物と同じ値を入れてあるので、枠は読み込み前から正しい大きさになる。
 */

/** 画像・アイコン・説明がそろったカード。画像は OGP の標準の横長（1200×630）なので、上に大きく出る。説明は 2 行で切れる長さにしてある。 */
export const fullPreview: LinkPreviewView = {
  id: "lp-1",
  url: "https://design-notes.example/posts/color-roles",
  siteName: "Design Notes",
  title: "色に役割を持たせる: 「操作できるもの」と「いま起きていること」を分ける",
  description:
    "ボタンやリンクなど押せるものには 1 つの色だけを使い、未読や入力中のような状態の知らせには別の色を使う。2 つを混ぜると、押せない知らせを押そうとしたり、押せるものを見落としたりする。実際のプロダクトでどう分けたかを、画面の例と一緒に紹介します。",
  image: { width: 1200, height: 630, url: "/dev/ogp-1.png" },
  hasIcon: true,
  iconUrl: "/dev/site-icon-1.png",
};

/** 横長ではない画像のカード。右のサムネイルに出る（ADR 0065 の追記）。 */
export const thumbnailPreview: LinkPreviewView = {
  id: "lp-5",
  url: "https://photo-walk.example/2026/09/morning-light",
  siteName: "Photo Walk",
  title: "朝の光で撮る: 窓辺の縦の構図",
  description: "縦に長い窓は、縦の構図で撮ると光の入り方がよく分かる。露出は窓の外に合わせて、室内は少し暗く残す。",
  image: { width: 800, height: 1200, url: "/dev/photo-4.png" },
  hasIcon: true,
  iconUrl: "/dev/site-icon-2.png",
};

/** 画像のないカード（OGP に画像のないページ）。 */
export const textOnlyPreview: LinkPreviewView = {
  id: "lp-2",
  url: "https://type-journal.example/articles/tabular-figures",
  siteName: "Type Journal",
  title: "等幅数字（tabular figures）で表の数字をそろえる",
  description: "時刻や金額のように縦に並ぶ数字は、字幅のそろった数字にすると桁が揃い、視線が上下に動かない。",
  hasIcon: true,
  iconUrl: "/dev/site-icon-2.png",
};

/** アイコンも画像も説明もない、いちばん小さいカード。サイト名は OGP になければホスト名になる（決定 9）。 */
export const minimalPreview: LinkPreviewView = {
  id: "lp-3",
  url: "https://status.example.net/incidents/2026-09-13",
  siteName: "status.example.net",
  title: "9月13日 10:05 ごろの通知の遅延について",
  hasIcon: false,
};

/** 画像のあるカード（2 枚目）。スレッドの返信に付ける。 */
export const threadPreview: LinkPreviewView = {
  id: "lp-4",
  url: "https://ux-weekly.example/2026/09/typing-indicators",
  siteName: "UX Weekly",
  title: "入力中の表示はどこに置くべきか",
  description: "入力欄のすぐ上に置くと、送ろうとしている人の目に入る。チャットアプリ 12 本を比べました。",
  image: { width: 1200, height: 630, url: "/dev/ogp-2.png" },
  hasIcon: true,
  iconUrl: "/dev/site-icon-1.png",
};

/**
 * プレビューのあるタイムライン（chat/link/link-preview.png ほか）。
 * タイムラインはいちばん下から見えるので、下の 3 件に、いちばん小さいカード・画像なし・画像つきを並べる。
 */
export const timelineWithLinkPreviews: TimelineItem[] = timeline.map((item) => {
  if (item.type !== "message") return item;
  switch (item.message.key) {
    case "m-1030":
      return withPreview(item.message, `今朝の通知の遅れはこれでした。 ${minimalPreview.url}`, minimalPreview);
    case "m-1041":
      return withPreview(item.message, `行送りは 1.75 で確定にしましょう。数字の揃え方はこれが参考になりました。 ${textOnlyPreview.url}`, textOnlyPreview);
    case "m-1105":
      return withPreview(item.message, `考え方はこの記事が近いです。\n${fullPreview.url}`, fullPreview);
    default:
      return item;
  }
});

/** サムネイルのカードのあるタイムライン（chat/link/link-preview-thumbnail.png）。いちばん下のカードを差し替える。 */
export const timelineWithThumbnailPreview: TimelineItem[] = timelineWithLinkPreviews.map((item) =>
  item.type === "message" && item.message.key === "m-1105"
    ? withPreview(item.message, `朝の写真はこの記事を参考にしました。\n${thumbnailPreview.url}`, thumbnailPreview)
    : item,
);

/** 本人（あなた）のプレビューのあるメッセージの key。「x」を出す画面で使う。 */
export const myLinkPreviewKey = myMessageKey;

/**
 * 本人のメッセージにプレビューのあるタイムライン（chat/link/link-preview-remove.png）。
 * いちばん下の自分のメッセージを送信済みにして、画像つきのカードを付ける。
 */
export const timelineWithMyLinkPreview: TimelineItem[] = timeline.map((item) =>
  item.type === "message" && item.message.key === myLinkPreviewKey
    ? withPreview({ ...item.message, status: "sent" }, `考え方はこの記事が近いです。\n${fullPreview.url}`, fullPreview)
    : item,
);

function withPreview(m: MessageView, body: string, preview: LinkPreviewView): TimelineItem {
  // 添付を外し、カードだけが本文の下に来るようにする
  return { type: "message", message: { ...m, body, attachments: [], linkPreviews: [preview] } };
}

/** 返信にプレビューのあるスレッド（chat/link/link-preview-thread.png）。 */
export const threadRepliesWithLinkPreview: MessageView[] = [
  // カードがパネルに収まるよう、返信を 2 件に減らす
  threadReplies[0],
  messageView(
    message("r-1018", naoki, "10:18", `入力中は琥珀、送信ボタンは緑、で筋が通りますね。置き場所はこれが参考になりました。 ${threadPreview.url}`, {
      linkPreviews: [threadPreview],
    }),
  ),
];

/** 返信 2 件のスレッドの親（返信を減らしたので数を合わせる）。 */
export const threadRootWithLinkPreview: MessageView = { ...threadRoot, thread: { replyCount: 2, lastReplyLabel: "10:18" } };

/** 入力欄の下書き（URL を貼ったところ）。 */
export const composerLinkDraft = `考え方はこの記事が近いです。 ${fullPreview.url}`;

/** 入力欄のプレビュー（取れたところ）。 */
export const composerLinkPreviews: ComposerLinkPreviewView[] = [
  { url: fullPreview.url, state: "ok", siteName: fullPreview.siteName, title: fullPreview.title, iconUrl: fullPreview.iconUrl },
];

/** 入力欄のプレビュー（取得中）。 */
export const composerLinkPreviewsLoading: ComposerLinkPreviewView[] = [{ url: fullPreview.url, state: "loading" }];
