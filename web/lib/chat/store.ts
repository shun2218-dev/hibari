import type { ConnectionBannerStatus } from "@/components/chat/types";
import { ApiError } from "@/lib/api/error";
import type {
  ActivityFilter,
  ActivityItem,
  FollowedThread,
  Invite,
  InviteAcceptance,
  InvitePolicy,
  InvitePreview,
  Member,
  Message,
  MessageAttachment,
  MessageList,
  NotifyLevel,
  RemovalReason,
  Role,
  Room,
  RoomKind,
  RoomMember,
  RoomNotifications,
  SavedItem,
  ServerEvent,
  SetStatusRequest,
  UserProfile,
  UserStatus,
  Workspace,
} from "@/lib/api/types.gen";

import { ulid } from "@/lib/ulid";

import {
  type ActivityListState,
  activityListKey,
  applyRoomReadToActivity,
  applyThreadReadToActivity,
  belongsTo,
  insertActivity,
  messageActivityItem,
  parseActivityListKey,
  removeActivity,
} from "./activity-feed";
import type { ChatApi } from "./api";
import { notifyReasons } from "./desktop-notification";
import {
  advanceCursor,
  applyMessageToRoom,
  applyReadToRoom,
  inChannel,
  insertByActivity,
  mergeIntoWindow,
  mergeMessages,
  newestChannelSeq,
} from "./messages";
import { isMuted, nextMuteExpiry } from "./notifications";
import { applyPinnedMessages } from "./pins";
import { toggleReaction } from "./reactions";
import { type SavedTab, type SavedTabState, applySavedItem } from "./saved";
import {
  applyReplyToThreads,
  applyRootToThreads,
  applyThreadNotify,
  applyThreadRead,
  mergeReplies,
  mergeRepliesIntoWindow,
} from "./threads";

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

function statusOf(err: unknown): LoadStatus {
  return err instanceof ApiError && err.status === 404 ? "not_found" : "error";
}

/** 入力中の表示を、最後に受け取ってから消すまでの時間（docs/events.md）。 */
const TYPING_TTL_MS = 6_000;

const SEND_TIMEOUT_MS = 10_000;

class SendTimeoutError extends Error {
  constructor() {
    super("sending a message timed out");
  }
}

/**
 * チャットの状態のストア（ADR 0024 の session と同じく自作で、useSyncExternalStore で購読する）。
 *
 * 状態は置き換えるだけで、中身を書き換えない。変わった部分だけ新しいオブジェクトにするので、
 * コンポーネントは自分の見ている部分の参照が変わったときだけ描き直される。
 *
 * REST で取った状態に、WebSocket のイベント（applyEvent）を重ねる。イベントは落ちうるので、
 * 取りこぼしは change_seq で検出して差分を取り直す（syncTimeline。ADR 0014 / 0026）。
 */
export function createChatStore(
  api: ChatApi,
  { userId, now = Date.now, sendTimeoutMs = SEND_TIMEOUT_MS }: ChatStoreOptions,
) {
  let state: ChatState = {
    workspaces: { status: "loading", list: [] },
    roomLists: {},
    rooms: {},
    timelines: {},
    roomMembers: {},
    members: {},
    invites: {},
    activeWorkspaceId: null,
    focus: null,
    typing: {},
    threads: {},
    threadLists: {},
    unreadThreadCounts: {},
    pins: {},
    saved: {},
    threadTyping: {},
    threadFocus: null,
    outgoing: {},
    removedRooms: {},
    removedWorkspaces: {},
    notificationLevels: {},
    activity: {},
    connection: { banner: null, unavailable: null },
  };
  const listeners = new Set<() => void>();
  // Strict Mode で effect が 2 回走っても、同じ取得を 2 本送らない。
  const inflight = new Map<string, Promise<void>>();
  // 同期中にもう一度頼まれたら、終わった後にもう 1 回だけ回す（その間に進んだカーソルから取り直す）
  const syncing = new Map<string, { again: boolean; promise: Promise<void> }>();
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const readTargets = new Map<string, number>();
  const reading = new Map<string, Promise<void>>();
  // ルームごとの送信の順番（client_msg_id）と、送っている途中のループ
  const sendQueues = new Map<string, string[]>();
  const sendLoops = new Map<string, Promise<void>>();

  // いちばん早く来るミュートの期限に張るタイマー（ADR 0055 決定 5）。期限切れのイベントは来ないので、自分で戻す
  let muteTimer: { at: number; timer: ReturnType<typeof setTimeout> } | null = null;

  function update(recipe: (s: ChatState) => ChatState) {
    const next = recipe(state);
    if (next === state) return;
    const roomsChanged = next.rooms !== state.rooms;
    state = next;
    if (roomsChanged) scheduleMuteExpiry();
    for (const listener of listeners) listener();
  }

  /**
   * 期限つきのミュートが切れる時刻にタイマーを張り、切れたら手元の設定を「ミュートなし」に戻す。
   * 表示の側で時計と比べるだけだと、描き直すきっかけがなく、期限が過ぎても薄いままになる（6.14a の DoD）。
   */
  function scheduleMuteExpiry() {
    const at = nextMuteExpiry(
      Object.values(state.rooms).map((r) => r?.notifications),
      now(),
    );
    if (muteTimer?.at === at) return;
    if (muteTimer) clearTimeout(muteTimer.timer);
    muteTimer = null;
    if (at === null) return;
    muteTimer = {
      at,
      timer: setTimeout(() => {
        muteTimer = null;
        const t = now();
        update((s) => {
          let rooms = s.rooms;
          for (const [id, room] of Object.entries(s.rooms)) {
            const n = room?.notifications;
            if (!room || !n?.muted || isMuted(n, t)) continue;
            rooms = { ...rooms, [id]: { ...room, notifications: { ...n, muted: false, muted_until: null } } };
          }
          return rooms === s.rooms ? s : { ...s, rooms };
        });
        // 同じ時刻に切れるものがなかった（時計が戻ったなど）ときも、次の期限に張り直す
        scheduleMuteExpiry();
      }, at - now()),
    };
  }

  function once(key: string, run: () => Promise<void>): Promise<void> {
    let promise = inflight.get(key);
    if (!promise) {
      promise = run().finally(() => inflight.delete(key));
      inflight.set(key, promise);
    }
    return promise;
  }

  function putRoom(room: Room) {
    update((s) => {
      const existing = s.rooms[room.id];
      // member_count は 1 件の取得でだけ返る。一覧で上書きしたときに消さない
      const merged = { ...room, member_count: room.member_count ?? existing?.member_count };
      return { ...s, rooms: { ...s.rooms, [room.id]: merged } };
    });
  }

  function patchRoom(roomId: string, recipe: (room: Room) => Room) {
    update((s) => {
      const room = s.rooms[roomId];
      if (!room) return s;
      const next = recipe(room);
      return next === room ? s : { ...s, rooms: { ...s.rooms, [roomId]: next } };
    });
  }

  function patchTimeline(roomId: string, patch: Partial<TimelineState>) {
    update((s) => {
      const current = s.timelines[roomId];
      if (!current) return s;
      return { ...s, timelines: { ...s.timelines, [roomId]: { ...current, ...patch } } };
    });
  }

  function patchRoomList(workspaceId: string, recipe: (ids: string[]) => string[]) {
    update((s) => {
      const list = s.roomLists[workspaceId];
      if (!list) return s;
      const ids = recipe(list.ids);
      return ids === list.ids ? s : { ...s, roomLists: { ...s.roomLists, [workspaceId]: { ...list, ids } } };
    });
  }

  function patchMembers(roomId: string, recipe: (members: RoomMember[]) => RoomMember[]) {
    update((s) => {
      const current = s.roomMembers[roomId];
      if (!current) return s;
      const members = recipe(current.members);
      return members === current.members
        ? s
        : { ...s, roomMembers: { ...s.roomMembers, [roomId]: { ...current, members } } };
    });
  }

  /** ワークスペースのメンバー一覧（管理画面）を書き換える。まだ取っていなければ何もしない。 */
  function patchWorkspaceMembers(workspaceId: string, recipe: (list: Member[]) => Member[]) {
    update((s) => {
      const current = s.members[workspaceId];
      if (!current) return s;
      const list = recipe(current.list);
      return list === current.list ? s : { ...s, members: { ...s.members, [workspaceId]: { ...current, list } } };
    });
  }

  function patchInvites(workspaceId: string, recipe: (list: Invite[]) => Invite[]) {
    update((s) => {
      const current = s.invites[workspaceId];
      if (!current) return s;
      const list = recipe(current.list);
      return list === current.list ? s : { ...s, invites: { ...s.invites, [workspaceId]: { ...current, list } } };
    });
  }

  function patchWorkspace(workspaceId: string, recipe: (workspace: Workspace) => Workspace) {
    update((s) => {
      const workspace = s.workspaces.list.find((w) => w.id === workspaceId);
      if (!workspace) return s;
      const next = recipe(workspace);
      return next === workspace
        ? s
        : { ...s, workspaces: { ...s.workspaces, list: s.workspaces.list.map((w) => (w.id === workspaceId ? next : w)) } };
    });
  }

  /** 管理画面のメンバー一覧を取り直す。 */
  function loadMembers(workspaceId: string): Promise<void> {
    return once(`wsmembers:${workspaceId}`, async () => {
      update((s) => ({
        ...s,
        members: { ...s.members, [workspaceId]: s.members[workspaceId] ?? { status: "loading", list: [] } },
      }));
      try {
        const list = await api.listAllMembers(workspaceId);
        update((s) => ({ ...s, members: { ...s.members, [workspaceId]: { status: "ready", list } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          members: {
            ...s.members,
            [workspaceId]: { status: statusOf(err), list: s.members[workspaceId]?.list ?? [] },
          },
        }));
        console.error("failed to load workspace members", err);
      }
    });
  }

  /** 取得中のものがあれば、それが終わってからもう 1 回取る（reloadRooms と同じ理由）。 */
  async function reloadMembers(workspaceId: string): Promise<void> {
    await inflight.get(`wsmembers:${workspaceId}`);
    return loadMembers(workspaceId);
  }

  /** 招待は作られた順に返る（ID は ULID）ので、新しい順にして持つ。 */
  function sortInvites(list: Invite[]): Invite[] {
    return [...list].sort((a, b) => b.id.localeCompare(a.id));
  }

  function loadInvites(workspaceId: string): Promise<void> {
    return once(`invites:${workspaceId}`, async () => {
      update((s) => ({
        ...s,
        invites: { ...s.invites, [workspaceId]: s.invites[workspaceId] ?? { status: "loading", list: [] } },
      }));
      try {
        const list = await api.listAllInvites(workspaceId);
        update((s) => ({ ...s, invites: { ...s.invites, [workspaceId]: { status: "ready", list: sortInvites(list) } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          invites: {
            ...s.invites,
            [workspaceId]: { status: statusOf(err), list: s.invites[workspaceId]?.list ?? [] },
          },
        }));
        console.error("failed to load invites", err);
      }
    });
  }

  /** 作った（または開いた）ルームを手元に置き、一覧に足す。作成者にも member.joined が届くので、先に足してあれば足さない。 */
  function addRoom(workspaceId: string, room: Room): Room {
    putRoom(room);
    patchRoomList(workspaceId, (ids) => (ids.includes(room.id) ? ids : insertByActivity(ids, room, state.rooms)));
    return room;
  }

  function patchOutgoing(roomId: string, recipe: (list: OutgoingMessage[]) => OutgoingMessage[]) {
    update((s) => {
      const current = s.outgoing[roomId] ?? [];
      const next = recipe(current);
      if (next === current) return s;
      return { ...s, outgoing: { ...s.outgoing, [roomId]: next.length > 0 ? next : undefined } };
    });
  }

  // ---- スレッド（ADR 0036）----

  function patchThread(rootId: string, recipe: (thread: ThreadState) => ThreadState) {
    update((s) => {
      const thread = s.threads[rootId];
      if (!thread) return s;
      const next = recipe(thread);
      return next === thread ? s : { ...s, threads: { ...s.threads, [rootId]: next } };
    });
  }

  function patchThreadList(workspaceId: string, recipe: (list: FollowedThread[]) => FollowedThread[]) {
    update((s) => {
      const current = s.threadLists[workspaceId];
      if (!current) return s;
      const list = recipe(current.list);
      return list === current.list ? s : { ...s, threadLists: { ...s.threadLists, [workspaceId]: { ...current, list } } };
    });
  }

  /** 自分の既読位置を進める（スレッドとワークスペースの一覧の両方）。 */
  function advanceThreadRead(roomId: string, rootId: string, lastReadThreadSeq: number) {
    patchThread(rootId, (t) =>
      t.lastReadThreadSeq === null || t.lastReadThreadSeq >= lastReadThreadSeq
        ? t
        : { ...t, lastReadThreadSeq: lastReadThreadSeq },
    );
    const workspaceId = state.rooms[roomId]?.workspace_id;
    if (workspaceId) patchThreadList(workspaceId, (list) => applyThreadRead(list, rootId, lastReadThreadSeq));
    if (workspaceId) activityRead(workspaceId, (items) => applyThreadReadToActivity(items, rootId, lastReadThreadSeq));
  }

  /**
   * 届いたメッセージ（イベント・差分・送信の応答）を、スレッドに反映する。
   * - 返信: 開いたことのあるスレッドに足す。自分の返信なら、サーバーが自分の既読位置も進めている
   * - 親（thread を持つ）: スレッドの親と、参加中の一覧の返信数・未読数を書き換える
   */
  /**
   * 届いたメッセージで、取ってあるピン留めの一覧を直す（ADR 0054 決定 2）。
   * ピン留めは message.updated と差分に乗るので、タイムラインと同じ経路でここにも通す。取っていないルームには何もしない。
   */
  function absorbPins(messages: readonly Message[]) {
    const byRoom = new Map<string, Message[]>();
    for (const m of messages) byRoom.set(m.room_id, [...(byRoom.get(m.room_id) ?? []), m]);
    for (const [roomId, list] of byRoom) {
      update((s) => {
        const current = s.pins[roomId];
        if (current?.status !== "ready") return s;
        const next = applyPinnedMessages(current.messages, list);
        return next === current.messages ? s : { ...s, pins: { ...s.pins, [roomId]: { ...current, messages: next } } };
      });
    }
  }

  /** ルームのピン留めの一覧を取る。取り直し（再接続・差分が追いつかない）では、取れるまで手元の一覧を見せる。 */
  function loadPins(roomId: string): Promise<void> {
    return once(`pins:${roomId}`, async () => {
      update((s) => ({
        ...s,
        pins: { ...s.pins, [roomId]: s.pins[roomId] ?? { status: "loading", messages: [] } },
      }));
      try {
        const { messages } = await api.listPins(roomId);
        update((s) => ({ ...s, pins: { ...s.pins, [roomId]: { status: "ready", messages } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          pins: { ...s.pins, [roomId]: { status: statusOf(err), messages: s.pins[roomId]?.messages ?? [] } },
        }));
        if (statusOf(err) === "error") console.error("failed to load pins", err);
      }
    });
  }

  // ---- 「後で」（ADR 0054）----

  // 分かっている保存の状態（message_id → 状態）。「進行中」の件数を、届いた 1 件の前後の差で直すのに使う。
  // 前の状態が分からない（一覧に出ていなかった）ときは、件数だけ取り直す
  const knownSavedStates = new Map<string, SavedItem["state"]>();
  const savedSyncing = new Map<string, { again: boolean; promise: Promise<void> }>();

  function patchSaved(
    workspaceId: string,
    recipe: (saved: NonNullable<ChatState["saved"][string]>) => NonNullable<ChatState["saved"][string]>,
  ) {
    update((s) => {
      const current = s.saved[workspaceId] ?? { tabs: {}, inProgressCount: 0, cursor: null };
      const next = recipe(current);
      return next === current ? s : { ...s, saved: { ...s.saved, [workspaceId]: next } };
    });
  }

  /** メッセージの「保存済み」の印を、置いてある場所すべてで書き換える（決定 10。change_seq は変わらない）。 */
  function markSaved(roomId: string, messageId: string, saved: boolean) {
    patchMessageEverywhere(roomId, messageId, (m) => (m.saved === saved ? m : { ...m, saved }));
    update((s) => {
      const pins = s.pins[roomId];
      if (!pins?.messages.some((m) => m.id === messageId && m.saved !== saved)) return s;
      const messages = pins.messages.map((m) => (m.id === messageId ? { ...m, saved } : m));
      return { ...s, pins: { ...s.pins, [roomId]: { ...pins, messages } } };
    });
  }

  /** 届いた 1 件（イベント・差分・操作の応答）を、タブ・件数・メッセージの印に反映する。カーソルは動かさない。 */
  function absorbSavedItem(item: SavedItem) {
    const previous = knownSavedStates.get(item.message_id);
    knownSavedStates.set(item.message_id, item.state);
    patchSaved(item.workspace_id, (saved) => {
      const tabs = applySavedItem(saved.tabs, item);
      const delta =
        previous === undefined ? 0 : Number(item.state === "in_progress") - Number(previous === "in_progress");
      return tabs === saved.tabs && delta === 0
        ? saved
        : { ...saved, tabs, inProgressCount: Math.max(0, saved.inProgressCount + delta) };
    });
    if (previous === undefined && state.saved[item.workspace_id]?.cursor != null) void refreshSavedCount(item.workspace_id);
    markSaved(item.room_id, item.message_id, item.state !== "removed");
  }

  /**
   * 本人ごとの change_seq で 1 件を受け取る（ADR 0054 決定 7。ルームの change_seq と同じ扱い）。
   * カーソル以下は反映済みなので捨て、カーソル + 1 なら進め、それより先なら間を差分で取り直す。
   */
  function receiveSaved(item: SavedItem) {
    const cursor = state.saved[item.workspace_id]?.cursor ?? null;
    if (cursor !== null && item.change_seq <= cursor) return;
    absorbSavedItem(item);
    if (cursor === null) return;
    if (item.change_seq === cursor + 1) patchSaved(item.workspace_id, (saved) => ({ ...saved, cursor: item.change_seq }));
    else void syncSaved(item.workspace_id);
  }

  /** 「進行中」の件数だけを取り直す（届いた 1 件の前の状態が分からなかったとき）。 */
  function refreshSavedCount(workspaceId: string): Promise<void> {
    return once(`saved-count:${workspaceId}`, async () => {
      try {
        const page = await api.listSaved(workspaceId, "in_progress");
        patchSaved(workspaceId, (saved) => ({ ...saved, inProgressCount: page.in_progress_count }));
      } catch (err) {
        console.error("failed to count saved messages", err);
      }
    });
  }

  /** タブの最初のページを取る。取り直しでは、取れるまで手元の一覧を見せる。 */
  function loadSavedTab(workspaceId: string, tab: SavedTab): Promise<void> {
    return once(`saved:${workspaceId}:${tab}`, async () => {
      patchSaved(workspaceId, (saved) =>
        saved.tabs[tab]
          ? saved
          : { ...saved, tabs: { ...saved.tabs, [tab]: { status: "loading", items: [], hasMore: false, loadingMore: false } } },
      );
      try {
        const page = await api.listSaved(workspaceId, tab);
        for (const item of page.items) knownSavedStates.set(item.message_id, item.state);
        const cursor = state.saved[workspaceId]?.cursor ?? null;
        patchSaved(workspaceId, (saved) => ({
          ...saved,
          tabs: { ...saved.tabs, [tab]: { status: "ready", items: page.items, hasMore: page.has_more, loadingMore: false } },
          inProgressCount: page.in_progress_count,
          // 最初の 1 回でカーソルを決める。一覧より前に読んだ番号なので、読んでいる間の変更は差分に必ず出る
          cursor: saved.cursor ?? page.last_change_seq,
        }));
        // すでにカーソルがあって、それより先の変更が起きていた（取りこぼした）なら、差分で追いつく
        if (cursor !== null && page.last_change_seq > cursor) void syncSaved(workspaceId);
      } catch (err) {
        patchSaved(workspaceId, (saved) => {
          const current = saved.tabs[tab];
          return {
            ...saved,
            tabs: { ...saved.tabs, [tab]: { status: "error", items: current?.items ?? [], hasMore: false, loadingMore: false } },
          };
        });
        console.error("failed to load saved messages", err);
      }
    });
  }

  /** 差分を 1 ページずつ読んで、カーソルまで追いつく（再接続・番号の飛び）。 */
  function syncSaved(workspaceId: string): Promise<void> {
    const running = savedSyncing.get(workspaceId);
    if (running) {
      running.again = true;
      return running.promise;
    }
    const entry = { again: false, promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          for (;;) {
            const cursor = state.saved[workspaceId]?.cursor;
            if (cursor == null) return;
            const page = await api.listSavedChanges(workspaceId, cursor);
            for (const item of page.items) absorbSavedItem(item);
            // last_change_seq は差分を読む前の値なので、最後のページのときだけカーソルに使ってよい（ルームと同じ）
            const newest = Math.max(cursor, ...page.items.map((i) => i.change_seq));
            const next = page.has_more ? newest : Math.max(newest, page.last_change_seq);
            patchSaved(workspaceId, (saved) => ({ ...saved, cursor: Math.max(saved.cursor ?? 0, next) }));
            if (!page.has_more) break;
          }
        } while (entry.again);
      } catch (err) {
        console.error("failed to sync saved messages", err);
      } finally {
        savedSyncing.delete(workspaceId);
      }
    })();
    savedSyncing.set(workspaceId, entry);
    return entry.promise;
  }

  function findSavedItem(workspaceId: string, messageId: string): SavedItem | undefined {
    for (const tab of Object.values(state.saved[workspaceId]?.tabs ?? {})) {
      const found = tab?.items.find((i) => i.message_id === messageId);
      if (found) return found;
    }
    return undefined;
  }

  async function reloadSavedTabs(workspaceId: string) {
    const tabs = Object.keys(state.saved[workspaceId]?.tabs ?? {}) as SavedTab[];
    await Promise.all(tabs.map((tab) => loadSavedTab(workspaceId, tab)));
  }

  /**
   * 外す。DELETE は 204 で 1 件を返さないので、手元では先に一覧から外し、番号はイベント（saved.updated）で進める。
   * 失敗したらタブを取り直す。
   */
  async function removeSavedNow(workspaceId: string, messageId: string, roomId: string | undefined) {
    const item = findSavedItem(workspaceId, messageId);
    if (item) absorbSavedItem({ ...item, state: "removed", room: null, message: null, status: "unavailable" });
    else if (roomId) markSaved(roomId, messageId, false);
    try {
      await api.removeSaved(workspaceId, messageId);
    } catch (err) {
      await reloadSavedTabs(workspaceId);
      throw err;
    }
  }

  function absorbThreadMessages(messages: readonly Message[], created: boolean) {
    for (const message of messages) {
      const rootId = message.thread_root_id;
      if (rootId !== null) {
        patchThread(rootId, (t) => {
          const replies = mergeRepliesIntoWindow(t.replies, t, [message]);
          return replies === t.replies ? t : { ...t, replies };
        });
        if (created) {
          const workspaceId = state.rooms[message.room_id]?.workspace_id;
          if (workspaceId) patchThreadList(workspaceId, (list) => applyReplyToThreads(list, message, userId));
        }
        if (created && message.sender.id === userId && message.thread_seq !== null) {
          advanceThreadRead(message.room_id, rootId, message.thread_seq);
        }
        if (created) removeThreadTyping(rootId, message.sender.id);
      }
      if (message.thread !== null) {
        patchThread(message.id, (t) =>
          t.root && t.root.change_seq > message.change_seq ? t : { ...t, root: message },
        );
        const workspaceId = state.rooms[message.room_id]?.workspace_id;
        if (workspaceId) patchThreadList(workspaceId, (list) => applyRootToThreads(list, message));
      } else {
        // 親の削除（tombstone）や編集。返信がまだないメッセージは親として持っていないので、開いていたときだけ書き換える
        patchThread(message.id, (t) =>
          t.root && t.root.change_seq > message.change_seq ? t : { ...t, root: message },
        );
      }
    }
  }

  function removeThreadTyping(rootId: string, typingUserId: string) {
    const key = `thread:${rootId}:${typingUserId}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.delete(key);
    update((s) => {
      const current = s.threadTyping[rootId];
      if (!current?.some((t) => t.user.id === typingUserId)) return s;
      const rest = current.filter((t) => t.user.id !== typingUserId);
      return { ...s, threadTyping: { ...s.threadTyping, [rootId]: rest.length > 0 ? rest : undefined } };
    });
  }

  function receiveThreadTyping(rootId: string, user: UserProfile) {
    if (user.id === userId) return;
    const key = `thread:${rootId}:${user.id}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.set(key, setTimeout(() => removeThreadTyping(rootId, user.id), TYPING_TTL_MS));
    update((s) => {
      const others = (s.threadTyping[rootId] ?? []).filter((t) => t.user.id !== user.id);
      return {
        ...s,
        threadTyping: { ...s.threadTyping, [rootId]: [...others, { user, expiresAt: now() + TYPING_TTL_MS }] },
      };
    });
  }

  function loadThreads(workspaceId: string): Promise<void> {
    return once(`threads:${workspaceId}`, async () => {
      update((s) =>
        s.threadLists[workspaceId]
          ? s
          : { ...s, threadLists: { ...s.threadLists, [workspaceId]: { status: "loading", list: [] } } },
      );
      try {
        const list = await api.listAllThreads(workspaceId);
        update((s) => ({ ...s, threadLists: { ...s.threadLists, [workspaceId]: { status: "ready", list } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          threadLists: {
            ...s.threadLists,
            [workspaceId]: { status: statusOf(err), list: s.threadLists[workspaceId]?.list ?? [] },
          },
        }));
        if (statusOf(err) === "error") console.error("failed to load threads", err);
      }
    });
  }

  /** スレッドのパネルを開いた。まだ取っていなければ最新のページを取る（飛ぶ処理の中からも呼ぶ）。 */
  function loadThreadIfNeeded(roomId: string, rootId: string): Promise<void> {
    const current = state.threads[rootId];
    if (current?.status === "ready" && current.roomId === roomId) return Promise.resolve();
    return loadThread(roomId, rootId);
  }

  /** 取得中のものがあれば、それが終わってからもう 1 回取る（reloadRooms と同じ理由）。 */
  async function reloadThreads(workspaceId: string): Promise<void> {
    await inflight.get(`threads:${workspaceId}`);
    return loadThreads(workspaceId);
  }

  /**
   * スレッドの最新のページを取る。取得の間に届いた返信は残す（openRoom と同じ）。
   * 取り直し（再接続）では、取れるまで手元の状態をそのまま見せる。既読位置も後退させない。
   */
  function loadThread(roomId: string, rootId: string): Promise<void> {
    return once(`thread:${rootId}`, async () => {
      update((s) => {
        const current = s.threads[rootId];
        if (current && current.roomId === roomId) return s;
        const thread: ThreadState = {
          status: "loading",
          roomId,
          root: null,
          replies: [],
          hasOlder: false,
          loadingOlder: false,
          hasNewer: false,
          loadingNewer: false,
          lastReadThreadSeq: null,
        };
        return { ...s, threads: { ...s.threads, [rootId]: thread } };
      });
      try {
        const page = await api.listThreadMessages(roomId, rootId);
        update((s) => {
          const current = s.threads[rootId];
          const arrived = (current?.replies ?? []).filter((m) => m.change_seq > page.last_change_seq);
          const replies = mergeRepliesIntoWindow(
            mergeReplies([], page.messages),
            { hasOlder: page.has_more, hasNewer: false },
            arrived,
          );
          const root = current?.root && current.root.change_seq > page.root.change_seq ? current.root : page.root;
          const lastRead =
            page.last_read_thread_seq === null
              ? null
              : Math.max(page.last_read_thread_seq, current?.lastReadThreadSeq ?? 0);
          return {
            ...s,
            threads: {
              ...s.threads,
              [rootId]: {
                status: "ready",
                roomId,
                root,
                replies,
                hasOlder: page.has_more,
                loadingOlder: false,
                hasNewer: false,
                loadingNewer: false,
                lastReadThreadSeq: lastRead,
              },
            },
          };
        });
      } catch (err) {
        patchThread(rootId, (t) => ({ ...t, status: statusOf(err) }));
        if (statusOf(err) === "error") console.error("failed to load thread", err);
      }
    });
  }

  // ---- 既読 ----

  async function markRead(roomId: string, seq: number): Promise<void> {
    const read = await api.markRead(roomId, { seq });
    patchRoom(roomId, (room) =>
      applyReadToRoom(room, {
        lastReadSeq: read.last_read_seq,
        lastReadUserSeq: read.last_read_user_seq,
        mentionCount: read.mention_count,
      }),
    );
    roomReadAdvanced(roomId, read.last_read_user_seq);
  }

  // ---- アクティビティ（ADR 0058） ----

  // 未読の件数に足したメッセージ。同じメッセージが送信の応答と message.created の両方で届いても、1 回だけ数える
  const countedActivity = new Set<string>();

  function patchActivity(
    workspaceId: string,
    recipe: (activity: NonNullable<ChatState["activity"][string]>) => NonNullable<ChatState["activity"][string]>,
  ) {
    update((s) => {
      const current = s.activity[workspaceId] ?? { lists: {}, unreadCount: null };
      const next = recipe(current);
      return next === current ? s : { ...s, activity: { ...s.activity, [workspaceId]: next } };
    });
  }

  /** 読み込んだ一覧すべての 1 件ずつを書き換える。変わらない一覧は作り直さない。 */
  function patchActivityItems(workspaceId: string, recipe: (items: ActivityItem[], key: string) => ActivityItem[]) {
    patchActivity(workspaceId, (activity) => {
      let lists = activity.lists;
      for (const [key, list] of Object.entries(activity.lists)) {
        if (!list || list.status !== "ready") continue;
        const items = recipe(list.items, key);
        if (items === list.items) continue;
        if (lists === activity.lists) lists = { ...activity.lists };
        lists[key] = { ...list, items };
      }
      return lists === activity.lists ? activity : { ...activity, lists };
    });
  }

  function loadActivityList(workspaceId: string, filter: ActivityFilter, unreadOnly: boolean, reload = false): Promise<void> {
    const key = activityListKey(filter, unreadOnly);
    if (!reload && state.activity[workspaceId]?.lists[key]?.status === "ready") return Promise.resolve();
    return once(`activity:${workspaceId}:${key}`, async () => {
      patchActivity(workspaceId, (activity) =>
        activity.lists[key]
          ? activity
          : { ...activity, lists: { ...activity.lists, [key]: { status: "loading", items: [], nextCursor: null, loadingMore: false } } },
      );
      try {
        const page = await api.listActivity(workspaceId, { filter, unreadOnly });
        patchActivity(workspaceId, (activity) => ({
          ...activity,
          lists: {
            ...activity.lists,
            [key]: { status: "ready", items: page.items, nextCursor: page.next_cursor, loadingMore: false },
          },
        }));
      } catch (err) {
        patchActivity(workspaceId, (activity) => ({
          ...activity,
          lists: {
            ...activity.lists,
            [key]: { status: "error", items: activity.lists[key]?.items ?? [], nextCursor: null, loadingMore: false },
          },
        }));
        console.error("failed to load activity", err);
      }
    });
  }

  function loadActivityUnreadCount(workspaceId: string): Promise<void> {
    return once(`activity-count:${workspaceId}`, async () => {
      try {
        const { count } = await api.activityUnreadCount(workspaceId);
        patchActivity(workspaceId, (activity) => (activity.unreadCount === count ? activity : { ...activity, unreadCount: count }));
      } catch (err) {
        console.error("failed to count unread activity", err);
      }
    });
  }

  /**
   * 手元で合わせきれない変化（通知の設定・ルームから外れた・再接続）の後に、読み込んでいる一覧と件数を取り直す。
   * 行を持たない API なので、差分のカーソルはない（決定 9）。
   */
  function reloadActivity(workspaceId: string): Promise<void> {
    const activity = state.activity[workspaceId];
    if (!activity) return Promise.resolve();
    const tasks = Object.keys(activity.lists).map((key) => {
      const { filter, unreadOnly } = parseActivityListKey(key);
      return loadActivityList(workspaceId, filter, unreadOnly, true);
    });
    if (activity.unreadCount !== null) tasks.push(loadActivityUnreadCount(workspaceId));
    return Promise.all(tasks).then(() => undefined);
  }

  /** 既読位置が進んだ。手元の 1 件の未読を求め直し、件数は取り直す（読み込んでいない 1 件もあるため）。 */
  function activityRead(workspaceId: string, recipe: (items: ActivityItem[]) => ActivityItem[]) {
    const activity = state.activity[workspaceId];
    if (!activity) return;
    patchActivityItems(workspaceId, (items, key) => {
      const read = recipe(items);
      // 「未読メッセージ」の一覧からは、読んだ 1 件を外す
      return parseActivityListKey(key).unreadOnly ? removeActivity(read, (i) => !i.unread) : read;
    });
    if (activity.unreadCount !== null) void loadActivityUnreadCount(workspaceId);
  }

  function roomReadAdvanced(roomId: string, lastReadUserSeq: number) {
    const workspaceId = state.rooms[roomId]?.workspace_id;
    if (workspaceId) activityRead(workspaceId, (items) => applyRoomReadToActivity(items, roomId, lastReadUserSeq));
  }

  /**
   * 届いたメッセージを、通知の規則（notifyReasons）で当てはまる一覧に足す（決定 9）。
   * 手元にある値（ルームの設定・全体の設定・参加中のスレッド）で判断する。ずれは次に取り直したときに直る。
   */
  function receiveActivityMessage(message: Message) {
    const room = state.rooms[message.room_id];
    const workspaceId = room?.workspace_id;
    if (!room || !workspaceId || !state.activity[workspaceId]) return;
    const thread =
      message.thread_root_id === null
        ? undefined
        : state.threadLists[workspaceId]?.list.find((t) => t.root.id === message.thread_root_id);
    const reasons = notifyReasons(
      { message, userId, room, level: state.notificationLevels[workspaceId], thread, now: now() },
      { countHere: true },
    );
    if (reasons.length === 0) return;
    const unread = inChannel(message)
      ? message.user_seq > (room.last_read_user_seq ?? 0)
      : thread !== undefined && thread.last_read_thread_seq !== null && (message.thread_seq ?? 0) > thread.last_read_thread_seq;
    const item = messageActivityItem(message, room, reasons, unread);
    patchActivityItems(workspaceId, (items, key) => {
      const { filter, unreadOnly } = parseActivityListKey(key);
      return belongsTo(item, filter, unreadOnly) ? insertActivity(items, item) : items;
    });
    if (unread && !countedActivity.has(message.id)) {
      countedActivity.add(message.id);
      patchActivity(workspaceId, (activity) =>
        activity.unreadCount === null
          ? activity
          : { ...activity, unreadCount: Math.min(MAX_UNREAD_ACTIVITY, activity.unreadCount + 1) },
      );
    }
  }

  /** 編集・削除を一覧の 1 件に当てる。削除されたメッセージ（とそのリアクション）は外す。 */
  function receiveActivityChange(message: Message) {
    const workspaceId = state.rooms[message.room_id]?.workspace_id;
    const activity = workspaceId ? state.activity[workspaceId] : undefined;
    if (!workspaceId || !activity) return;
    let removedUnread = false;
    patchActivityItems(workspaceId, (items) => {
      if (!items.some((i) => i.message.id === message.id)) return items;
      if (message.deleted_at !== null) {
        removedUnread ||= items.some((i) => i.message.id === message.id && i.unread);
        return removeActivity(items, (i) => i.message.id === message.id);
      }
      return items.map((i) => (i.message.id === message.id ? { ...i, message } : i));
    });
    if (removedUnread && activity.unreadCount !== null) void loadActivityUnreadCount(workspaceId);
  }

  /**
   * 既読を頼む。送信中なら、終わった後にいちばん大きい seq でもう 1 回だけ送る（届くたびに 1 本ずつ送らない）。
   * 返す Promise は、頼んだ分を送り終えたら解決する（失敗はログに出して投げない）。
   */
  function requestMarkRead(roomId: string, seq: number): Promise<void> {
    const room = state.rooms[roomId];
    if (!room || room.last_read_seq === null || room.last_read_seq >= seq) return Promise.resolve();
    readTargets.set(roomId, Math.max(readTargets.get(roomId) ?? 0, seq));
    let loop = reading.get(roomId);
    if (!loop) {
      loop = (async () => {
        try {
          for (let target = readTargets.get(roomId); target !== undefined; target = readTargets.get(roomId)) {
            readTargets.delete(roomId);
            await markRead(roomId, target);
          }
        } catch (err) {
          readTargets.delete(roomId);
          console.error("failed to mark room read", err);
        } finally {
          reading.delete(roomId);
        }
      })();
      reading.set(roomId, loop);
    }
    return loop;
  }

  // ---- タイムライン ----

  /**
   * タイムラインにメッセージを足した後の、「ここから未読」と既読の扱い。
   *
   * - 最新を見ている（または足されたのが自分のメッセージだけ）なら、区切りがまだ出ていないときだけ区切りを後ろに送り、既読にする
   * - 見ていないなら、区切りを消していた場合はそれまでの最新の後ろに出し直す。既読にはしない
   */
  function afterNewMessages(roomId: string, previousNewest: number | undefined, added: readonly Message[]) {
    const timeline = state.timelines[roomId];
    const room = state.rooms[roomId];
    const newest = timeline ? newestChannelSeq(timeline.messages) : undefined;
    if (!timeline || timeline.status !== "ready" || newest === undefined || previousNewest === undefined) return;
    if (newest <= previousNewest || !room || room.last_read_seq === null) return;

    const seen =
      (state.focus?.roomId === roomId && state.focus.caughtUp) ||
      added.filter((m) => m.seq > previousNewest && inChannel(m)).every((m) => m.sender.id === userId);
    if (seen) {
      if (timeline.unreadAfterSeq !== null && timeline.unreadAfterSeq >= previousNewest) {
        patchTimeline(roomId, { unreadAfterSeq: newest });
      }
      if (state.focus?.roomId === roomId) void requestMarkRead(roomId, newest);
    } else if (timeline.unreadAfterSeq === null) {
      patchTimeline(roomId, { unreadAfterSeq: previousNewest });
    }
  }

  /** 差分の取得を 1 回行う。遅れすぎていたら（1 ページで追いつかない）、最新のページで置き換える。 */
  async function syncOnce(roomId: string) {
    const timeline = state.timelines[roomId];
    if (!timeline || timeline.status !== "ready") return;
    const previousNewest = newestChannelSeq(timeline.messages);

    const page = await api.listChanges(roomId, timeline.changeSeq);
    absorbThreadMessages(page.messages, false);
    absorbPins(page.messages);
    for (const message of page.messages) reflectChangeInRoom(message);
    if (!page.has_more) {
      update((s) => {
        const current = s.timelines[roomId];
        if (!current) return s;
        const messages = mergeIntoWindow(current.messages, current, page.messages);
        // last_change_seq はメッセージを読む前の値なので、最後のページのときだけカーソルに使ってよい（ADR 0014）
        const changeSeq = advanceCursor(Math.max(current.changeSeq, page.last_change_seq), messages);
        return { ...s, timelines: { ...s.timelines, [roomId]: { ...current, messages, changeSeq } } };
      });
      afterNewMessages(roomId, previousNewest, page.messages);
      return;
    }

    // 手元との間が 1 ページ（100 件の変更）を超えた。全部たどると、読み込んでいない範囲の変更まで取ることになるので、
    // 最新のページを読み直す。その間に届いたイベントは残す。ピン留めの一覧も、たどらなかった変更の分を取り直す
    if (state.pins[roomId]) void loadPins(roomId);
    const latest = await api.listMessages(roomId);
    update((s) => {
      const current = s.timelines[roomId];
      if (!current) return s;
      const base = mergeMessages([], latest.messages);
      const arrived = current.messages.filter((m) => m.change_seq > latest.last_change_seq);
      const messages = mergeIntoWindow(base, { hasOlder: latest.has_more, hasNewer: false }, arrived);
      return {
        ...s,
        timelines: {
          ...s.timelines,
          [roomId]: {
            ...current,
            messages,
            hasOlder: latest.has_more,
            // 最新のページで置き換えたので、新しい側はつながっている
            hasNewer: false,
            changeSeq: advanceCursor(latest.last_change_seq, messages),
          },
        },
      };
    });
    afterNewMessages(roomId, previousNewest, latest.messages);
  }

  function syncTimeline(roomId: string): Promise<void> {
    const running = syncing.get(roomId);
    if (running) {
      running.again = true;
      return running.promise;
    }
    const entry = { again: false, promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          await syncOnce(roomId);
        } while (entry.again);
      } catch (err) {
        if (statusOf(err) === "not_found") patchTimeline(roomId, { status: "not_found" });
        else console.error("failed to sync messages", err);
      } finally {
        syncing.delete(roomId);
      }
    })();
    syncing.set(roomId, entry);
    return entry.promise;
  }

  // ---- 送信 ----

  /**
   * ルームの送信を 1 件ずつ順に送る。
   *
   * 並行して送ると、後に入力したメッセージが先に採番されることがある（並びは seq で決まる）。
   * 1 件が失敗したら、後ろに並んでいるものも送らずに失敗にする。先に送ると、失敗したものを再送したときに順番が入れ替わるため。
   */
  function runSendQueue(roomId: string): Promise<void> {
    let loop = sendLoops.get(roomId);
    if (loop) return loop;
    loop = (async () => {
      try {
        for (let queue = sendQueues.get(roomId); queue && queue.length > 0; queue = sendQueues.get(roomId)) {
          const item = state.outgoing[roomId]?.find((m) => m.clientMsgId === queue[0]);
          // 確定済み（応答より先にイベントが届いた）か、取り消された
          if (!item || item.status !== "pending") {
            queue.shift();
            continue;
          }
          try {
            await sendOne(roomId, item);
            queue.shift();
          } catch (err) {
            failQueue(roomId);
            if (!(err instanceof SendTimeoutError)) console.error("failed to send a message", err);
          }
        }
      } finally {
        sendLoops.delete(roomId);
      }
    })();
    sendLoops.set(roomId, loop);
    return loop;
  }

  async function sendOne(roomId: string, item: OutgoingMessage) {
    const sending = api.sendMessage(roomId, {
      client_msg_id: item.clientMsgId,
      body: item.body,
      ...(item.threadRootId === null ? {} : { thread_root_id: item.threadRootId, also_in_channel: item.alsoInChannel }),
      ...(item.attachments.length === 0 ? {} : { attachment_ids: item.attachments.map((a) => a.id) }),
    });
    // 待ちきれずに失敗にした後で応答が届いても、確定として扱う（同じ client_msg_id の再送は同じメッセージを返す）
    sending.then((message) => receiveMessage(message, true)).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        sending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new SendTimeoutError()), sendTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function failQueue(roomId: string) {
    const queued = new Set(sendQueues.get(roomId) ?? []);
    sendQueues.delete(roomId);
    patchOutgoing(roomId, (list) =>
      list.some((m) => queued.has(m.clientMsgId) && m.status === "pending")
        ? list.map((m) => (queued.has(m.clientMsgId) && m.status === "pending" ? { ...m, status: "failed" } : m))
        : list,
    );
  }

  function enqueueSend(roomId: string, clientMsgId: string) {
    const queue = sendQueues.get(roomId) ?? [];
    queue.push(clientMsgId);
    sendQueues.set(roomId, queue);
    void runSendQueue(roomId);
  }

  function dropOutgoing(roomId: string) {
    sendQueues.delete(roomId);
    update((s) => (s.outgoing[roomId] ? { ...s, outgoing: { ...s.outgoing, [roomId]: undefined } } : s));
  }

  // ---- イベント ----

  function receiveMessage(message: Message, created: boolean) {
    const roomId = message.room_id;
    // 自分の送信が確定した（送信の応答か、message.created のどちらか先に届いた方）。楽観的な表示を外す
    if (created && message.sender.id === userId) {
      patchOutgoing(roomId, (list) =>
        list.some((m) => m.clientMsgId === message.client_msg_id)
          ? list.filter((m) => m.clientMsgId !== message.client_msg_id)
          : list,
      );
    }
    const before = state.rooms[roomId];
    if (created) patchRoom(roomId, (room) => applyMessageToRoom(room, message, userId, true));
    else reflectChangeInRoom(message);
    const after = state.rooms[roomId];
    // 新しいメッセージのルームを一覧の先頭に移す（最後のメッセージが新しい順）
    if (created && before && after && after !== before) {
      patchRoomList(after.workspace_id, (ids) =>
        ids[0] === roomId || !ids.includes(roomId) ? ids : [roomId, ...ids.filter((id) => id !== roomId)],
      );
    }
    if (created && message.thread_root_id === null) removeTyping(roomId, message.sender.id);
    absorbThreadMessages([message], created);
    absorbPins([message]);

    const timeline = state.timelines[roomId];
    if (!timeline) return;
    if (timeline.status === "loading") {
      // 開いている途中に届いた。取得の結果と合わせるので、範囲を決めずに持っておく
      patchTimeline(roomId, { messages: mergeMessages(timeline.messages, [message]) });
      return;
    }
    if (timeline.status !== "ready" || message.change_seq <= timeline.changeSeq) return;

    const previousNewest = newestChannelSeq(timeline.messages);
    const messages = mergeIntoWindow(timeline.messages, timeline, [message]);
    // 読み込んでいない範囲の変更は足さないが、番号が続いていれば反映したことにしてよい（表示するものがない）
    const next = message.change_seq === timeline.changeSeq + 1 ? message.change_seq : timeline.changeSeq;
    const changeSeq = advanceCursor(next, messages);
    patchTimeline(roomId, { messages, changeSeq });
    afterNewMessages(roomId, previousNewest, [message]);
    // 間の変更が届いていない（落ちたか、順序が入れ替わった）。差分を取り直す
    if (message.change_seq > timeline.changeSeq + 1 && changeSeq < message.change_seq) void syncTimeline(roomId);
  }

  /**
   * 1 件のメッセージを、置いてある場所すべて（タイムライン・スレッドの返信・スレッドの親）で書き換える。
   * リアクションの楽観的更新（ADR 0044 決定 8）のように、change_seq が変わらない書き換えに使う
   * （change_seq が進む変更は receiveMessage を通す）。
   */
  function patchMessageEverywhere(roomId: string, messageId: string, recipe: (message: Message) => Message) {
    const timeline = state.timelines[roomId];
    if (timeline?.messages.some((m) => m.id === messageId)) {
      patchTimeline(roomId, { messages: timeline.messages.map((m) => (m.id === messageId ? recipe(m) : m)) });
    }
    for (const rootId of Object.keys(state.threads)) {
      patchThread(rootId, (t) => {
        const root = t.root?.id === messageId ? recipe(t.root) : t.root;
        const replies = t.replies.some((m) => m.id === messageId)
          ? t.replies.map((m) => (m.id === messageId ? recipe(m) : m))
          : t.replies;
        return root === t.root && replies === t.replies ? t : { ...t, root, replies };
      });
    }
  }

  /** 手元にある 1 件のメッセージ。タイムラインに無ければスレッドの返信と親からも探す。 */
  function findMessage(roomId: string, messageId: string): Message | undefined {
    const inTimeline = state.timelines[roomId]?.messages.find((m) => m.id === messageId);
    if (inTimeline) return inTimeline;
    for (const thread of Object.values(state.threads)) {
      if (thread?.root?.id === messageId) return thread.root;
      const reply = thread?.replies.find((m) => m.id === messageId);
      if (reply) return reply;
    }
    return undefined;
  }

  /**
   * 既存のメッセージの編集・削除を、サイドバーの最後の 1 行に反映する。イベントでも差分の取得でも同じように通す。
   * 最後のメッセージが削除されたら、ひとつ前（削除されていない最後の行）をサーバーに聞く（ADR 0038）。
   */
  function reflectChangeInRoom(message: Message) {
    const before = state.rooms[message.room_id];
    patchRoom(message.room_id, (room) => applyMessageToRoom(room, message, userId, false));
    if (before?.last_message?.id === message.id && message.deleted_at !== null) void refreshRoom(message.room_id);
  }

  function removeTyping(roomId: string, typingUserId: string) {
    const key = `${roomId}:${typingUserId}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.delete(key);
    update((s) => {
      const list = s.typing[roomId];
      if (!list?.some((t) => t.user.id === typingUserId)) return s;
      const rest = list.filter((t) => t.user.id !== typingUserId);
      return { ...s, typing: { ...s.typing, [roomId]: rest.length > 0 ? rest : undefined } };
    });
  }

  function receiveTyping(roomId: string, user: UserProfile) {
    if (user.id === userId) return;
    const key = `${roomId}:${user.id}`;
    clearTimeout(typingTimers.get(key));
    typingTimers.set(key, setTimeout(() => removeTyping(roomId, user.id), TYPING_TTL_MS));
    update((s) => {
      const others = (s.typing[roomId] ?? []).filter((t) => t.user.id !== user.id);
      return { ...s, typing: { ...s.typing, [roomId]: [...others, { user, expiresAt: now() + TYPING_TTL_MS }] } };
    });
  }

  /** ルームの情報（メンバー数・参加の状態）を取り直す。 */
  function refreshRoom(roomId: string): Promise<void> {
    return once(`room-info:${roomId}`, async () => {
      try {
        putRoom(await api.getRoom(roomId));
      } catch (err) {
        if (statusOf(err) === "error") console.error("failed to refresh room", err);
      }
    });
  }

  /** 自分がルームのメンバーになった（別のタブでの作成・参加、DM、追加、招待の受け入れ）。 */
  function joinedRoom(workspaceId: string, roomId: string): Promise<void> {
    return once(`joined:${roomId}`, async () => {
      let room: Room;
      try {
        room = await api.getRoom(roomId);
      } catch (err) {
        console.error("failed to load a joined room", err);
        return;
      }
      putRoom(room);
      update((s) => {
        if (!s.removedRooms[roomId]) return s;
        return { ...s, removedRooms: { ...s.removedRooms, [roomId]: undefined } };
      });
      patchRoomList(workspaceId, (ids) => (ids.includes(roomId) ? ids : insertByActivity(ids, room, state.rooms)));
    });
  }

  function removedFromRoom(workspaceId: string, roomId: string, reason: RemovalReason) {
    const room = state.rooms[roomId];
    // ルームを抜けるとスレッドへの参加も消える（thread_members は room_members への FK を持つ。ADR 0036）
    patchThreadList(workspaceId, (list) =>
      list.some((t) => t.room.id === roomId) ? list.filter((t) => t.room.id !== roomId) : list,
    );
    update((s) => {
      const ids = Object.entries(s.threads).flatMap(([id, t]) => (t?.roomId === roomId ? [id] : []));
      if (ids.length === 0) return s;
      const threads = { ...s.threads };
      for (const id of ids) threads[id] = room?.kind === "public" ? { ...threads[id]!, lastReadThreadSeq: null } : undefined;
      return { ...s, threads };
    });
    if (room?.kind === "public") {
      // 参加していなくても読めるので、一覧にも画面にも残し、参加していない状態に戻す
      patchRoom(roomId, (r) => ({ ...r, is_member: false, last_read_seq: null, unread_count: 0 }));
      patchTimeline(roomId, { unreadAfterSeq: null });
      return;
    }
    update((s) => ({
      ...s,
      removedRooms: { ...s.removedRooms, [roomId]: reason },
      timelines: { ...s.timelines, [roomId]: undefined },
      roomMembers: { ...s.roomMembers, [roomId]: undefined },
      typing: { ...s.typing, [roomId]: undefined },
    }));
    // もう投稿できない。送信中のものは届かず、再送もできない
    dropOutgoing(roomId);
    // 開いていても一覧からはすぐに消す。名前も含めて、もう見せてよいものではない（ADR 0035）
    patchRoomList(workspaceId, (ids) => ids.filter((id) => id !== roomId));
  }

  function removedFromWorkspace(workspaceId: string, reason: RemovalReason) {
    update((s) => {
      const workspace = s.workspaces.list.find((w) => w.id === workspaceId);
      if (!workspace) return s;
      return {
        ...s,
        workspaces: { ...s.workspaces, list: s.workspaces.list.filter((w) => w.id !== workspaceId) },
        removedWorkspaces: { ...s.removedWorkspaces, [workspaceId]: { reason, workspace } },
      };
    });
  }

  function applyEvent(event: ServerEvent) {
    switch (event.type) {
      case "message.created":
        receiveMessage(event.data, true);
        receiveActivityMessage(event.data);
        return;
      case "message.updated":
      case "message.deleted":
        receiveMessage(event.data, false);
        receiveActivityChange(event.data);
        return;

      case "member.joined": {
        const { workspace_id, room_id, user } = event.data;
        // ワークスペースに入った人のイベントはない（docs/events.md）。招待の受け入れは既定のルームへの参加として届くので、
        // 管理画面を開いていて、まだ一覧にいない人なら取り直す
        if (state.members[workspace_id] && !state.members[workspace_id].list.some((m) => m.user.id === user.id)) {
          void reloadMembers(workspace_id);
        }
        if (user.id === userId) {
          void joinedRoom(workspace_id, room_id);
          return;
        }
        if (state.roomMembers[room_id]) void reloadRoomMembers(room_id);
        if (state.rooms[room_id]?.member_count !== undefined) void refreshRoom(room_id);
        return;
      }
      case "member.left": {
        const { room_id, user_id } = event.data;
        // 自分のことは room.member_removed で扱う
        if (user_id === userId) return;
        patchMembers(room_id, (members) =>
          members.some((m) => m.user.id === user_id) ? members.filter((m) => m.user.id !== user_id) : members,
        );
        if (state.rooms[room_id]?.member_count !== undefined) void refreshRoom(room_id);
        removeTyping(room_id, user_id);
        return;
      }
      case "room.updated": {
        const { room_id, name, is_default } = event.data;
        patchRoom(room_id, (room) =>
          room.name === name && room.is_default === is_default ? room : { ...room, name, is_default },
        );
        return;
      }
      case "room.member_removed":
        removedFromRoom(event.data.workspace_id, event.data.room_id, event.data.reason);
        // 読めなくなったルームの 1 件は、取り直すと消える（決定 4）
        void reloadActivity(event.data.workspace_id);
        return;
      case "room.read":
        patchRoom(event.data.room_id, (room) =>
          applyReadToRoom(room, {
            lastReadSeq: event.data.last_read_seq,
            lastReadUserSeq: event.data.last_read_user_seq,
            mentionCount: event.data.mention_count,
          }),
        );
        roomReadAdvanced(event.data.room_id, event.data.last_read_user_seq);
        return;

      case "workspace.updated": {
        const { workspace_id, name, invite_policy } = event.data;
        update((s) => ({
          ...s,
          workspaces: {
            ...s.workspaces,
            list: s.workspaces.list.map((w) => (w.id === workspace_id ? { ...w, name, invite_policy } : w)),
          },
        }));
        return;
      }
      case "workspace.member_removed":
        patchWorkspaceMembers(event.data.workspace_id, (list) =>
          list.some((m) => m.user.id === event.data.user_id)
            ? list.filter((m) => m.user.id !== event.data.user_id)
            : list,
        );
        // ほかの人のことは、ルームごとの member.left で扱う
        if (event.data.user_id === userId) removedFromWorkspace(event.data.workspace_id, event.data.reason);
        return;
      case "workspace.role_changed": {
        const { workspace_id, user_id, role } = event.data;
        patchWorkspaceMembers(workspace_id, (list) =>
          list.some((m) => m.user.id === user_id && m.role !== role)
            ? list.map((m) => (m.user.id === user_id ? { ...m, role } : m))
            : list,
        );
        update((s) => {
          const roomMembers = { ...s.roomMembers };
          for (const [roomId, entry] of Object.entries(s.roomMembers)) {
            if (!entry || s.rooms[roomId]?.workspace_id !== workspace_id) continue;
            if (!entry.members.some((m) => m.user.id === user_id && m.role !== role)) continue;
            roomMembers[roomId] = {
              ...entry,
              members: entry.members.map((m) => (m.user.id === user_id ? { ...m, role } : m)),
            };
          }
          const list =
            user_id === userId
              ? s.workspaces.list.map((w) => (w.id === workspace_id ? { ...w, my_role: role } : w))
              : s.workspaces.list;
          return { ...s, roomMembers, workspaces: { ...s.workspaces, list } };
        });
        return;
      }
      case "presence.changed": {
        // 自動で決まる状態だけが届く。手動の離席とカスタムステータスは member.status_changed（ADR 0049）
        const { user_id, presence } = event.data;
        update((s) => {
          let rooms = s.rooms;
          for (const room of Object.values(s.rooms)) {
            if (room?.dm_peer?.id !== user_id || room.dm_peer.presence === presence) continue;
            if (rooms === s.rooms) rooms = { ...s.rooms };
            rooms[room.id] = { ...room, dm_peer: { ...room.dm_peer, presence } };
          }
          let roomMembers = s.roomMembers;
          for (const [roomId, entry] of Object.entries(s.roomMembers)) {
            if (!entry?.members.some((m) => m.user.id === user_id && m.presence !== presence)) continue;
            if (roomMembers === s.roomMembers) roomMembers = { ...s.roomMembers };
            roomMembers[roomId] = {
              ...entry,
              members: entry.members.map((m) => (m.user.id === user_id ? { ...m, presence } : m)),
            };
          }
          let members = s.members;
          for (const [workspaceId, entry] of Object.entries(s.members)) {
            if (!entry?.list.some((m) => m.user.id === user_id && m.presence !== presence)) continue;
            if (members === s.members) members = { ...s.members };
            members[workspaceId] = {
              ...entry,
              list: entry.list.map((m) => (m.user.id === user_id ? { ...m, presence } : m)),
            };
          }
          return rooms === s.rooms && roomMembers === s.roomMembers && members === s.members
            ? s
            : { ...s, rooms, roomMembers, members };
        });
        return;
      }
      case "member.status_changed": {
        // 本人が選んだ設定（手動の離席とカスタムステータス。ADR 0049 決定 8）。
        // away はユーザーごとなので、どのワークスペースの行にも同じ値を当てる。status はワークスペースごと
        const { workspace_id, user_id, away, status } = event.data;
        patchMemberSettings(workspace_id, user_id, away, status);
        return;
      }
      case "typing.started":
        // スレッドでの入力はチャンネルの入力中に出さない。スレッドのパネルに出すのは構築順 5（ADR 0036）
        if (event.data.thread_root_id !== null) receiveThreadTyping(event.data.thread_root_id, event.data.user);
        else receiveTyping(event.data.room_id, event.data.user);
        return;
      case "thread.read":
        advanceThreadRead(event.data.room_id, event.data.thread_root_id, event.data.last_read_thread_seq);
        return;
      case "saved.updated":
        receiveSaved(event.data);
        return;
      case "thread.notifications_updated": {
        // 本人の別のタブ・端末で切り替えた（ADR 0056）。フォローで参加したときは、先に届く thread.followed で一覧を取り直している
        const { workspace_id, thread_root_id, notify_replies } = event.data;
        patchThreadList(workspace_id, (list) => applyThreadNotify(list, thread_root_id, notify_replies));
        // 設定はそのときの値で当てはめるので（ADR 0058 決定 2）、過去の 1 件も増減する。取り直す
        void reloadActivity(workspace_id);
        return;
      }
      case "notifications.updated":
        // 本人の別のタブ・端末で変えた（ADR 0055 決定 5）
        update((s) => ({
          ...s,
          notificationLevels: { ...s.notificationLevels, [event.data.workspace_id]: event.data.level },
        }));
        void reloadActivity(event.data.workspace_id);
        return;
      case "room.notifications_updated": {
        const { level, muted, muted_until } = event.data;
        patchRoom(event.data.room_id, (room) => ({ ...room, notifications: { level, muted, muted_until } }));
        void reloadActivity(event.data.workspace_id);
        return;
      }
      case "activity.reaction_added": {
        // 自分のメッセージへのリアクション（ADR 0058 決定 9）。未読を持たないので、件数は変わらない
        const { item } = event.data;
        patchActivityItems(event.data.workspace_id, (items, key) => {
          const { filter, unreadOnly } = parseActivityListKey(key);
          return belongsTo(item, filter, unreadOnly) ? insertActivity(items, item) : items;
        });
        return;
      }
      case "activity.reaction_removed":
        patchActivityItems(event.data.workspace_id, (items) => removeActivity(items, (i) => i.id === event.data.id));
        return;
      case "thread.followed": {
        // 誰が参加するかはサーバーが決める。一覧の 1 行（親の冒頭など）はイベントにないので取り直す
        const { thread_root_id, last_read_thread_seq, workspace_id } = event.data;
        patchThread(thread_root_id, (t) =>
          t.lastReadThreadSeq !== null ? t : { ...t, lastReadThreadSeq: last_read_thread_seq },
        );
        void reloadThreads(workspace_id);
        return;
      }
    }
  }

  /**
   * 手元のメンバーの行に、本人の設定（away / status）を当てる（ADR 0049）。
   *
   * away はユーザーごとの設定なので、読み込んでいるすべてのワークスペース / ルームの行に当てる。
   * status はワークスペースごとなので、そのワークスペースと、そのワークスペースのルームだけに当てる。
   */
  function patchMemberSettings(workspaceId: string, userId: string, away: boolean, status: UserStatus | null) {
    update((s) => {
      const roomsOfWorkspace = new Set(
        Object.values(s.rooms)
          .filter((room) => room?.workspace_id === workspaceId)
          .map((room) => room!.id),
      );

      let members = s.members;
      for (const [id, entry] of Object.entries(s.members)) {
        const sameWorkspace = id === workspaceId;
        if (!entry?.list.some((m) => m.user.id === userId && changed(m, away, status, sameWorkspace))) continue;
        if (members === s.members) members = { ...s.members };
        members[id] = {
          ...entry,
          list: entry.list.map((m) => (m.user.id === userId ? applySettings(m, away, status, sameWorkspace) : m)),
        };
      }

      let roomMembers = s.roomMembers;
      for (const [roomId, entry] of Object.entries(s.roomMembers)) {
        const sameWorkspace = roomsOfWorkspace.has(roomId);
        if (!entry?.members.some((m) => m.user.id === userId && changed(m, away, status, sameWorkspace))) continue;
        if (roomMembers === s.roomMembers) roomMembers = { ...s.roomMembers };
        roomMembers[roomId] = {
          ...entry,
          members: entry.members.map((m) => (m.user.id === userId ? applySettings(m, away, status, sameWorkspace) : m)),
        };
      }

      return members === s.members && roomMembers === s.roomMembers ? s : { ...s, members, roomMembers };
    });
  }

  /** 手元に持っている自分の行から、いまの away を読む（読み込んでいなければ false）。 */
  function myAway(): boolean {
    for (const entry of Object.values(state.members)) {
      const me = entry?.list.find((m) => m.user.id === userId);
      if (me) return me.away;
    }
    return false;
  }

  /** 手元に持っている自分の行から、そのワークスペースのステータスを読む。 */
  function myStatus(workspaceId: string): UserStatus | null {
    const me = state.members[workspaceId]?.list.find((m) => m.user.id === userId);
    return me?.status ?? null;
  }

  /** 自分の設定を手元に当てる（楽観的更新）。渡さなかった方は変えない。 */
  function patchMySettings(away: boolean | undefined, status: UserStatus | null | undefined, workspaceId?: string) {
    const nextAway = away ?? myAway();
    if (status === undefined) {
      // away だけを変える。ステータスはどのワークスペースのものも触らない
      for (const id of Object.keys(state.members)) patchMemberSettings(id, userId, nextAway, myStatus(id));
      return;
    }
    patchMemberSettings(workspaceId!, userId, nextAway, status);
  }

  function loadRooms(workspaceId: string): Promise<void> {
    return once(`rooms:${workspaceId}`, async () => {
      update((s) =>
        s.roomLists[workspaceId]
          ? s
          : { ...s, roomLists: { ...s.roomLists, [workspaceId]: { status: "loading", ids: [] } } },
      );
      try {
        const { rooms, unread_thread_count } = await api.listRooms(workspaceId);
        for (const room of rooms) putRoom(room);
        const ids = rooms.map((r) => r.id);
        update((s) => ({
          ...s,
          roomLists: { ...s.roomLists, [workspaceId]: { status: "ready", ids } },
          unreadThreadCounts: { ...s.unreadThreadCounts, [workspaceId]: unread_thread_count },
        }));
      } catch (err) {
        update((s) => ({
          ...s,
          roomLists: {
            ...s.roomLists,
            [workspaceId]: { status: statusOf(err), ids: s.roomLists[workspaceId]?.ids ?? [] },
          },
        }));
        if (statusOf(err) === "error") console.error("failed to load rooms", err);
      }
    });
  }

  function reloadRoomMembers(roomId: string): Promise<void> {
    return once(`members:${roomId}`, async () => {
      update((s) => ({
        ...s,
        roomMembers: { ...s.roomMembers, [roomId]: s.roomMembers[roomId] ?? { status: "loading", members: [] } },
      }));
      try {
        const members = await api.listAllRoomMembers(roomId);
        update((s) => ({ ...s, roomMembers: { ...s.roomMembers, [roomId]: { status: "ready", members } } }));
      } catch (err) {
        update((s) => ({
          ...s,
          roomMembers: {
            ...s.roomMembers,
            [roomId]: { status: statusOf(err), members: s.roomMembers[roomId]?.members ?? [] },
          },
        }));
        console.error("failed to load room members", err);
      }
    });
  }

  /**
   * タイムラインの窓を、取ってきたページで置き換える（ADR 0042 の「飛ぶ」）。
   * 前後のどちら側が開いているかはページが持っているので、手元の並びは捨ててよい。
   */
  function replaceWindow(roomId: string, page: MessageList) {
    update((s) => {
      const current = s.timelines[roomId];
      if (!current) return s;
      const messages = mergeMessages([], page.messages);
      return {
        ...s,
        timelines: {
          ...s.timelines,
          [roomId]: {
            ...current,
            status: "ready" as const,
            messages,
            hasOlder: page.has_more,
            loadingOlder: false,
            hasNewer: page.has_more_after,
            loadingNewer: false,
            changeSeq: advanceCursor(Math.max(current.changeSeq, page.last_change_seq), messages),
          },
        },
      };
    });
  }

  /**
   * ルームを開く。ルームの情報（メンバー数・既読位置）を取り直し、表示したいちばん新しいメッセージまで読んだことにする。
   *
   * 前に開いて手元に残っているなら、差分（after_change_seq）だけを取る。なければ最新のページを取る（ADR 0026）。
   * 飛ぶ（jumpToMessage）よりも先に終わらせたいので、返すオブジェクトの外に置いて中からも呼べるようにしてある。
   */
  function openRoom(roomId: string): Promise<void> {
    return once(`room:${roomId}`, async () => {
      const cached = state.timelines[roomId];
      let room: Room;
      if (cached?.status === "ready") {
        try {
          room = await api.getRoom(roomId);
        } catch (err) {
          patchTimeline(roomId, { status: statusOf(err) });
          if (statusOf(err) === "error") console.error("failed to open room", err);
          return;
        }
        putRoom(room);
        patchTimeline(roomId, { unreadAfterSeq: room.last_read_seq, unreadAtOpen: room.unread_count });
        await syncTimeline(roomId);
      } else {
        update((s) => ({
          ...s,
          timelines: {
            ...s.timelines,
            [roomId]: {
              status: "loading",
              // 開いている途中に届いたイベントは、ここに溜まっている
              messages: s.timelines[roomId]?.status === "loading" ? s.timelines[roomId].messages : [],
              hasOlder: false,
              loadingOlder: false,
              hasNewer: false,
              loadingNewer: false,
              unreadAfterSeq: null,
              unreadAtOpen: 0,
              changeSeq: 0,
            },
          },
        }));
        try {
          const [fetchedRoom, page] = await Promise.all([api.getRoom(roomId), api.listMessages(roomId)]);
          room = fetchedRoom;
          putRoom(room);
          update((s) => {
            const arrived = (s.timelines[roomId]?.messages ?? []).filter((m) => m.change_seq > page.last_change_seq);
            const messages = mergeIntoWindow(
              mergeMessages([], page.messages),
              { hasOlder: page.has_more, hasNewer: false },
              arrived,
            );
            return {
              ...s,
              timelines: {
                ...s.timelines,
                [roomId]: {
                  status: "ready",
                  messages,
                  hasOlder: page.has_more,
                  loadingOlder: false,
                  hasNewer: false,
                  loadingNewer: false,
                  unreadAfterSeq: room.last_read_seq,
                  unreadAtOpen: room.unread_count,
                  changeSeq: advanceCursor(page.last_change_seq, messages),
                },
              },
            };
          });
        } catch (err) {
          patchTimeline(roomId, { status: statusOf(err) });
          if (statusOf(err) === "error") console.error("failed to open room", err);
          return;
        }
      }

      // 画面に出したいちばん新しいメッセージまで読んだことにする。ルームの last_message_seq を使わないのは、
      // 取得の間に届いたメッセージを、見せる前に既読にしないため。メンバーでなければ既読位置はない
      const latestSeq = newestChannelSeq(state.timelines[roomId]?.messages ?? []);
      if (latestSeq !== undefined) await requestMarkRead(roomId, latestSeq);
    });
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): ChatState {
      return state;
    },

    /** タイマー（入力中の表示を消す）を止める。ログアウトなどでストアを捨てるときに呼ぶ。 */
    dispose() {
      for (const timer of typingTimers.values()) clearTimeout(timer);
      typingTimers.clear();
      if (muteTimer) clearTimeout(muteTimer.timer);
      muteTimer = null;
    },

    loadWorkspaces(): Promise<void> {
      return once("workspaces", async () => {
        try {
          const { workspaces } = await api.listWorkspaces();
          update((s) => ({ ...s, workspaces: { status: "ready", list: workspaces } }));
        } catch (err) {
          update((s) => ({ ...s, workspaces: { status: statusOf(err), list: s.workspaces.list } }));
          console.error("failed to load workspaces", err);
        }
      });
    },

    /** 失敗したら ApiError を投げる（入力のエラーはダイアログで扱う）。 */
    async createWorkspace(name: string): Promise<Workspace> {
      const workspace = await api.createWorkspace({ name });
      update((s) => ({ ...s, workspaces: { status: "ready", list: [...s.workspaces.list, workspace] } }));
      return workspace;
    },

    // ---- ワークスペースの管理（ADR 0029） ----

    loadMembers,
    reloadMembers,
    loadInvites,

    /** 名前・招待ポリシーを変える。失敗したら ApiError を投げる（画面は変更前に戻す）。 */
    async updateWorkspace(workspaceId: string, patch: { name?: string; invitePolicy?: InvitePolicy }): Promise<void> {
      const updated = await api.updateWorkspace(workspaceId, {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.invitePolicy === undefined ? {} : { invite_policy: patch.invitePolicy }),
      });
      patchWorkspace(workspaceId, (workspace) => ({ ...workspace, ...updated }));
    },

    /** ロールを変える。失敗したら ApiError を投げる。 */
    /**
     * 手動の離席を設定 / 解除する（ADR 0049 決定 4）。手元で先に反映し、失敗したら元に戻す。
     * サーバーからは member.status_changed が本人のすべての接続にも届くので、別のタブも揃う。
     */
    async setAway(away: boolean): Promise<void> {
      const before = myAway();
      patchMySettings(away, undefined);
      try {
        await api.setManualAway(away);
      } catch (error) {
        patchMySettings(before, undefined);
        throw error;
      }
    },

    /** カスタムステータスを設定する（ワークスペースごと）。status が null なら解除。 */
    async setStatus(workspaceId: string, status: SetStatusRequest | null): Promise<void> {
      const before = myStatus(workspaceId);
      patchMySettings(
        undefined,
        status === null ? null : { emoji: status.emoji, text: status.text, expires_at: status.expires_at ?? null },
        workspaceId,
      );
      try {
        if (status === null) await api.clearStatus(workspaceId);
        else await api.setStatus(workspaceId, status);
      } catch (error) {
        patchMySettings(undefined, before, workspaceId);
        throw error;
      }
    },

    /**
     * 全体の通知の設定を取る（ADR 0055）。再接続の後にも取り直す（realtime.ts。change_seq に乗らないため）。
     * 取れなくても既定の mentions として描けるので、失敗はログだけにする。
     */
    loadNotificationLevel(workspaceId: string): Promise<void> {
      return once(`notification-level:${workspaceId}`, async () => {
        try {
          const { level } = await api.getNotificationLevel(workspaceId);
          update((s) => ({ ...s, notificationLevels: { ...s.notificationLevels, [workspaceId]: level } }));
        } catch (err) {
          console.error("failed to load notification level", err);
        }
      });
    },

    /** アクティビティの一覧を取る（ADR 0058）。取ってあれば取り直さない（イベントで最新に保っている）。 */
    loadActivity(workspaceId: string, filter: ActivityFilter, unreadOnly: boolean): Promise<void> {
      return loadActivityList(workspaceId, filter, unreadOnly);
    },

    /** 一覧の続きを取る。続きがない・取得中なら何もしない。 */
    loadMoreActivity(workspaceId: string, filter: ActivityFilter, unreadOnly: boolean): Promise<void> {
      const key = activityListKey(filter, unreadOnly);
      const list = state.activity[workspaceId]?.lists[key];
      if (list?.status !== "ready" || list.nextCursor === null || list.loadingMore) return Promise.resolve();
      const before = list.nextCursor;
      return once(`activity-more:${workspaceId}:${key}`, async () => {
        const patchList = (recipe: (list: ActivityListState) => ActivityListState) =>
          patchActivity(workspaceId, (activity) => {
            const current = activity.lists[key];
            return current ? { ...activity, lists: { ...activity.lists, [key]: recipe(current) } } : activity;
          });
        patchList((l) => ({ ...l, loadingMore: true }));
        try {
          const page = await api.listActivity(workspaceId, { filter, unreadOnly, before });
          patchList((l) => ({
            ...l,
            items: page.items.reduce((items, item) => insertActivity(items, item), l.items),
            nextCursor: page.next_cursor,
            loadingMore: false,
          }));
        } catch (err) {
          patchList((l) => ({ ...l, loadingMore: false }));
          console.error("failed to load more activity", err);
        }
      });
    },

    /** 未読のアクティビティの件数（左のメニューのバッジ）を取る。 */
    loadActivityUnreadCount,

    reloadActivity,

    /** 全体の通知の設定を変える。手元で先に反映し、失敗したら元に戻して ApiError を投げる。 */
    async setNotificationLevel(workspaceId: string, level: NotifyLevel): Promise<void> {
      const before = state.notificationLevels[workspaceId];
      update((s) => ({ ...s, notificationLevels: { ...s.notificationLevels, [workspaceId]: level } }));
      try {
        await api.setNotificationLevel(workspaceId, level);
      } catch (error) {
        update((s) => ({ ...s, notificationLevels: { ...s.notificationLevels, [workspaceId]: before } }));
        throw error;
      }
    },

    /**
     * ルームごとの設定を全部の値で置き換える（ADR 0055 決定 4）。メニューで 1 つを変えるときも、手元の残りの値と一緒に送る。
     * 手元で先に反映し、失敗したら元に戻して ApiError を投げる。応答（期限を落とした後の値）で上書きする。
     */
    async setRoomNotifications(roomId: string, next: RoomNotifications): Promise<void> {
      const before = state.rooms[roomId]?.notifications;
      if (before === undefined || before === null) return;
      patchRoom(roomId, (room) => ({ ...room, notifications: next }));
      try {
        const saved = await api.setRoomNotifications(roomId, next);
        patchRoom(roomId, (room) => ({ ...room, notifications: saved }));
      } catch (error) {
        patchRoom(roomId, (room) => ({ ...room, notifications: before }));
        throw error;
      }
    },

    /**
     * スレッドの返信の通知を切り替える（ADR 0056）。手元の一覧で先に反映し、失敗したら元に戻して ApiError を投げる。
     * 参加していないスレッドを true にしたとき（フォロー）は、応答の後に一覧を取り直して加える（親の本文などは一覧の API にしかない）。
     */
    async setThreadNotifications(workspaceId: string, roomId: string, rootId: string, notify: boolean): Promise<void> {
      const before = state.threadLists[workspaceId]?.list.find((t) => t.root.id === rootId)?.notify_replies;
      patchThreadList(workspaceId, (list) => applyThreadNotify(list, rootId, notify));
      try {
        await api.setThreadNotifications(roomId, rootId, notify);
      } catch (error) {
        if (before !== undefined) patchThreadList(workspaceId, (list) => applyThreadNotify(list, rootId, before));
        throw error;
      }
      if (notify && before === undefined) await reloadThreads(workspaceId);
    },

    /**
     * プロフィールのパネルの email を取る（ADR 0050 決定 1）。**ストアには入れない。**
     * email には変更のイベントが無いので、置いておくと WebSocket でも再接続の同期でも更新されない値が残る。
     * パネルを開くたびに取り直す。失敗したら ApiError を投げる（外された人は 404）。
     */
    async getMemberEmail(workspaceId: string, targetUserId: string): Promise<string | null> {
      return (await api.getMemberProfile(workspaceId, targetUserId)).email;
    },

    async changeMemberRole(workspaceId: string, targetUserId: string, role: Role): Promise<void> {
      const member = await api.changeMemberRole(workspaceId, targetUserId, role);
      patchWorkspaceMembers(workspaceId, (list) => list.map((m) => (m.user.id === targetUserId ? member : m)));
      if (targetUserId === userId) patchWorkspace(workspaceId, (workspace) => ({ ...workspace, my_role: role }));
    },

    /**
     * キック（targetUserId が自分なら退出）。失敗したら ApiError を投げる。
     * 自分が抜けたときの画面の後始末は workspace.member_removed のイベントで行う（別の端末でも同じになる）。
     */
    async removeMember(workspaceId: string, targetUserId: string): Promise<void> {
      await api.removeMember(workspaceId, targetUserId);
      patchWorkspaceMembers(workspaceId, (list) => list.filter((m) => m.user.id !== targetUserId));
      if (targetUserId === userId) removedFromWorkspace(workspaceId, "left");
    },

    /**
     * owner を譲渡する。自分は admin になる（ADR 0011）。失敗したら ApiError を投げる。
     * 応答に本文がないので、手元のロールは自分で入れ替える（イベントでも同じ値が届く）。
     */
    async transferOwnership(workspaceId: string, targetUserId: string): Promise<void> {
      await api.transferOwnership(workspaceId, targetUserId);
      patchWorkspaceMembers(workspaceId, (list) =>
        list.map((m) => {
          if (m.user.id === targetUserId) return { ...m, role: "owner" };
          return m.role === "owner" ? { ...m, role: "admin" } : m;
        }),
      );
      patchWorkspace(workspaceId, (workspace) => ({ ...workspace, my_role: "admin" }));
    },

    /** 招待リンクを作る。code はこの戻り値にしか入らない（ADR 0006）。失敗したら ApiError を投げる。 */
    async createInvite(workspaceId: string, input: { maxUses: number | null; expiresInSeconds: number }): Promise<Invite> {
      const invite = await api.createInvite(workspaceId, {
        max_uses: input.maxUses,
        expires_in_seconds: input.expiresInSeconds,
      });
      // 一覧には code を残さない。閉じた後に再表示できてしまわないようにする
      const listed = { ...invite };
      delete listed.code;
      patchInvites(workspaceId, (list) => [listed, ...list]);
      return invite;
    },

    /** 招待リンクを取り消す。失敗したら ApiError を投げる。 */
    async revokeInvite(workspaceId: string, inviteId: string): Promise<void> {
      await api.revokeInvite(workspaceId, inviteId);
      patchInvites(workspaceId, (list) =>
        list.map((invite) =>
          invite.id === inviteId
            ? { ...invite, status: "revoked", revoked_at: new Date(now()).toISOString() }
            : invite,
        ),
      );
    },

    // ---- 招待の受け入れ（ADR 0030） ----

    /** 招待リンクの内容を見る。使えない招待は ApiError（404 / 410）を投げる。 */
    previewInvite(code: string): Promise<InvitePreview> {
      return api.previewInvite(code);
    },

    /**
     * 招待を受け入れて、ワークスペースを一覧に足す。すでにメンバーなら足すだけで何も変わらない。
     * 失敗したら ApiError を投げる。
     */
    async acceptInvite(code: string): Promise<InviteAcceptance> {
      const result = await api.acceptInvite(code);
      update((s) =>
        s.workspaces.list.some((w) => w.id === result.workspace.id)
          ? s
          : { ...s, workspaces: { ...s.workspaces, list: [...s.workspaces.list, result.workspace] } },
      );
      return result;
    },

    loadRooms,

    /**
     * 一覧を取り直す。取得中のものがあれば、それが終わってからもう 1 回取る。
     * 購読の後に取り直すとき（realtime.ts）に、購読より前に始まった取得の結果で済ませないため。
     */
    async reloadRooms(workspaceId: string): Promise<void> {
      await inflight.get(`rooms:${workspaceId}`);
      return loadRooms(workspaceId);
    },

    /** 失敗したら ApiError を投げる。 */
    async createRoom(workspaceId: string, input: { kind: Exclude<RoomKind, "dm">; name: string }): Promise<Room> {
      return addRoom(workspaceId, await api.createRoom(workspaceId, input));
    },

    /**
     * 相手との DM を開く。すでにあれば同じルームが返る（`dm_key` の UNIQUE。ADR 0011）。
     * 失敗したら ApiError を投げる。
     */
    async openDm(workspaceId: string, userId: string): Promise<Room> {
      return addRoom(workspaceId, await api.createRoom(workspaceId, { kind: "dm", user_id: userId }));
    },

    /** ルームの名前を変える。失敗したら ApiError を投げる。 */
    async updateRoom(roomId: string, patch: { name?: string; isDefault?: boolean }): Promise<void> {
      putRoom(
        await api.updateRoom(roomId, {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.isDefault === undefined ? {} : { is_default: patch.isDefault }),
        }),
      );
    },

    /**
     * 非公開ルームに人を追加する。応答に本文がないので、メンバー一覧とルーム（人数）を取り直す。
     * 失敗したら ApiError を投げる。
     */
    async addRoomMember(roomId: string, userId: string): Promise<void> {
      await api.addRoomMember(roomId, userId);
      await Promise.all([reloadRoomMembers(roomId), refreshRoom(roomId)]);
    },

    /** ルームから外す。失敗したら ApiError を投げる。 */
    async removeRoomMember(roomId: string, userId: string): Promise<void> {
      await api.removeRoomMember(roomId, userId);
      patchMembers(roomId, (members) => members.filter((m) => m.user.id !== userId));
      await refreshRoom(roomId);
    },

    /**
     * 自分でルームから退出する。失敗したら ApiError を投げる。
     * 後始末は room.member_removed（reason: left）と同じにする。イベントは別の端末にも届くので同じ結果になるが、
     * WS が切れていると届かないので、この端末では応答を待ってすぐに行う（ワークスペースの退出と同じ）。
     */
    async leaveRoom(roomId: string): Promise<void> {
      await api.removeRoomMember(roomId, userId);
      const workspaceId = state.rooms[roomId]?.workspace_id;
      if (workspaceId) removedFromRoom(workspaceId, roomId, "left");
    },

    openRoom,


    /**
     * 指定したメッセージの前後を読み込む（ADR 0042）。パーマリンクを開いたとき、カードや一覧を押したときに使う。
     *
     * 見つかったかどうかを返す。見つからないときサーバーは最新のページを `around: null` で返すので、
     * 「ない・読めない・削除済み」を区別しない（ADR 0040 と同じ方針）。呼ぶ側は知らせを 1 行出すだけにする。
     * `threadRootId` が入っていれば、対象はスレッドの返信なので、呼ぶ側はパネルを開く。
     */
    async jumpToMessage(roomId: string, messageId: string): Promise<{ found: boolean; threadRootId: string | null }> {
      // 開く処理と競争させない（どちらも同じ窓を置き換えるため）。まだ開いていなければ、先に開く
      await inflight.get(`room:${roomId}`);
      if (state.timelines[roomId]?.status !== "ready") await openRoom(roomId);
      if (state.timelines[roomId]?.status !== "ready") return { found: false, threadRootId: null };
      try {
        const page = await api.listMessages(roomId, { aroundMessageId: messageId });
        replaceWindow(roomId, page);
        return { found: page.around !== null, threadRootId: page.around?.thread_root_id ?? null };
      } catch (err) {
        console.error("failed to jump to a message", err);
        return { found: false, threadRootId: null };
      }
    },

    /**
     * 最初の未読から読み直す（ADR 0042）。専用の API は作らず、`after_seq = 開いた時点の last_read_seq` を使う。
     * 未読の位置がもう画面にあるとき（バーを出していないとき）は呼ばれない。
     */
    async jumpToUnread(roomId: string): Promise<void> {
      const timeline = state.timelines[roomId];
      const afterSeq = timeline?.unreadAfterSeq;
      if (!timeline || timeline.status !== "ready" || afterSeq === null || afterSeq === undefined) return;
      try {
        const page = await api.listMessages(roomId, { afterSeq });
        replaceWindow(roomId, { ...page, has_more: afterSeq > 0, has_more_after: page.has_more });
      } catch (err) {
        console.error("failed to jump to the first unread message", err);
      }
    },

    /**
     * 飛んだ先から新しい方へ読み足す（ADR 0042）。読み切ると hasNewer が false になり、
     * 届いたメッセージがまた末尾に並ぶようになる。
     */
    async loadNewer(roomId: string): Promise<void> {
      const timeline = state.timelines[roomId];
      if (!timeline || timeline.status !== "ready" || !timeline.hasNewer || timeline.loadingNewer) return;
      const newest = timeline.messages.at(-1);
      if (!newest) return;

      patchTimeline(roomId, { loadingNewer: true });
      try {
        const page = await api.listMessages(roomId, { afterSeq: newest.seq });
        update((s) => {
          const current = s.timelines[roomId];
          if (!current) return s;
          const messages = mergeMessages(current.messages, page.messages);
          return {
            ...s,
            timelines: {
              ...s.timelines,
              [roomId]: {
                ...current,
                messages,
                hasNewer: page.has_more,
                loadingNewer: false,
                changeSeq: advanceCursor(current.changeSeq, messages),
              },
            },
          };
        });
        // 最新につながったら、その間に落ちた変更を取り直す
        if (!page.has_more) void syncTimeline(roomId);
      } catch (err) {
        patchTimeline(roomId, { loadingNewer: false });
        console.error("failed to load newer messages", err);
      }
    },

    /** いちばん古いメッセージより前のページを取る。取得中やもうないときは何もしない。 */
    async loadOlder(roomId: string): Promise<void> {
      const timeline = state.timelines[roomId];
      if (!timeline || timeline.status !== "ready" || !timeline.hasOlder || timeline.loadingOlder) return;
      const oldest = timeline.messages[0];
      if (!oldest) return;

      patchTimeline(roomId, { loadingOlder: true });
      try {
        const page = await api.listMessages(roomId, { beforeSeq: oldest.seq });
        update((s) => {
          const current = s.timelines[roomId];
          if (!current) return s;
          return {
            ...s,
            timelines: {
              ...s.timelines,
              [roomId]: {
                ...current,
                messages: mergeMessages(current.messages, page.messages),
                hasOlder: page.has_more,
                loadingOlder: false,
              },
            },
          };
        });
      } catch (err) {
        // hasOlder は残すので、次にいちばん上までスクロールしたときにもう一度試す
        patchTimeline(roomId, { loadingOlder: false });
        console.error("failed to load older messages", err);
      }
    },

    /** 「すべて既読にする」。見ている間に既読にしてあるので、区切りを消すだけ。 */
    dismissUnread(roomId: string) {
      patchTimeline(roomId, { unreadAfterSeq: null });
    },

    /** public ルームに参加する。失敗したら ApiError を投げる。 */
    async joinRoom(roomId: string): Promise<void> {
      putRoom(await api.joinRoom(roomId));
    },

    loadRoomMembers: reloadRoomMembers,

    // ---- 送信・編集・削除 ----

    /**
     * メッセージを送る。すぐに送信中として表示し、同じルームの前の送信が終わってから送る（ADR 0027）。
     * 失敗は投げずに、メッセージを failed にする。
     */
    sendMessage(
      roomId: string,
      input: {
        body: string;
        attachments?: MessageAttachment[];
        threadRootId?: string | null;
        /** 返信をチャンネルにも出す（ADR 0039）。返信でないときに渡しても無視する（サーバーは 422 を返すため）。 */
        alsoInChannel?: boolean;
      },
    ) {
      const threadRootId = input.threadRootId ?? null;
      const item: OutgoingMessage = {
        clientMsgId: ulid(now()),
        body: input.body,
        threadRootId,
        alsoInChannel: threadRootId !== null && (input.alsoInChannel ?? false),
        attachments: input.attachments ?? [],
        status: "pending",
        createdAt: new Date(now()).toISOString(),
      };
      patchOutgoing(roomId, (list) => [...list, item]);
      enqueueSend(roomId, item.clientMsgId);
    },

    /** 失敗したメッセージを、同じ client_msg_id で送り直す。 */
    retryMessage(roomId: string, clientMsgId: string) {
      const item = state.outgoing[roomId]?.find((m) => m.clientMsgId === clientMsgId);
      if (item?.status !== "failed") return;
      patchOutgoing(roomId, (list) =>
        list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, status: "pending" } : m)),
      );
      enqueueSend(roomId, clientMsgId);
    },

    /**
     * 失敗したメッセージを表示から消す。待ちきれずに失敗にしたものは実は届いていることがあり、そのときは後で履歴に現れる。
     */
    discardMessage(roomId: string, clientMsgId: string) {
      patchOutgoing(roomId, (list) =>
        list.some((m) => m.clientMsgId === clientMsgId && m.status === "failed")
          ? list.filter((m) => m.clientMsgId !== clientMsgId)
          : list,
      );
    },

    /** 本文を編集する。失敗したら ApiError を投げる。 */
    async editMessage(roomId: string, messageId: string, body: string): Promise<void> {
      receiveMessage(await api.editMessage(roomId, messageId, { body }), false);
    },

    /**
     * 絵文字のリアクションを付け外しする（ADR 0044）。押すたびに反転する。
     *
     * 手元で先に反映してから送り、応答（更新後のメッセージ）で確定させる。失敗したら元に戻す。
     * 送信（ADR 0027）と違ってキューに並べないのは、リアクションは順番に意味がなく、
     * 主キーで冪等だから。連打しても最後の状態に落ち着く。
     */
    async toggleReaction(roomId: string, messageId: string, emoji: string): Promise<void> {
      const before = findMessage(roomId, messageId);
      if (!before) return;
      const add = !before.reactions.some((r) => r.emoji === emoji && r.me);
      patchMessageEverywhere(roomId, messageId, (m) => ({
        ...m,
        reactions: toggleReaction(m.reactions, emoji, userId, add),
      }));
      try {
        const updated = add
          ? await api.addReaction(roomId, messageId, emoji)
          : await api.removeReaction(roomId, messageId, emoji);
        receiveMessage(updated, false);
      } catch (error) {
        // 戻すのは、その間に何も届いていないときだけ。届いていればサーバーの値の方が新しい
        patchMessageEverywhere(roomId, messageId, (m) =>
          m.change_seq === before.change_seq ? { ...m, reactions: before.reactions } : m,
        );
        throw error;
      }
    },

    /**
     * 「後で」のタブを取る（ADR 0054）。ワークスペースを開いたときに「進行中」を取り、差分のカーソルを決める。
     * 取ってあれば取り直さない（変化はイベントと差分で直す）。
     */
    loadSaved(workspaceId: string, tab: SavedTab): Promise<void> {
      const current = state.saved[workspaceId]?.tabs[tab];
      if (current && current.status !== "error") return Promise.resolve();
      return loadSavedTab(workspaceId, tab);
    },

    /** タブの続き（古い方）を読む。 */
    async loadMoreSaved(workspaceId: string, tab: SavedTab): Promise<void> {
      const current = state.saved[workspaceId]?.tabs[tab];
      if (current?.status !== "ready" || !current.hasMore || current.loadingMore) return;
      const setLoading = (loadingMore: boolean) =>
        patchSaved(workspaceId, (saved) => {
          const t = saved.tabs[tab];
          return t ? { ...saved, tabs: { ...saved.tabs, [tab]: { ...t, loadingMore } } } : saved;
        });
      setLoading(true);
      try {
        const page = await api.listSaved(workspaceId, tab, current.items.at(-1)?.id);
        for (const item of page.items) knownSavedStates.set(item.message_id, item.state);
        patchSaved(workspaceId, (saved) => {
          const t = saved.tabs[tab];
          if (!t) return saved;
          const known = new Set(t.items.map((i) => i.message_id));
          const items = [...t.items, ...page.items.filter((i) => !known.has(i.message_id))];
          return { ...saved, tabs: { ...saved.tabs, [tab]: { ...t, items, hasMore: page.has_more, loadingMore: false } } };
        });
      } catch (err) {
        setLoading(false);
        console.error("failed to load more saved messages", err);
      }
    },

    syncSaved,

    /**
     * メッセージのホバーの「後で」を押した（ADR 0054）。保存済みなら外し、そうでなければ保存する。
     * 印は手元で先に変え、失敗したら戻す（リアクションと同じく順番に意味がなく、サーバーの操作は冪等）。
     */
    async toggleSaved(workspaceId: string, roomId: string, messageId: string): Promise<void> {
      const message = findMessage(roomId, messageId) ?? state.pins[roomId]?.messages.find((m) => m.id === messageId);
      if (!message) return;
      const wasSaved = message.saved ?? false;
      markSaved(roomId, messageId, !wasSaved);
      try {
        if (wasSaved) await removeSavedNow(workspaceId, messageId, roomId);
        else receiveSaved(await api.saveMessage(roomId, messageId));
      } catch (err) {
        markSaved(roomId, messageId, wasSaved);
        throw err;
      }
    },

    /** 保存をタブの間で動かす。一覧からは手元で先に動かし、失敗したらタブを取り直す。 */
    async moveSaved(workspaceId: string, messageId: string, to: SavedTab): Promise<void> {
      const item = findSavedItem(workspaceId, messageId);
      if (item) absorbSavedItem({ ...item, state: to });
      try {
        receiveSaved(await api.moveSaved(workspaceId, messageId, to));
      } catch (err) {
        await reloadSavedTabs(workspaceId);
        throw err;
      }
    },

    /** 「後で」から外す（一覧の「その他」と、読めない行の確認から）。 */
    removeSaved(workspaceId: string, messageId: string): Promise<void> {
      return removeSavedNow(workspaceId, messageId, findSavedItem(workspaceId, messageId)?.room_id);
    },

    /** ルームのピン留めの一覧を取る（ADR 0054）。取ってあれば取り直さない（変化はイベントと差分で直す）。 */
    loadPins(roomId: string): Promise<void> {
      const current = state.pins[roomId];
      if (current && current.status !== "error") return Promise.resolve();
      return loadPins(roomId);
    },

    /**
     * ピン留めを付け外しする（ADR 0054）。押すたびに反転する。
     *
     * 楽観的更新はしない。付けたときにチャンネルのログ（システムメッセージ）が一緒にできるので、
     * 手元で先に付けても、ログはサーバーの応答を待つことになる（見た目が 2 段に分かれる）。応答（更新後のメッセージ）で確定させる。
     */
    async togglePin(roomId: string, messageId: string): Promise<void> {
      const message = findMessage(roomId, messageId) ?? state.pins[roomId]?.messages.find((m) => m.id === messageId);
      if (!message) return;
      const updated =
        message.pinned === null ? await api.pinMessage(roomId, messageId) : await api.unpinMessage(roomId, messageId);
      receiveMessage(updated, false);
    },

    /**
     * 添付ファイルだけを削除する（ADR 0045）。
     *
     * 取り消せない操作なので、リアクションと違って**楽観的更新はしない**（手元で先に消すと、
     * 失敗したときに「消えたのに戻ってきた」が起きる）。応答（更新後のメッセージ）で確定させる。
     * 最後の 1 件で本文も空だったときは tombstone が返り、メッセージごと消える（決定 8）。
     */
    async deleteAttachment(roomId: string, messageId: string, attachmentId: string): Promise<void> {
      receiveMessage(await api.deleteMessageAttachment(roomId, messageId, attachmentId), false);
    },

    /**
     * メッセージを削除する。応答にメッセージがないので、差分を取って反映する（WebSocket のイベントが先に届いていれば何も起きない）。
     * 失敗したら ApiError を投げる。
     */
    async deleteMessage(roomId: string, messageId: string): Promise<void> {
      await api.deleteMessage(roomId, messageId);
      await syncTimeline(roomId);
    },

    // ---- スレッド（ADR 0036）----

    loadThreads,

    reloadThreads,

    openThread: loadThreadIfNeeded,

    /** 再接続の後に取り直す。取得の間に届いた返信は残す。 */
    async reloadThread(roomId: string, rootId: string): Promise<void> {
      await inflight.get(`thread:${rootId}`);
      return loadThread(roomId, rootId);
    },

    /**
     * スレッドのパネルを開いて、指定した返信の前後を読み込む（ADR 0042）。
     * 見つからなければ最新のページのままにする（チャンネル側と同じで、理由は区別しない）。
     */
    async jumpToThreadMessage(roomId: string, rootId: string, messageId: string): Promise<{ found: boolean }> {
      await loadThreadIfNeeded(roomId, rootId);
      const thread = state.threads[rootId];
      if (!thread || thread.status !== "ready") return { found: false };
      try {
        const page = await api.listThreadMessages(roomId, rootId, { aroundMessageId: messageId });
        patchThread(rootId, (t) => ({
          ...t,
          replies: mergeReplies([], page.messages),
          hasOlder: page.has_more,
          loadingOlder: false,
          hasNewer: page.has_more_after,
          loadingNewer: false,
        }));
        return { found: page.around !== null };
      } catch (err) {
        console.error("failed to jump to a reply", err);
        return { found: false };
      }
    },

    /** 飛んだ先から新しい方へ読み足す（ADR 0042）。読み切ると、届いた返信がまた末尾に並ぶようになる。 */
    async loadNewerThread(rootId: string): Promise<void> {
      const thread = state.threads[rootId];
      if (!thread || thread.status !== "ready" || !thread.hasNewer || thread.loadingNewer) return;
      const newest = thread.replies.at(-1);
      if (!newest) return;
      patchThread(rootId, (t) => ({ ...t, loadingNewer: true }));
      try {
        const page = await api.listThreadMessages(thread.roomId, rootId, { afterSeq: newest.seq });
        patchThread(rootId, (t) => ({
          ...t,
          replies: mergeReplies(t.replies, page.messages),
          hasNewer: page.has_more,
          loadingNewer: false,
        }));
      } catch (err) {
        patchThread(rootId, (t) => ({ ...t, loadingNewer: false }));
        console.error("failed to load newer replies", err);
      }
    },

    /** いちばん古い返信より前のページを取る。取得中やもうないときは何もしない。 */
    async loadOlderThread(rootId: string): Promise<void> {
      const thread = state.threads[rootId];
      if (!thread || thread.status !== "ready" || !thread.hasOlder || thread.loadingOlder) return;
      const oldest = thread.replies[0];
      if (!oldest) return;
      patchThread(rootId, (t) => ({ ...t, loadingOlder: true }));
      try {
        const page = await api.listThreadMessages(thread.roomId, rootId, { beforeSeq: oldest.seq });
        patchThread(rootId, (t) => ({
          ...t,
          replies: mergeReplies(t.replies, page.messages),
          hasOlder: page.has_more,
          loadingOlder: false,
        }));
      } catch (err) {
        patchThread(rootId, (t) => ({ ...t, loadingOlder: false }));
        console.error("failed to load older replies", err);
      }
    },

    /**
     * 開いているスレッドを、表示している最新の返信まで既読にする。参加していない・未読がないときは何もしない。
     * 失敗はログに出して投げない（次に返信が届いたときにもう一度試す）。
     */
    markThreadRead(rootId: string): Promise<void> {
      const thread = state.threads[rootId];
      const newest = thread?.replies.at(-1);
      if (!thread || thread.status !== "ready" || !newest || thread.lastReadThreadSeq === null) return Promise.resolve();
      // サーバーは seq 以下で最後の返信の thread_seq まで進める。表示している最新の返信まで読んであれば送らない
      if ((newest.thread_seq ?? 0) <= thread.lastReadThreadSeq) return Promise.resolve();
      return once(`thread-read:${rootId}`, async () => {
        try {
          const read = await api.markThreadRead(thread.roomId, rootId, { seq: newest.seq });
          if (read.following) advanceThreadRead(thread.roomId, rootId, read.last_read_thread_seq);
        } catch (err) {
          console.error("failed to mark thread read", err);
        }
      });
    },

    setThreadFocus(focus: { roomId: string; rootId: string } | null) {
      update((s) =>
        s.threadFocus?.rootId === focus?.rootId && s.threadFocus?.roomId === focus?.roomId ? s : { ...s, threadFocus: focus },
      );
    },

    // ---- リアルタイム ----

    applyEvent,

    syncTimeline,

    setActiveWorkspace(workspaceId: string | null) {
      update((s) => (s.activeWorkspaceId === workspaceId ? s : { ...s, activeWorkspaceId: workspaceId }));
    },

    /**
     * 開いているルームと、その最新を見ているかを知らせる。見始めたら、表示しているところまで既読にする。
     * 「アクセスできません」を出していたルームから離れたら、覚えていたことを忘れる。
     */
    setFocus(focus: { roomId: string; caughtUp: boolean } | null) {
      const previous = state.focus;
      if (previous?.roomId === focus?.roomId && previous?.caughtUp === focus?.caughtUp) return;
      update((s) => ({ ...s, focus }));
      if (previous && previous.roomId !== focus?.roomId && state.removedRooms[previous.roomId]) {
        // もう一度 URL を開いたら、ほかの読めないルームと同じく 404 で入口に戻す
        update((s) => ({ ...s, removedRooms: { ...s.removedRooms, [previous.roomId]: undefined } }));
      }
      if (focus?.caughtUp) {
        const latestSeq = newestChannelSeq(state.timelines[focus.roomId]?.messages ?? []);
        if (latestSeq !== undefined && state.timelines[focus.roomId]?.status === "ready") {
          void requestMarkRead(focus.roomId, latestSeq);
        }
      }
    },

    /** 外されたワークスペースの画面から離れた。 */
    forgetRemovedWorkspace(workspaceId: string) {
      update((s) =>
        s.removedWorkspaces[workspaceId]
          ? { ...s, removedWorkspaces: { ...s.removedWorkspaces, [workspaceId]: undefined } }
          : s,
      );
    },

    setConnection(connection: ConnectionView) {
      update((s) =>
        s.connection.banner === connection.banner &&
        s.connection.unavailable?.retryCount === connection.unavailable?.retryCount &&
        s.connection.unavailable?.lastConnectedAt === connection.unavailable?.lastConnectedAt
          ? s
          : { ...s, connection },
      );
    },
  };
}

/** away / status を当てた行を返す（同じワークスペースでなければ status は触らない）。 */
function applySettings<T extends { away: boolean; status: UserStatus | null }>(
  member: T,
  away: boolean,
  status: UserStatus | null,
  sameWorkspace: boolean,
): T {
  return { ...member, away, status: sameWorkspace ? status : member.status };
}

/** 当てても値が変わらないなら、その一覧は作り直さない。 */
function changed(
  member: { away: boolean; status: UserStatus | null },
  away: boolean,
  status: UserStatus | null,
  sameWorkspace: boolean,
): boolean {
  if (member.away !== away) return true;
  if (!sameWorkspace) return false;
  return JSON.stringify(member.status ?? null) !== JSON.stringify(status ?? null);
}

export type ChatStore = ReturnType<typeof createChatStore>;
