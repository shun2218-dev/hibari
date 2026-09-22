import type { FollowedThread, Message, NotifyLevel, Room } from "@/lib/api/types.gen";

import { type Block, type Inline, parseBody } from "./body-format";
import { permalinkPath } from "./links";
import { isMuted } from "./notifications";
import { roomName } from "./views";

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
 * 通知するか（ADR 0057 決定 1。規則は ADR 0055 決定 1 と ADR 0056 決定 3）。
 *
 * - ミュートしている → 出さない（メンションでも）
 * - DM → 全体が none でなければ出す
 * - それ以外は「通知する内容」（チャンネルの上書き、なければ全体の設定）で決める
 *   - all: チャンネルの投稿はすべて。スレッドだけの返信は「スレッド」に当たるときだけ
 *   - mentions: 自分宛てのメンションか「スレッド」
 *   - none: 出さない
 * - スレッド: スレッドだけの返信で、自分宛てのメンションがあるか、参加していて返信の通知がオン
 *
 * `@here` は理由にしない。通知を出すのはどのタブも見えていない（自分が離席の）ときで、サーバーは `@here` の対象をアクティブな人に絞っている。
 */
export function shouldNotify({ message, userId, room, level, thread, now }: NotifyInput): boolean {
  if (message.kind !== "user" || message.sender.id === userId || message.deleted_at !== null) return false;
  if (!room || !room.notifications) return false;
  if (isMuted(room.notifications, now)) return false;

  const global = level ?? "mentions";
  if (room.kind === "dm") return global !== "none";

  const effective = room.notifications.level ?? global;
  if (effective === "none") return false;

  const mentioned = mentionsMe(message, userId);
  const threadOnly = message.thread_root_id !== null && !message.also_in_channel;
  const threadHit = message.thread_root_id !== null && (mentioned || (thread?.notify_replies ?? false));
  if (threadOnly) return threadHit;
  // チャンネルにも出した返信は、チャンネルの投稿としても判定する（どちらかで対象なら出す。ADR 0056 決定 3）
  if (effective === "all") return true;
  return mentioned || threadHit;
}

/** 自分宛てか。`<@自分>` と `@channel`。`@here` は数えない（shouldNotify の説明）。 */
function mentionsMe(message: Message, userId: string): boolean {
  return message.mentions.some((m) => (m.kind === "user" ? m.user?.id === userId : m.kind === "channel"));
}

/** 通知 1 件の中身。tag は同じメッセージの通知を OS に置き換えさせるための値（メッセージの ID）。 */
export type NotificationContent = { title: string; body: string; tag: string; url: string };

/** 本文の最大の長さ（ADR 0057 決定 3）。 */
const BODY_MAX = 100;

/**
 * 通知の中身（ADR 0057 決定 3）。タイトルは「送信者（#チャンネル）」、DM は送信者だけ。本文は平文にして 100 文字まで。
 * url は押したときに開く先（ADR 0042 の `?m=`。スレッドの返信は `?t=` でパネルも開く）。
 */
export function notificationContent(message: Message, room: Room): NotificationContent {
  // メンションの名前はメッセージの mentions に載っている（ADR 0041）。一覧を別に引かない
  const names: Record<string, string> = {};
  for (const m of message.mentions) if (m.user) names[m.user.id] = m.user.display_name;
  const sender = message.sender.display_name;
  const place = room.kind === "dm" ? "" : message.thread_root_id !== null ? `#${roomName(room)} のスレッド` : `#${roomName(room)}`;
  const text = plainText(message.body, names);
  const body = text === "" ? "ファイルを送信しました" : text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}…` : text;
  const url = permalinkPath({
    workspaceId: room.workspace_id,
    roomId: room.id,
    messageId: message.id,
    threadRootId: message.thread_root_id ?? undefined,
  });
  return { title: place === "" ? sender : `${sender}（${place}）`, body, tag: message.id, url };
}

/** 本文を平文にする。書式の記号を外し、メンションを `@名前`、リンクを文字（なければ URL）にする。 */
export function plainText(body: string, names: Readonly<Record<string, string>>): string {
  return parseBody(body).map((b) => blockText(b, names)).join(" ").replace(/\s+/gu, " ").trim();
}

function blockText(block: Block, names: Readonly<Record<string, string>>): string {
  switch (block.type) {
    case "paragraph":
      return inlineText(block.children, names);
    case "code":
      return block.text;
    case "quote":
      return block.children.map((b) => blockText(b, names)).join(" ");
    case "list":
      return block.items
        .map((item) => [inlineText(item.children, names), ...item.sublists.map((l) => blockText(l, names))].join(" "))
        .join(" ");
  }
}

function inlineText(inlines: readonly Inline[], names: Readonly<Record<string, string>>): string {
  return inlines
    .map((i) => {
      switch (i.type) {
        case "text":
        case "code":
          return i.text;
        case "link":
          return i.label ?? i.url;
        case "mention":
          return i.kind === "user" ? `@${names[i.id] ?? "不明なユーザー"}` : `@${i.kind}`;
        default:
          return inlineText(i.children, names);
      }
    })
    .join("");
}
