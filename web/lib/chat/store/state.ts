import type { ConnectionBannerStatus } from "@/components/chat/types";
import { ApiError } from "@/lib/api/error";
import type {
  FollowedThread,
  Invite,
  Member,
  Message,
  MessageAttachment,
  NotifyLevel,
  RemovalReason,
  Room,
  RoomMember,
  UserProfile,
  Workspace,
} from "@/lib/api/types.gen";
import { type ActivityListState } from "@/lib/chat/store/activity-feed";
import type { SavedTab, SavedTabState } from "@/lib/chat/store/saved";

/**
 * - loading: 取得中（まだ一度も取れていない）
 * - ready: 取れた
 * - not_found: 404。存在しないか、読む権限がない（API はこの 2 つを区別しない。ADR 0011）
 * - error: それ以外の失敗（通信の失敗、500）
 */
export type LoadStatus = "loading" | "ready" | "not_found" | "error";

export type TimelineState = {
  status: LoadStatus;
  /** seq の昇順。 */
  messages: Message[];
  /** もっと古いメッセージがある。 */
  hasOlder: boolean;
  loadingOlder: boolean;
  /**
   * もっと新しいメッセージがある（ADR 0042）。指定したメッセージへ飛んだ後だけ true になる。
   * true の間は、届いたメッセージを末尾に足さない（手元の並びとつながらないため）。
   */
  hasNewer: boolean;
  loadingNewer: boolean;
  /**
   * 「ここから未読」の位置。これより大きい seq の最初のメッセージの前に出す。null なら出さない。
   * 開いてすぐ既読にするので、ルームの last_read_seq を見ると区切りが消えてしまう。開いた時点の値で固定し、
   * 見ていない間に届いたメッセージの分だけ動かす（ADR 0026）。
   */
  unreadAfterSeq: number | null;
  /**
   * 開いた時点の未読数（ADR 0042 の「未読へ飛ぶ」バーに出す）。開いている間は増やさない。
   * 開いてすぐ既読にするので、ルームの unread_count は 0 になってしまう。
   */
  unreadAtOpen: number;
  /** 同期のカーソル（ADR 0014）。この番号までの変更は手元に反映してある。 */
  changeSeq: number;
};

/**
 * 自分が送って、まだサーバーで確定していないメッセージ（楽観的な表示。ADR 0027）。
 * - pending: 送信中か、同じルームの前の送信を待っている
 * - failed: 送れなかった。同じ client_msg_id で再送するので、実は届いていても二重投稿にならない
 */
export type OutgoingMessage = {
  clientMsgId: string;
  body: string;
  /** スレッドへの返信なら親の ID（ADR 0036）。チャンネルへの投稿なら null。送信の順番はルームで 1 本のまま。 */
  threadRootId: string | null;
  /**
   * 「チャンネルにも投稿する」を付けた返信（ADR 0039）。返信のときだけ true にできる。
   * 送信後は変えられないので、送るときに決めた値をそのまま再送にも使う。
   */
  alsoInChannel: boolean;
  /** アップロードを終えた（uploaded の）添付。送信で attachment_ids として付ける（ADR 0013）。 */
  attachments: MessageAttachment[];
  status: "pending" | "failed";
  /** 手元の時刻（ISO 8601）。表示の時刻と日付の区切りにだけ使い、並びには使わない。 */
  createdAt: string;
};

/**
 * 開いているスレッド（ADR 0036）。親と返信を持つ。返信はルームのタイムライン（TimelineState.messages）にも入っているが、
 * そちらは読み込んだ範囲のチャンネルに合わせて持つので、スレッドの返信を全部持っているとは限らない。スレッドはスレッドで取る。
 */
export type ThreadState = {
  status: LoadStatus;
  roomId: string;
  /** 親のメッセージ。削除されていれば tombstone。取得前は null。 */
  root: Message | null;
  /** seq の昇順。 */
  replies: Message[];
  hasOlder: boolean;
  loadingOlder: boolean;
  /** もっと新しい返信がある（ADR 0042）。返信へ飛んだ後だけ true になる。 */
  hasNewer: boolean;
  loadingNewer: boolean;
  /** 自分の既読位置。スレッドに参加していなければ null（未読を持たない）。 */
  lastReadThreadSeq: number | null;
};

/** 入力中の人。expiresAt を過ぎたら消す（typing.stopped はない。docs/events.md）。 */
export type TypingUser = { user: UserProfile; expiresAt: number };

/**
 * 接続の状態の表示。
 * - banner: 再接続中・同期中・復帰のバナー
 * - unavailable: サーバーに届かない画面（chat/connection/server-error.png）を出すときだけ値がある
 */
export type ConnectionView = {
  banner: ConnectionBannerStatus | null;
  unavailable: { lastConnectedAt: number; retryCount: number } | null;
};

export type ChatState = {
  workspaces: { status: LoadStatus; list: Workspace[] };
  /** ワークスペースごとのルームの ID。並びは最後のメッセージが新しい順（API と同じ）。 */
  roomLists: Record<string, { status: LoadStatus; ids: string[] } | undefined>;
  /** ルームの本体。一覧・1 件の取得・イベントがどれもここだけを更新する。 */
  rooms: Record<string, Room | undefined>;
  timelines: Record<string, TimelineState | undefined>;
  roomMembers: Record<string, { status: LoadStatus; members: RoomMember[] } | undefined>;
  /** ワークスペースのメンバー（管理画面）。user_id の順（API と同じ）。 */
  members: Record<string, { status: LoadStatus; list: Member[] } | undefined>;
  /** 招待リンク（管理画面）。新しい順に並べ替えてから持つ。 */
  invites: Record<string, { status: LoadStatus; list: Invite[] } | undefined>;
  /** 表示中のワークスペース。購読の対象を決める（realtime.ts）。 */
  activeWorkspaceId: string | null;
  /**
   * 開いているルームと、その最新を見ているか（タブが見えていて、いちばん下までスクロールしている）。
   * 見ている間に届いたメッセージは既読にし、「ここから未読」を出さない。
   */
  focus: { roomId: string; caughtUp: boolean } | null;
  typing: Record<string, TypingUser[] | undefined>;
  /** スレッドの親の ID ごとの状態（開いたことのあるスレッド）。 */
  threads: Record<string, ThreadState | undefined>;
  /** ワークスペースごとの、参加しているスレッド。最後の返信が新しい順（API と同じ）。 */
  threadLists: Record<string, { status: LoadStatus; list: FollowedThread[] } | undefined>;
  /** ルーム一覧の unread_thread_count。参加しているスレッドの一覧を取るまでの、サイドバーのバッジ。 */
  unreadThreadCounts: Record<string, number | undefined>;
  /** スレッドの親の ID ごとの、そのスレッドで入力中の人。 */
  threadTyping: Record<string, TypingUser[] | undefined>;
  /**
   * ルームごとのピン留めの一覧（ADR 0054）。ピン留めした新しい順（API と同じ）。
   * ヘッダーの件数に使うので、ルームを開いたときに取る。変化は message.updated と差分で直す（専用のイベントはない）。
   */
  pins: Record<string, { status: LoadStatus; messages: Message[] } | undefined>;
  /**
   * ワークスペースごとの「後で」（ADR 0054）。本人だけの状態で、本人ごとの change_seq（cursor）で同期する。
   * - tabs: 取ったタブの一覧。取っていないタブは持たない（開いたときに取る）
   * - inProgressCount: 「進行中」のタブの件数（読めない行も数える）
   * - cursor: この番号までの変更は反映してある。ワークスペースを開いたときに「進行中」を取って決める
   */
  saved: Record<
    string,
    { tabs: Partial<Record<SavedTab, SavedTabState>>; inProgressCount: number; cursor: number | null } | undefined
  >;
  /** 開いているスレッドのパネル。再接続の後に取り直す（realtime.ts）。 */
  threadFocus: { roomId: string; rootId: string } | null;
  /** ルームごとの、確定していない自分のメッセージ。入力した順（送る順）に並ぶ。 */
  outgoing: Record<string, OutgoingMessage[] | undefined>;
  /**
   * 自分が外されたルーム（非公開と DM）。一覧からはすぐに消し、開いている間だけ「アクセスできません」を出すために覚えておく
   * （chat/room/removed-from-channel.png。ADR 0035）。
   * public ルームは参加していなくても読めるので、ここには入れず、参加していない状態に戻すだけ。
   */
  removedRooms: Record<string, RemovalReason | undefined>;
  /** 自分が外されたワークスペース。一覧からは除き、その画面を開いている間だけ名前を残す（chat/workspace/removed-from-workspace.png）。 */
  removedWorkspaces: Record<string, { reason: RemovalReason; workspace: Workspace } | undefined>;
  /**
   * ワークスペースごとの、全体の通知の設定（ADR 0055 決定 2）。ルームのメニューとユーザー設定で使う。
   * ルームごとの設定は、ルームの本体（rooms の notifications）にある。
   */
  notificationLevels: Record<string, NotifyLevel | undefined>;
  /**
   * ワークスペースごとのアクティビティ（ADR 0058）。行を持たない API から取り、WebSocket のイベントで手元を動かす。
   * - lists: タブと「未読メッセージ」の組（activityListKey）ごとの一覧。開いた組だけを持つ
   * - unreadCount: 未読の件数（左のメニューのバッジ）。100 で打ち切られている。取る前は null
   */
  activity: Record<string, { lists: Record<string, ActivityListState | undefined>; unreadCount: number | null } | undefined>;
  connection: ConnectionView;
};

/** 未読のアクティビティの件数の上限（API と同じ。バッジは「99+」）。 */
export const MAX_UNREAD_ACTIVITY = 100;

export type ChatStoreOptions = {
  /** ログインしているユーザー。自分の送信・入力中・自分宛てのイベントの判定に使う。 */
  userId: string;
  now?: () => number;
  /**
   * 送信の応答をこの時間待っても来なければ、失敗として再送できるようにする。
   * 経路が黙って切れると fetch はなかなか失敗しないので、送信中のまま止めない。
   */
  sendTimeoutMs?: number;
};

export function statusOf(err: unknown): LoadStatus {
  return err instanceof ApiError && err.status === 404 ? "not_found" : "error";
}

/** 入力中の表示を、最後に受け取ってから消すまでの時間（docs/events.md）。 */
export const TYPING_TTL_MS = 6_000;
