import type { ActivityReason, FollowedThread, Message, NotifyLevel, Room } from "@/lib/api/types.gen";

import { type Block, type Inline, parseBody } from "@/lib/chat/format/body-format";
import { type ChannelTable, channelLabel } from "@/lib/chat/format/channel-links";
import { permalinkPath } from "@/lib/chat/format/links";
import { isMuted } from "./mute";
import { roomName } from "@/lib/chat/views/rooms";

/**
 * ブラウザ通知（ADR 0057）の「出すか」と「何を出すか」。どちらも純粋な関数で、ストアの値を受け取るだけ。
 * 「どのタブも見えていないか」と「許可されているか」は、呼ぶ側（desktop-notifier.ts）が見る。
 */

export type NotifyInput = {
  message: Message;
  /** ログインしている人。 */
  userId: string;
  /** メッセージのルーム。手元にない（一覧を取る前）なら undefined で、出さない。 */
  room: Room | undefined;
  /** そのワークスペースでの全体の設定。取れていなければ既定（mentions）。 */
  level: NotifyLevel | undefined;
  /** スレッドの返信なら、自分の参加中のスレッドの行。参加していなければ undefined。 */
  thread: FollowedThread | undefined;
  now: number;
};

/**
 * 通知の対象になる理由（ADR 0055 決定 1・ADR 0056 決定 3・ADR 0057 決定 1・ADR 0058 決定 2）。空なら対象ではない。
 * ブラウザ通知（shouldNotify）とアクティビティ（activity-feed.ts）が同じ規則を使う。サーバーの db/queries/chat/activity.sql も同じで、
 * 規則の表（testdata/notification-rules.json）を両方のテストが読む。
 *
 * - ミュートしている → 対象にしない（メンションでも）
 * - DM → 全体が none でなければ対象（理由は dm。メンションとスレッドも添える）
 * - それ以外は「通知する内容」（チャンネルの上書き、なければ全体の設定）で決める
 *   - all: チャンネルの投稿はすべて（channel）。スレッドだけの返信は、メンションかスレッドに当たるときだけ
 *   - mentions: 自分宛てのメンションか「スレッド」
 *   - none: 対象にしない
 * - スレッド: 返信で、参加していて返信の通知がオン（thread）
 *
 * `countHere` は `@here` を自分宛てに数えるか。通知では数えない（出すのはどのタブも見えていない、自分が離席のときで、
 * サーバーは `@here` の対象をアクティブな人に絞っている）。アクティビティでは数える（行があるのは送った瞬間にアクティブだった人）。
 */
export function notifyReasons(
  { message, userId, room, level, thread, now }: NotifyInput,
  { countHere }: { countHere: boolean },
): ActivityReason[] {
  if (message.kind !== "user" || message.sender.id === userId || message.deleted_at !== null) return [];
  if (!room || !room.notifications) return [];
  if (isMuted(room.notifications, now)) return [];

  const global = level ?? "mentions";
  const reasons: ActivityReason[] = [];
  const reply = message.thread_root_id !== null;
  const mentioned = mentionsMe(message, userId, countHere);
  const following = reply && (thread?.notify_replies ?? false);

  if (room.kind === "dm") {
    if (global === "none") return [];
    reasons.push("dm");
  } else {
    const effective = room.notifications.level ?? global;
    if (effective === "none") return [];
    const threadOnly = reply && !message.also_in_channel;
    // チャンネルにも出した返信は、チャンネルの投稿としても判定する（どちらかで対象なら出す。ADR 0056 決定 3）
    if (effective === "all" && !threadOnly) reasons.push("channel");
  }
  if (mentioned) reasons.push("mention");
  if (following) reasons.push("thread");
  return reasons.sort();
}

/** 通知するか（ADR 0057 決定 1）。`@here` は理由にしない（notifyReasons の説明）。 */
export function shouldNotify(input: NotifyInput): boolean {
  return notifyReasons(input, { countHere: false }).length > 0;
}

/** 自分宛てか。`<@自分>` と `@channel`、countHere なら `@here` も。 */
function mentionsMe(message: Message, userId: string, countHere: boolean): boolean {
  return message.mentions.some((m) =>
    m.kind === "user" ? m.user?.id === userId : m.kind === "channel" || (countHere && m.kind === "here"),
  );
}

/** 通知 1 件の中身。tag は同じメッセージの通知を OS に置き換えさせるための値（メッセージの ID）。 */
export type NotificationContent = { title: string; body: string; tag: string; url: string };

/** 本文の最大の長さ（ADR 0057 決定 3）。 */
const BODY_MAX = 100;

/**
 * 通知の中身（ADR 0057 決定 3）。タイトルは「送信者（#チャンネル）」、DM は送信者だけ。本文は平文にして 100 文字まで。
 * url は押したときに開く先（ADR 0042 の `?m=`。スレッドの返信は `?t=` でパネルも開く）。
 */
export function notificationContent(message: Message, room: Room, channels: ChannelTable = {}): NotificationContent {
  // メンションの名前はメッセージの mentions に載っている（ADR 0041）。一覧を別に引かない
  const names: Record<string, string> = {};
  for (const m of message.mentions) if (m.user) names[m.user.id] = m.user.display_name;
  const sender = message.sender.display_name;
  const place = room.kind === "dm" ? "" : message.thread_root_id !== null ? `#${roomName(room)} のスレッド` : `#${roomName(room)}`;
  const text = plainText(message.body, names, channels);
  const body = text === "" ? "ファイルを送信しました" : text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}…` : text;
  const url = permalinkPath({
    workspaceId: room.workspace_id,
    roomId: room.id,
    messageId: message.id,
    threadRootId: message.thread_root_id ?? undefined,
  });
  return { title: place === "" ? sender : `${sender}（${place}）`, body, tag: message.id, url };
}

/**
 * 本文を平文にする。書式の記号を外し、メンションを `@名前`、チャンネルへのリンクを `#名前`（ADR 0062 決定 5）、
 * リンクを文字（なければ URL）にする。
 */
export function plainText(body: string, names: Readonly<Record<string, string>>, channels: ChannelTable = {}): string {
  const ctx = { names, channels };
  return parseBody(body).map((b) => blockText(b, ctx)).join(" ").replace(/\s+/gu, " ").trim();
}

type PlainContext = { names: Readonly<Record<string, string>>; channels: ChannelTable };

function blockText(block: Block, ctx: PlainContext): string {
  switch (block.type) {
    case "paragraph":
      return inlineText(block.children, ctx);
    case "code":
      return block.text;
    case "quote":
      return block.children.map((b) => blockText(b, ctx)).join(" ");
    case "list":
      return block.items
        .map((item) => [inlineText(item.children, ctx), ...item.sublists.map((l) => blockText(l, ctx))].join(" "))
        .join(" ");
  }
}

function inlineText(inlines: readonly Inline[], ctx: PlainContext): string {
  return inlines
    .map((i) => {
      switch (i.type) {
        case "text":
        case "code":
          return i.text;
        case "link":
          return i.label ?? i.url;
        case "mention":
          return i.kind === "user" ? `@${ctx.names[i.id] ?? "不明なユーザー"}` : `@${i.kind}`;
        case "channel":
          return channelLabel(ctx.channels, i.id);
        default:
          return inlineText(i.children, ctx);
      }
    })
    .join("");
}
