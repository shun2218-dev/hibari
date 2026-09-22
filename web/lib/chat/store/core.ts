import type { FollowedThread, Invite, Member, Message, Room, RoomMember, Workspace } from "@/lib/api/types.gen";
import type { ChatApi } from "@/lib/chat/api/chat-api";
import { isMuted, nextMuteExpiry } from "@/lib/chat/notifications/notifications";
import { insertByActivity } from "@/lib/chat/rules/messages";
import type {
  ChatState,
  ChatStoreOptions,
  ConnectionView,
  OutgoingMessage,
  ThreadState,
  TimelineState,
} from "./state";

import { SEND_TIMEOUT_MS } from "./send";

/**
 * 状態そのものと、どのスライスも使う書き換えの道具（update と patch 系）。
 * 状態は置き換えるだけで、中身を書き換えない。変わった部分だけ新しいオブジェクトにするので、
 * コンポーネントは自分の見ている部分の参照が変わったときだけ描き直される。
 */
export function createStoreCore(
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

  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

  return {
    /** いまの状態。置き換わるので、分けて取り出さずに毎回 core.state で読む。 */
    get state() {
      return state;
    },
    api,
    userId,
    now,
    sendTimeoutMs,
    addRoom,
    findMessage,
    inflight,
    once,
    patchInvites,
    patchMembers,
    patchMessageEverywhere,
    patchOutgoing,
    patchRoom,
    patchRoomList,
    patchThread,
    patchThreadList,
    patchTimeline,
    patchWorkspace,
    patchWorkspaceMembers,
    putRoom,
    typingTimers,
    update,
    actions: {
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

      setActiveWorkspace(workspaceId: string | null) {
        update((s) => (s.activeWorkspaceId === workspaceId ? s : { ...s, activeWorkspaceId: workspaceId }));
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
    },
  };
}

export type StoreCore = ReturnType<typeof createStoreCore>;
