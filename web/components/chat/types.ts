/**
 * チャット画面の presentational コンポーネントが受け取る表示用の型。
 *
 * API のレスポンスそのものではなく、表示に必要な値だけを持つ。時刻や件数の文言（「昨日」「248 KB」）は
 * 表示する側の都合で決まるので、ここでは整形済みの文字列で受け取り、API からの変換はデータ層（Phase 6-2）で行う。
 */

import type { WorkspaceRole } from "@/components/workspace/types";
import type { PresenceView } from "@/lib/chat/presence";

export type RoomKind = "public" | "private" | "dm";

/**
 * カスタムステータス（ADR 0049）。ワークスペースごとに持ち、絵文字は必須で文言は任意。
 *
 * `expiresLabel` は「いつ消えるか」を整形した文言（「今日 17:00 まで」など。Slack と同じくホバーで見せる）。
 * 期限のないステータスでは持たない。整形はデータ層が `Clock` の時刻を使って行う。
 */
export type UserStatusView = { emoji: string; text?: string; expiresLabel?: string };

/** 画面に出すユーザー。avatarUrl は画像があるときだけ（署名付き。ADR 0020）。 */
export type UserRef = { id: string; name: string; avatarUrl?: string; status?: UserStatusView };

export type WorkspaceRef = { id: string; name: string };

/** チャンネルごとの通知の上書き（ADR 0055 決定 3）。null は「全体の設定に従う」で、この型の外で表す。 */
export type RoomNotifyLevel = "all" | "mentions";

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
  /**
   * ミュートしている（ADR 0055 決定 6）。名前を薄くし、未読があっても太字にせず、未読数のバッジを出さない。
   * メンションの `@N` は出す。期限の切れたミュートは、データ層が `Clock` で落としてから渡す。
   */
  muted?: boolean;
  /**
   * アーカイブされている（ADR 0059）。サイドバーのチャンネルの節には出さず、検索したときだけ印を付けて出す。
   */
  archived?: boolean;
  /**
   * ハドルが進行中（ADR 0066 決定 13）。名前の横にヘッドフォンの印を出す。
   * 「いま起きていること」なので琥珀にし、押せるようにはしない（入るのはヘッダーか会話のメッセージから）。
   */
  huddleActive?: boolean;
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
  /** 本文に貼られた外部のリンクのプレビュー（ADR 0065）。取れたものだけ。本人が消したものは含まない。 */
  linkPreviews?: LinkPreviewView[];
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
  /** ピン留めした人の表示名（ADR 0054）。ピン留めされていなければ持たない。本文の上に「〜がピン留めしました」と黄土の地を出す。 */
  pinnedBy?: string;
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
      /** 本文の `<@ID>` を名前にする表。引けない ID は書かれたまま出る。 */
      mentionNames?: Readonly<Record<string, string>>;
      /** 畳んだときに出す本文。clamped が false なら body と同じ。 */
      clampedBody: string;
      /** 畳める（「すべて表示する」を出す）か。 */
      clamped: boolean;
      attachmentCount: number;
      /** スレッドの返信を指している。 */
      inThread: boolean;
    };

/**
 * 外部のリンクのプレビュー（ADR 0065）。
 *
 * 中身は投稿した時点でサーバーが取ったもの。画像とサイトのアイコンは自前のストレージに写してあり、
 * URL は表示するときに署名付きの GET URL を取る（ADR 0065 決定 7）。取れるまで `imageUrl` / `iconUrl` は空で、
 * 画像は寸法から枠だけを先に確保する。
 */
export type LinkPreviewView = {
  id: string;
  /** 本文に書かれた URL。タイトルのリンク先（リダイレクトの後の URL ではない）。 */
  url: string;
  siteName: string;
  title?: string;
  description?: string;
  /** 画像がなければ持たない。 */
  image?: { width: number; height: number; url?: string };
  /** サイトのアイコンがあるか。`iconUrl` が取れるまでは枠だけ出す。 */
  hasIcon: boolean;
  iconUrl?: string;
};

/**
 * 入力欄のリンクのプレビュー（ADR 0065 決定 13）。送る前に出し、「x」で消すと付かずに送られる。
 * 取れなかった URL（`preview: null`）はデータ層が落とすので、ここには来ない。
 */
export type ComposerLinkPreviewView =
  | { url: string; state: "loading" }
  | { url: string; state: "ok"; siteName: string; title?: string; iconUrl?: string };

/** 親のメッセージの下に出す「N 件の返信」。件数は削除された返信を除いた数、時刻は整形済み。 */
export type ThreadSummaryLabel = { replyCount: number; lastReplyLabel: string };

/**
 * 参加しているスレッドの一覧の 1 行（ADR 0036）。未読数は親の last_thread_seq と自分の既読位置の差。
 * 親が削除されていれば root.deleted が true で、本文は出さない。
 */
export type ThreadListItemView = {
  key: string;
  room: { kind: RoomKind; name: string };
  root: Pick<MessageView, "sender" | "timeLabel" | "body" | "deleted" | "mentionNames">;
  replyCount: number;
  lastReplyLabel: string;
  unreadCount: number;
  /**
   * 返信の通知がオンか（ADR 0056 決定 1）。オフの行は強調しない（未読数を出さない）。
   * 未読はオフでも数えているので、開けば既読になる（決定 2）。
   */
  notifyReplies: boolean;
  /** このスレッドの未読の範囲にある自分宛てのメンションの数。オフでも `@N` は出す（ADR 0056 決定 2）。 */
  mentionCount: number;
};

/**
 * ピン留めの一覧の 1 行（ADR 0054）。並びはピン留めした時刻の新しい順（並べるのはデータ層）。
 * 押すと 6.11b の仕組みでそのメッセージへ飛ぶ（href はパーマリンク）。
 */
export type PinnedMessageView = {
  key: string;
  href: string;
  sender: UserRef;
  timeLabel: string;
  body: string;
  mentionNames?: Readonly<Record<string, string>>;
  attachmentCount: number;
  /** スレッドの返信をピン留めしたもの。 */
  inThread: boolean;
};

/** 「後で」のタブ（ADR 0054 決定 6）。`removed` は一覧に出さないので含めない。 */
export type SavedTab = "in_progress" | "archived" | "completed";

/**
 * 「後で」の一覧の 1 行（ADR 0054）。読めない・削除済みは区別せずに unavailable にする（決定 8）。
 * 並びは保存した新しい順（並べるのはデータ層）。
 */
export type SavedItemView =
  | { key: string; status: "unavailable" }
  | {
      key: string;
      status: "ok";
      /** 押したときの行き先（パーマリンク）。 */
      href: string;
      room: { kind: RoomKind; name: string };
      sender: UserRef;
      timeLabel: string;
      body: string;
      mentionNames?: Readonly<Record<string, string>>;
      attachmentCount: number;
    };

/** 検索結果の 1 件（ADR 0061 決定 7）。押すと 6.11 の仕組みでそのメッセージへ飛ぶ。 */
export type SearchResultView = {
  key: string;
  /** 押したときの行き先（パーマリンク）。 */
  href: string;
  room: { kind: RoomKind; name: string };
  sender: UserRef;
  timeLabel: string;
  body: string;
  mentionNames?: Readonly<Record<string, string>>;
  /** スレッドの返信なら、押したときにスレッドが開くことを添える。 */
  inThread?: boolean;
  attachmentCount: number;
};

/** アクティビティのタブ（ADR 0058 決定 3）。`all` 以外は 1 件の理由（`reasons`）で絞る。 */
export type ActivityFilter = "all" | "dm" | "mention" | "thread" | "reaction";

/**
 * アクティビティに並べる理由（ADR 0058 決定 2）。1 件が複数に当たることがある（DM で自分がメンションされたなど）。
 * `channel` は「すべての新しい投稿」に設定したチャンネルの投稿。
 */
export type ActivityReason = "dm" | "mention" | "thread" | "channel" | "reaction";

/**
 * アクティビティの一覧の 1 件（ADR 0058）。メッセージ 1 つか、自分のメッセージに付いたリアクション 1 つ。
 * 並びは新しい順で、日付の区切りは一覧が `dateLabel` の変わり目に入れる（整形はデータ層）。
 */
export type ActivityItemView = {
  key: string;
  /** 押したときの行き先（パーマリンク。ADR 0042）。 */
  href: string;
  reasons: readonly ActivityReason[];
  /** 未読（ルームやスレッドの既読位置から導く。決定 5）。リアクションは常に false。 */
  unread: boolean;
  room: { kind: RoomKind; name: string };
  /** 送信者。リアクションのときは付けた人。 */
  actor: UserRef;
  /** スレッドの返信なら、親の本文の抜粋（「〜 のスレッド」と出す）。 */
  threadRootExcerpt?: string;
  /** リアクションの絵文字。リアクションのときだけ。 */
  reactionEmoji?: string;
  /** メッセージの本文。リアクションのときは、付けられた自分のメッセージの本文。 */
  body: string;
  mentionNames?: Readonly<Record<string, string>>;
  attachmentCount: number;
  /** 「8月10日 (月)」など、区切りに出す日付。 */
  dateLabel: string;
  /** 右に出す時刻。 */
  timeLabel: string;
};

export type TimelineItem =
  | { type: "date"; key: string; label: string }
  | { type: "unread"; key: string }
  /** スレッドのパネルで、親と返信の間に置く「N 件の返信」（0 件なら「まだ返信はありません」。ADR 0036）。 */
  | { type: "thread-divider"; key: string; replyCount: number }
  /** 参加・退出・作成・名前の変更のログ（ADR 0033）。文言はデータ層が作る。 */
  | { type: "system"; key: string; text: string; timeLabel: string }
  /** ハドルのメッセージ（ADR 0066 決定 12）。システムメッセージだが、参加のボタンと参加者を持つので行を分ける。 */
  | { type: "huddle"; huddle: HuddleMessageView }
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

/**
 * プロフィール（ADR 0050）。ホバーのカードと右のパネルが同じ値を受け取る（カードは email と管理の入口を使わない）。
 * - member: ワークスペースのメンバー。名前・ロール・presence・ステータスは手元の一覧から、email だけは 1 人分の API から埋める
 * - former: 一覧にいない人（外された人の過去のメッセージ）。メッセージが持っている名前・handle・アバターだけを出す（決定 5）
 * - unknown: 一覧にもメッセージにも手がかりがない（外された人のパネルを URL から開き直した）。名前も出せない
 */
export type ProfileView =
  | {
      kind: "member";
      user: UserRef & { handle: string };
      presence: PresenceView;
      role: WorkspaceRole;
      /**
       * email（決定 1 / 2）。loading は応答待ち（行の高さだけ先に取る）、
       * none は未検証か取れなかったとき（行もコピーも出さない）。
       */
      email: { state: "loading" } | { state: "none" } | { state: "ready"; value: string };
      isSelf: boolean;
      /** ロールの変更とキックの入口。操作できる相手のときだけ（ADR 0029 の写し。決定 3）。 */
      manage?: { grantableRoles: WorkspaceRole[]; canRemove: boolean };
    }
  | { kind: "former"; user: UserRef & { handle: string } }
  | { kind: "unknown" };

// ---- ハドル（ADR 0066） ----

/** ハドルに入っている人。speaking は受けた音声の音量からクライアントが決める（決定 10）。 */
export type HuddleParticipantView = UserRef & { muted: boolean; speaking?: boolean };

/**
 * 会話に残すハドルのメッセージ（ADR 0066 決定 12・追記 D）。見る人によって見え方が変わるので、state はデータ層が決める。
 * - active: 進行中。いま入っている人と「参加」のボタン（自分が入っていれば「参加中」）
 * - ended: 終わった。所要時間と参加した人
 * - missed: DM で、自分が一度も入らないまま終わった（不在着信）
 * - unanswered: DM で自分が始め、相手が一度も入らないまま終わった（応答なし）
 */
export type HuddleMessageView = {
  key: string;
  starter: UserRef;
  timeLabel: string;
  state: "active" | "ended" | "missed" | "unanswered";
  /** active のときは、いま入っている人。ended のときは、参加した人（自分が参加していれば先頭）。顔を並べる。 */
  participants: UserRef[];
  /**
   * 参加者の文言。データ層が作る（決定 12 の「2 人まで名前、それより多ければほか N 人」）。
   * 例: 「佐藤 直樹、高橋 みゆき、ほか 1 人が参加中」「あなた、佐藤 直樹、ほか 3 人が参加しました」「あなたが 1 人で参加しました」
   */
  participantsLabel?: string;
  /** ended の所要時間（「12 分」）。 */
  durationLabel?: string;
  /** active で、自分がもう入っている。 */
  joined?: boolean;
  /** ハドルのチャット（ハドルのメッセージのスレッド。追記 A）。返信がなければ持たない。 */
  thread?: ThreadSummaryLabel;
};

/**
 * ヘッダーのハドルのボタン（ADR 0066 決定 17・追記 C）。
 * idle は始める、active は入る、joined はハドルのタブを前に出す（抜けるのはハドルの画面から）。
 */
export type HuddleHeaderState =
  | { state: "idle" }
  | { state: "active"; participants: UserRef[] }
  | { state: "joined" };

/** マイク・スピーカーの選択肢（`MediaDeviceInfo` の deviceId と label）。 */
export type MediaDeviceView = { id: string; label: string };

/**
 * 参加する前のプレビュー（ADR 0066 追記 B）。
 * - speakers: スピーカーを選べないブラウザ（`setSinkId` がない）では持たない
 * - problem: マイクの許可がない・マイクがない。開始のボタンを押せなくする
 */
export type HuddlePreviewView = {
  room: { kind: RoomKind; name: string };
  /** 進行中のハドルがなければ start（「開始する」）、あれば join（「参加する」）。 */
  action: "start" | "join";
  self: UserRef;
  micOn: boolean;
  mics: MediaDeviceView[];
  micId?: string;
  speakers?: MediaDeviceView[];
  speakerId?: string;
  problem?: "mic-denied" | "no-mic";
};

/**
 * ハドルの画面（別のタブ。ADR 0066 追記 C）。
 * - connecting: 入る要求と SDP のやり取りの最中
 * - connected: つながっている
 * - reconnecting: WebRTC か WebSocket が切れて、つなぎ直している
 */
export type HuddleScreenView = {
  room: { kind: RoomKind; name: string };
  connection: "connecting" | "connected" | "reconnecting";
  /** 自分を含めた、いま入っている人。自分が先頭。 */
  participants: HuddleParticipantView[];
  /** 「もうすぐ参加する」を押した人（決定 11）。 */
  joiningSoon: UserRef[];
  /** 自分がミュートしている。 */
  muted: boolean;
};

/**
 * ハドルに入れなかった・外れた理由（ADR 0066 決定 17）。ハドルの画面の代わりに、同じタブに出す。
 * マイクの許可がない・マイクがないは、入る前のプレビューで知らせる（`HuddlePreviewView.problem`）。
 * - failed: Cloudflare とつながらなかった
 * - full: 上限の 20 人に達している（決定 7）
 * - disconnected: 心拍が途絶えて外れた（決定 5）
 * - removed: 権限が変わって外された（決定 8）
 */
export type HuddleProblem = "failed" | "full" | "disconnected" | "removed";
