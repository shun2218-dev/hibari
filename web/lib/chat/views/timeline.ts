import type { MessageView, RoomKind, TimelineItem, UserStatusView } from "@/components/chat/types";
import type {
  LinkPreview,
  Mention,
  Message,
  MessageAttachment,
  MessageHuddle,
  MessageLink,
  MessageReaction,
  RoomHuddle,
  UserProfile,
} from "@/lib/api/types.gen";
import { dayKey, formatDate, formatListTime, formatTime } from "@/lib/chat/format/time";
import type { MediaState } from "@/lib/chat/media/media-store";
import { inChannel } from "@/lib/chat/rules/messages";
import type { OutgoingMessage } from "@/lib/chat/store/state";

import { toHuddleMessageView } from "./huddles";
import {
  mentionsUser,
  systemMessageText,
  toAttachmentView,
  toLinkCardViews,
  toLinkPreviewViews,
  toReactionViews,
  type UrlTable,
} from "./message";

/**
 * チャンネルのタイムライン（ADR 0018）。メッセージと送信中のものを、日付とまとまりに分けて並べる。
 */
/** 続けて表示する（アバターと名前を省く）のは、同じ送信者がこの時間内に送ったときだけ。 */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

export type TimelineOptions = {
  /**
   * ルームを開いた時点の last_read_seq。これより大きい seq の最初のメッセージの前に「ここから未読」を入れる。
   * null なら入れない（メンバーではない、または区切りを消した）。
   */
  unreadAfterSeq: number | null;
  /** 確定していない自分のメッセージ。確定したメッセージの後ろに、送った順で並べる（まだ seq がない）。 */
  outgoing?: readonly OutgoingMessage[];
  /** 自分。outgoing の送信者として出す。 */
  me?: UserProfile;
  /** user_id → アバターの URL。 */
  avatarUrls?: UrlTable;
  /**
   * user_id → カスタムステータス（ADR 0049）。名前の横に絵文字を出すのに使う。
   * ワークスペースのメンバー一覧から作る（メッセージには載らない。ADR 0049 決定 7 の追記）。
   */
  statuses?: Readonly<Record<string, UserStatusView | undefined>>;
  /** attachment_id → 画像の URL。 */
  attachmentUrls?: UrlTable;
  /** preview_id → リンクのプレビューの画像とアイコンの URL（ADR 0065）。 */
  linkPreviewUrls?: MediaState["linkPreviews"];
  /** 本文に貼られたパーマリンクのカードの中身（ADR 0040）。linkKey → 取得結果。 */
  linkCards?: Record<string, MessageLink | undefined>;
  /** パーマリンクを見分けるためのこの画面のオリジン。省くとカードを出さない（サーバー側の描画では window がない）。 */
  origin?: string;
  /** 今いるワークスペース。カードのワークスペース名は、これと違うときだけ出す。 */
  currentWorkspaceId?: string;
  /**
   * user_id → 表示名。本文の `<@ID>` をチップにするのに使う（ADR 0043）。ルームのメンバーから作る。
   * ルームを抜けた人はここにいないが、メッセージ自身の `mentions` が補う。送信中の本文はこちらだけで引く。
   */
  memberNames?: Readonly<Record<string, string>>;
  /**
   * user_id → 表示名。リンクのカードの本文の `<@ID>` に使う（ADR 0051）。ワークスペースのメンバー一覧から作る。
   * カードの API はメンションの名前を返さず、リンク先は別のルームのことが多いので、ルームのメンバーでは足りない。
   */
  workspaceMemberNames?: Readonly<Record<string, string>>;
  timeZone?: string;
  /** ルームの種類。DM のハドルのメッセージを「不在着信」「応答なし」にするのに使う（ADR 0066 決定 12）。 */
  roomKind?: RoomKind;
  /** ルームの進行中のハドル（ADR 0066 決定 13）。ハドルのメッセージに、いま入っている人を出すのに使う。 */
  activeHuddle?: RoomHuddle | null;
  /** 「最終返信」の相対的な時刻（「昨日」など）の基準。省けば今。 */
  now?: Date;
  /**
   * スレッドの返信を並べるときの親の ID（ADR 0036）。渡すと messages をそのまま並べ、outgoing はそのスレッドへの返信だけにする。
   * 省くとチャンネルのタイムラインで、「チャンネルにも投稿する」を付けていない返信を除く（ADR 0039）。
   */
  threadRootId?: string;
  /**
   * スレッドのパネルで、流した返信に添える注記（alsoInChannelDoneLabel）。ルームの種類で文言が変わるので受け取る。
   * 省くと注記を出さない。チャンネルのタイムラインでは使わない。
   */
  broadcastDoneLabel?: string;
};

/** タイムラインに並べる 1 件。確定したメッセージと、確定していない自分のメッセージを同じ形にそろえる。 */
type Entry = {
  key: string;
  seq: number | null;
  /** システムメッセージ（ADR 0033）なら、その文言。人の発言では undefined。 */
  systemText?: string;
  /** ピン留めした人の表示名（ADR 0054）。ピン留めされていなければ undefined。 */
  pinnedBy?: string;
  sender: UserProfile;
  createdAt: Date;
  body: string;
  status: "pending" | "sent" | "failed";
  deleted: boolean;
  edited: boolean;
  /** 返信のついた親の「N 件の返信」。返信が全部消えていれば出さない。 */
  thread: { replyCount: number; lastReplyAt: Date } | undefined;
  /** 「チャンネルにも投稿する」を付けた返信の見え方（ADR 0039）。並べる場所で変わる。 */
  broadcast: MessageView["broadcast"];
  attachments: readonly MessageAttachment[];
  /** 本文にあるメンション（ADR 0041）。送信中のメッセージはまだ分からないので空にする。 */
  mentions: readonly Mention[];
  /** 付いた絵文字のリアクション（ADR 0044）。送信中のメッセージには付けられないので空。 */
  reactions: readonly MessageReaction[];
  /** 外部のリンクのプレビュー（ADR 0065）。送信中のメッセージはまだ付いていないので空（サーバーの応答で付く）。 */
  linkPreviews: readonly LinkPreview[];
  /** ハドルのメッセージ（ADR 0066 決定 12）なら、そのハドル。 */
  huddle?: MessageHuddle;
};

/**
 * 流した返信（ADR 0039）の見え方。チャンネルでは押せるラベル、スレッドのパネルでは本文の下の注記にする。
 * 注記の文言はルームの種類で変わるので、渡されていなければスレッドでは何も添えない。
 */
function broadcastView(
  isBroadcastReply: boolean,
  inThread: boolean,
  doneLabel: string | undefined,
): MessageView["broadcast"] {
  if (!isBroadcastReply) return undefined;
  if (!inThread) return { in: "channel" };
  return doneLabel === undefined ? undefined : { in: "thread", label: doneLabel };
}

/**
 * 本文の `<@ID>` を名前にするための表（ADR 0043）。ルームのメンバーを土台に、そのメッセージの `mentions` で上書きする。
 * `mentions` にはルームを抜けた人も入っているので（ADR 0041）、抜けた人の名前もこれで出せる。
 */
export function mentionNamesFor(entry: Entry, memberNames: Readonly<Record<string, string>> | undefined) {
  const named = entry.mentions.filter((m) => m.user !== undefined);
  if (named.length === 0) return memberNames;
  const names: Record<string, string> = { ...memberNames };
  for (const m of named) names[m.user!.id] = m.user!.display_name;
  return names;
}

export function fromMessage(message: Message, broadcast: MessageView["broadcast"]): Entry {
  return {
    key: message.id,
    seq: message.seq,
    systemText: message.kind === "system" ? systemMessageText(message) : undefined,
    pinnedBy: message.pinned?.by.display_name,
    sender: message.sender,
    createdAt: new Date(message.created_at),
    body: message.body,
    // REST と WebSocket で届いたメッセージは seq が採番済み
    status: "sent",
    deleted: message.deleted_at !== null,
    edited: message.edited_at !== null,
    thread:
      message.thread && message.thread.reply_count > 0
        ? { replyCount: message.thread.reply_count, lastReplyAt: new Date(message.thread.last_reply_at) }
        : undefined,
    broadcast,
    attachments: message.attachments,
    mentions: message.mentions,
    reactions: message.reactions,
    linkPreviews: message.link_previews,
    huddle: message.system?.type === "huddle" ? message.huddle : undefined,
  };
}

function fromOutgoing(message: OutgoingMessage, me: UserProfile, broadcast: MessageView["broadcast"]): Entry {
  return {
    // 確定すると key がメッセージの ID に変わる。確定したメッセージと送信中のメッセージの key は重ならない
    key: message.clientMsgId,
    seq: null,
    sender: me,
    createdAt: new Date(message.createdAt),
    body: message.body,
    status: message.status,
    deleted: false,
    edited: false,
    thread: undefined,
    broadcast,
    attachments: message.attachments,
    // 送信中は、サーバーがまだ本文を解釈していない。名前は memberNames から引く
    mentions: [],
    // まだ ID がないのでリアクションは付けられない（ADR 0044）
    reactions: [],
    linkPreviews: [],
  };
}

/**
 * seq の昇順に並んだメッセージから、日付と未読の区切りを挟んだタイムラインを作る。
 * 確定していない自分のメッセージは、その後ろに送った順で並べる。
 */
export function toTimelineItems(
  messages: readonly Message[],
  {
    unreadAfterSeq,
    outgoing = [],
    me,
    avatarUrls = {},
    attachmentUrls = {},
    linkPreviewUrls = {},
    linkCards = {},
    origin,
    currentWorkspaceId,
    memberNames,
    workspaceMemberNames,
    statuses = {},
    timeZone,
    now = new Date(),
    threadRootId,
    broadcastDoneLabel,
    roomKind,
    activeHuddle,
  }: TimelineOptions,
): TimelineItem[] {
  const inThread = threadRootId !== undefined;
  // チャンネルのタイムラインに出すのは、チャンネルの投稿と、「チャンネルにも投稿する」を付けた返信だけ（ADR 0036 / 0039）。
  // 出さない返信も手元には持っておく（change_seq のカーソルを進めるため）
  // 削除したメッセージも出さない（ADR 0038）。返信の残っているスレッドの親だけは、返信の置き場所として「削除されました」を残す
  const shown = messages.filter(
    (m) =>
      (inThread || inChannel(m)) &&
      (m.deleted_at === null || m.id === threadRootId || (m.thread?.reply_count ?? 0) > 0),
  );
  const entries = shown.map((m) =>
    fromMessage(m, broadcastView(m.thread_root_id !== null && m.also_in_channel, inThread, broadcastDoneLabel)),
  );
  if (me) {
    // 送信中の返信も、確定した後と同じ場所に出す。チェックを付けた返信はスレッドとチャンネルの両方に並ぶ
    const mine = inThread
      ? outgoing.filter((m) => m.threadRootId === threadRootId)
      : outgoing.filter((m) => m.threadRootId === null || m.alsoInChannel);
    entries.push(
      ...mine.map((m) =>
        fromOutgoing(m, me, broadcastView(m.threadRootId !== null && m.alsoInChannel, inThread, broadcastDoneLabel)),
      ),
    );
  }

  const items: TimelineItem[] = [];
  let previous: Entry | undefined;
  let previousDay: string | undefined;
  let unreadInserted = unreadAfterSeq === null;

  for (const entry of entries) {
    const day = dayKey(entry.createdAt, timeZone);
    let breakGroup = false;

    if (day !== previousDay) {
      items.push({ type: "date", key: `date-${day}`, label: formatDate(entry.createdAt, now, timeZone) });
      previousDay = day;
      breakGroup = true;
    }
    // 自分の送信中のメッセージは未読にならない。システムメッセージも未読に数えない（ADR 0033）ので、
    // 区切りは「未読の人の発言」の前に出す
    if (!unreadInserted && entry.seq !== null && entry.systemText === undefined && entry.seq > unreadAfterSeq!) {
      items.push({ type: "unread", key: "unread" });
      unreadInserted = true;
      breakGroup = true;
    }
    // 流した返信は、直前が同じ人の発言でも続けて表示にしない。スレッドから来た行だと分かるようにするため（docs/ui/README.md）
    if (entry.broadcast?.in === "channel") breakGroup = true;

    if (entry.huddle !== undefined) {
      // ハドルのメッセージは、参加のボタンと参加者とスレッドを持つので、ログの 1 行ではなくハドルの行にする（ADR 0066 追記 D）
      items.push({
        type: "huddle",
        huddle: toHuddleMessageView(
          { id: entry.key, sender: entry.sender, huddle: entry.huddle },
          {
            me,
            roomKind,
            activeHuddle,
            names: { ...workspaceMemberNames, ...memberNames },
            avatarUrls,
            timeLabel: formatTime(entry.createdAt, timeZone),
            thread: entry.thread
              ? { replyCount: entry.thread.replyCount, lastReplyLabel: formatListTime(entry.thread.lastReplyAt, now, timeZone) }
              : undefined,
          },
        ),
      });
      previous = undefined;
      continue;
    }

    if (entry.systemText !== undefined) {
      // ログは人の発言ではないので、続けて表示（grouped）の基準にもしない
      items.push({
        type: "system",
        key: entry.key,
        text: entry.systemText,
        timeLabel: formatTime(entry.createdAt, timeZone),
      });
      previous = undefined;
      continue;
    }

    const grouped =
      !breakGroup &&
      previous !== undefined &&
      previous.sender.id === entry.sender.id &&
      entry.createdAt.getTime() - previous.createdAt.getTime() < GROUPING_WINDOW_MS;

    items.push({
      type: "message",
      message: {
        key: entry.key,
        sender: {
          id: entry.sender.id,
          name: entry.sender.display_name,
          avatarUrl: avatarUrls[entry.sender.id] ?? undefined,
          status: statuses[entry.sender.id],
        },
        timeLabel: formatTime(entry.createdAt, timeZone),
        body: entry.body,
        status: entry.status,
        deleted: entry.deleted,
        edited: entry.edited,
        thread: entry.thread
          ? { replyCount: entry.thread.replyCount, lastReplyLabel: formatListTime(entry.thread.lastReplyAt, now, timeZone) }
          : undefined,
        broadcast: entry.broadcast,
        mentionNames: mentionNamesFor(entry, memberNames),
        pinnedBy: entry.deleted ? undefined : entry.pinnedBy,
        // 自分の発言では自分に知らせない（ADR 0041）
        mentionsMe: me !== undefined && entry.sender.id !== me.id && mentionsUser(entry.mentions, me.id),
        attachments: entry.attachments.map((a) => toAttachmentView(a, attachmentUrls)),
        reactions: toReactionViews(entry.reactions, memberNames, me),
        linkPreviews:
          entry.deleted || entry.linkPreviews.length === 0 ? undefined : toLinkPreviewViews(entry.linkPreviews, linkPreviewUrls),
        linkCards: origin === undefined ? undefined : toLinkCardViews(entry.body, { origin, linkCards, currentWorkspaceId, avatarUrls, timeZone, mentionNames: workspaceMemberNames }),
        grouped,
      },
    });
    // 流した返信の次の発言も続けて表示にしない（同じ人でも、スレッドの返信の続きに見えてしまうため）
    previous = entry.broadcast?.in === "channel" ? undefined : entry;
  }
  return items;
}
