/**
 * チャット画面の presentational コンポーネントが受け取る表示用の型。
 *
 * API のレスポンスそのものではなく、表示に必要な値だけを持つ。時刻や件数の文言（「昨日」「248 KB」）は
 * 表示する側の都合で決まるので、ここでは整形済みの文字列で受け取り、API からの変換はデータ層（Phase 6-2）で行う。
 */

export type RoomKind = "public" | "private" | "dm";

/** 画面に出すユーザー。avatarUrl は画像があるときだけ（署名付き。ADR 0020）。 */
export type UserRef = { id: string; name: string; avatarUrl?: string };

export type WorkspaceRef = { id: string; name: string };

export type RoomSummaryView = {
  id: string;
  kind: RoomKind;
  /** public / private はルーム名、DM は相手の表示名。 */
  name: string;
  /** DM の相手。アバターと presence に使う。 */
  peer?: { id: string; online: boolean; avatarUrl?: string };
  /** 最後のメッセージの 1 行。チャンネルは「送信者: 本文」、DM は本文だけ。 */
  lastMessage?: string;
  timeLabel?: string;
  unreadCount: number;
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
  attachments: MessageAttachmentView[];
  /** 直前のメッセージと同じ送信者なので、アバターと名前を省いて続けて表示する。 */
  grouped: boolean;
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

export type RoomMemberView = UserRef & { online: boolean; roleLabel: RoleLabel };
