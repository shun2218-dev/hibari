/**
 * チャット画面の presentational コンポーネントが受け取る表示用の型。
 *
 * API のレスポンスそのものではなく、表示に必要な値だけを持つ。時刻や件数の文言（「昨日」「248 KB」）は
 * 表示する側の都合で決まるので、ここでは整形済みの文字列で受け取り、API からの変換はデータ層（Phase 6-2）で行う。
 */

import type { PresenceView } from "@/lib/presence";

export type RoomKind = "public" | "private" | "dm";

/**
 * カスタムステータス（ADR 0049）。ワークスペースごとに持ち、絵文字は必須で文言は任意。
 * 期限（`expires_at`）は画面には出さないので持たない（過ぎたステータスはデータ層が落とす）。
 */
export type UserStatusView = { emoji: string; text?: string };

/** 画面に出すユーザー。avatarUrl は画像があるときだけ（署名付き。ADR 0020）。 */
export type UserRef = { id: string; name: string; avatarUrl?: string; status?: UserStatusView };

export type WorkspaceRef = { id: string; name: string };

export type RoomSummaryView = {
  id: string;
  kind: RoomKind;
  /** public / private はルーム名、DM は相手の表示名。 */
  name: string;
  /** DM の相手。アバターと presence に使う。 */
  peer?: { id: string; presence: PresenceView; avatarUrl?: string; status?: UserStatusView };
  /** 最後のメッセージの 1 行。チャンネルは「送信者: 本文」、DM は本文だけ。 */
  lastMessage?: string;
  timeLabel?: string;
  unreadCount: number;
  /** 自分宛ての未読のメンションの数（ADR 0041）。0 より大きいとバッジが `@N` になる（ADR 0043）。 */
  mentionCount: number;
};

export type MessageAttachmentView =
  | { kind: "image"; id: string; fileName: string; width?: number; height?: number; url?: string }
  | { kind: "file"; id: string; fileName: string; sizeLabel: string };

/**
 * メッセージの送信状態。
 * - pending: 送信中（楽観的に表示している）
 * - sent: サーバーが seq を採番した
 * - failed: 送信できなかった。再送できる（同じ client_msg_id で送るので二重投稿にならない）
 */
export type MessageStatus = "pending" | "sent" | "failed";

export type MessageView = {
  /** React の key。送信中は client_msg_id、確定後はメッセージ ID。 */
  key: string;
  sender: UserRef;
  timeLabel: string;
  body: string;
  status: MessageStatus;
  deleted: boolean;
  edited: boolean;
  /** スレッドの親なら、返信の数と最後の返信の時刻（ADR 0036）。返信が 0 件なら持たない。 */
  thread?: ThreadSummaryLabel;
  /**
   * 「チャンネルにも投稿する」を付けた返信（ADR 0039）。どこに並べる行かで見え方が変わる。
   * - channel: チャンネルのタイムラインの行。「スレッドに返信しました」を出し、押すとスレッドを開く
   * - thread: スレッドのパネルの行。どこにも投稿したかを控えめに添える（label は「チャンネルにも投稿しました」など。データ層が作る）
   */
  broadcast?: { in: "channel" } | { in: "thread"; label: string };
  attachments: MessageAttachmentView[];
  /** 本文に貼られたパーマリンクのカード（ADR 0040）。最大 3 件。 */
  linkCards?: MessageLinkCardView[];
  /** 付いた絵文字のリアクション（ADR 0044）。1 件も無ければ持たない（行そのものを出さない）。 */
  reactions?: MessageReactionView[];
  /** 直前のメッセージと同じ送信者なので、アバターと名前を省いて続けて表示する。 */
  grouped: boolean;
  /**
   * 本文に出てくるメンションの表示名（ADR 0043）。ID から引く。
   * 本文は `<@ULID>` のまま持っているので、チップに置き換えるのにこの表を使う。引けない ID は文字列のまま出す。
   */
  mentionNames?: Readonly<Record<string, string>>;
  /** 自分宛てのメンションがある（`@channel` / `@here` を含む）。行の背景を琥珀にする。 */
  mentionsMe?: boolean;
};

/**
 * メッセージに付いた絵文字のリアクション 1 種類ぶん（ADR 0044）。
 *
 * 並びは最初に付いた順で、数が増えても入れ替わらない。数は行を数えた結果で、クライアントは持ち越さない。
 */
export type MessageReactionView = {
  emoji: string;
  count: number;
  /** 自分が付けている。チップを「押している状態」（緑）にする。 */
  me: boolean;
  /**
   * 付けた人の表示名。API が返すのは先頭 8 人の user_id だけなので（ADR 0044）、
   * ここに並ぶのも最大 8 人で、count より少ないことがある。名前の解決はデータ層が行う。
   */
  names: string[];
};

/**
 * 本文に貼られたパーマリンクのカード（ADR 0040）。
 *
 * 中身は見る人の権限で取り直すので、読めないリンクは unavailable になる。
 * 削除済みのメッセージも unavailable にする（削除は跡も残さず消える。ADR 0038）。
 * 本文を畳むかどうかは、行数と文字数でデータ層が決めて body / clampedBody の両方を渡す（ADR 0040）。
 */
export type MessageLinkCardView =
  | { key: string; state: "loading" }
  | { key: string; state: "unavailable" }
  | {
      key: string;
      state: "ok";
      /** カード全体の遷移先（パーマリンクそのもの）。 */
      href: string;
      /** 今いるワークスペースと違うときだけ入る。同じなら出さない（いつも同じ名前が並ぶのを避ける）。 */
      workspaceName?: string;
      /** public / private はルーム名、DM は相手の表示名。 */
      room: { kind: RoomKind; name: string };
      sender: UserRef;
      timeLabel: string;
      body: string;
      /** 畳んだときに出す本文。clamped が false なら body と同じ。 */
      clampedBody: string;
      /** 畳める（「すべて表示する」を出す）か。 */
      clamped: boolean;
      attachmentCount: number;
      /** スレッドの返信を指している。 */
      inThread: boolean;
    };

/** 親のメッセージの下に出す「N 件の返信」。件数は削除された返信を除いた数、時刻は整形済み。 */
export type ThreadSummaryLabel = { replyCount: number; lastReplyLabel: string };

/**
 * 参加しているスレッドの一覧の 1 行（ADR 0036）。未読数は親の last_thread_seq と自分の既読位置の差。
 * 親が削除されていれば root.deleted が true で、本文は出さない。
 */
export type ThreadListItemView = {
  key: string;
  room: { kind: RoomKind; name: string };
  root: Pick<MessageView, "sender" | "timeLabel" | "body" | "deleted">;
  replyCount: number;
  lastReplyLabel: string;
  unreadCount: number;
};

export type TimelineItem =
  | { type: "date"; key: string; label: string }
  | { type: "unread"; key: string }
  /** スレッドのパネルで、親と返信の間に置く「N 件の返信」（0 件なら「まだ返信はありません」。ADR 0036）。 */
  | { type: "thread-divider"; key: string; replyCount: number }
  /** 参加・退出・作成・名前の変更のログ（ADR 0033）。文言はデータ層が作る。 */
  | { type: "system"; key: string; text: string; timeLabel: string }
  | { type: "message"; message: MessageView };

/**
 * 接続状態のバナー。接続中（connected）はバナーを出さないので含めない。
 * restored は同期が終わった直後にだけ短く出す。
 */
export type ConnectionBannerStatus = "reconnecting" | "syncing" | "restored";

export type AttachmentDraftView =
  | { id: string; fileName: string; status: "uploading"; progress: number }
  | { id: string; fileName: string; status: "failed" }
  | { id: string; fileName: string; status: "uploaded"; sizeLabel: string };

export type RoleLabel = "オーナー" | "管理者" | "メンバー";

export type RoomMemberView = UserRef & { presence: PresenceView; roleLabel: RoleLabel };
