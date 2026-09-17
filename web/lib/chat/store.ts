import type { ConnectionBannerStatus } from "@/components/chat/types";
import { ApiError } from "@/lib/api/error";
import type {
  Message,
  RemovalReason,
  Room,
  RoomKind,
  RoomMember,
  ServerEvent,
  UserProfile,
  Workspace,
} from "@/lib/api/types.gen";

import type { ChatApi } from "./api";
import {
  advanceCursor,
  applyMessageToRoom,
  applyReadToRoom,
  insertByActivity,
  mergeIntoWindow,
  mergeMessages,
} from "./messages";

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
   * 「ここから未読」の位置。これより大きい seq の最初のメッセージの前に出す。null なら出さない。
   * 開いてすぐ既読にするので、ルームの last_read_seq を見ると区切りが消えてしまう。開いた時点の値で固定し、
   * 見ていない間に届いたメッセージの分だけ動かす（ADR 0026）。
   */
  unreadAfterSeq: number | null;
  /** 同期のカーソル（ADR 0014）。この番号までの変更は手元に反映してある。 */
  changeSeq: number;
};

/** 入力中の人。expiresAt を過ぎたら消す（typing.stopped はない。docs/events.md）。 */
export type TypingUser = { user: UserProfile; expiresAt: number };

/**
 * 接続の状態の表示。
 * - banner: 再接続中・同期中・復帰のバナー
 * - unavailable: サーバーに届かない画面（chat/server-error.png）を出すときだけ値がある
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
  /** 表示中のワークスペース。購読の対象を決める（realtime.ts）。 */
  activeWorkspaceId: string | null;
  /**
   * 開いているルームと、その最新を見ているか（タブが見えていて、いちばん下までスクロールしている）。
   * 見ている間に届いたメッセージは既読にし、「ここから未読」を出さない。
   */
  focus: { roomId: string; caughtUp: boolean } | null;
  typing: Record<string, TypingUser[] | undefined>;
  /**
   * 自分が外されたルーム（非公開と DM）。開いている間は一覧に残して「外されました」を出す（chat/removed-from-channel.png）。
   * public ルームは参加していなくても読めるので、ここには入れず、参加していない状態に戻すだけ。
   */
  removedRooms: Record<string, RemovalReason | undefined>;
  /** 自分が外されたワークスペース。一覧からは除き、その画面を開いている間だけ名前を残す（chat/removed-from-workspace.png）。 */
  removedWorkspaces: Record<string, { reason: RemovalReason; workspace: Workspace } | undefined>;
  connection: ConnectionView;
};

export type ChatStoreOptions = {
  /** ログインしているユーザー。自分の送信・入力中・自分宛てのイベントの判定に使う。 */
  userId: string;
  now?: () => number;
};

function statusOf(err: unknown): LoadStatus {
  return err instanceof ApiError && err.status === 404 ? "not_found" : "error";
}

/** 入力中の表示を、最後に受け取ってから消すまでの時間（docs/events.md）。 */
const TYPING_TTL_MS = 6_000;

/**
 * チャットの状態のストア（ADR 0024 の session と同じく自作で、useSyncExternalStore で購読する）。
 *
 * 状態は置き換えるだけで、中身を書き換えない。変わった部分だけ新しいオブジェクトにするので、
 * コンポーネントは自分の見ている部分の参照が変わったときだけ描き直される。
 *
 * REST で取った状態に、WebSocket のイベント（applyEvent）を重ねる。イベントは落ちうるので、
 * 取りこぼしは change_seq で検出して差分を取り直す（syncTimeline。ADR 0014 / 0026）。
 */
export function createChatStore(api: ChatApi, { userId, now = Date.now }: ChatStoreOptions) {
  let state: ChatState = {
    workspaces: { status: "loading", list: [] },
    roomLists: {},
    rooms: {},
    timelines: {},
    roomMembers: {},
    activeWorkspaceId: null,
    focus: null,
    typing: {},
    removedRooms: {},
    removedWorkspaces: {},
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

  function update(recipe: (s: ChatState) => ChatState) {
    const next = recipe(state);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
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

  // ---- 既読 ----

  async function markRead(roomId: string, seq: number): Promise<void> {
    const read = await api.markRead(roomId, { seq });
    patchRoom(roomId, (room) => applyReadToRoom(room, read.last_read_seq));
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
    const newest = timeline?.messages.at(-1)?.seq;
    if (!timeline || timeline.status !== "ready" || newest === undefined || previousNewest === undefined) return;
    if (newest <= previousNewest || !room || room.last_read_seq === null) return;

    const seen =
      (state.focus?.roomId === roomId && state.focus.caughtUp) ||
      added.filter((m) => m.seq > previousNewest).every((m) => m.sender.id === userId);
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
    const previousNewest = timeline.messages.at(-1)?.seq;

    const page = await api.listChanges(roomId, timeline.changeSeq);
    if (!page.has_more) {
      update((s) => {
        const current = s.timelines[roomId];
        if (!current) return s;
        const messages = mergeIntoWindow(current.messages, current.hasOlder, page.messages);
        // last_change_seq はメッセージを読む前の値なので、最後のページのときだけカーソルに使ってよい（ADR 0014）
        const changeSeq = advanceCursor(Math.max(current.changeSeq, page.last_change_seq), messages);
        return { ...s, timelines: { ...s.timelines, [roomId]: { ...current, messages, changeSeq } } };
      });
      afterNewMessages(roomId, previousNewest, page.messages);
      return;
    }

    // 手元との間が 1 ページ（100 件の変更）を超えた。全部たどると、読み込んでいない範囲の変更まで取ることになるので、
    // 最新のページを読み直す。その間に届いたイベントは残す
    const latest = await api.listMessages(roomId);
    update((s) => {
      const current = s.timelines[roomId];
      if (!current) return s;
      const base = mergeMessages([], latest.messages);
      const arrived = current.messages.filter((m) => m.change_seq > latest.last_change_seq);
      const messages = mergeIntoWindow(base, latest.has_more, arrived);
      return {
        ...s,
        timelines: {
          ...s.timelines,
          [roomId]: {
            ...current,
            messages,
            hasOlder: latest.has_more,
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

  // ---- イベント ----

  function receiveMessage(message: Message, created: boolean) {
    const roomId = message.room_id;
    const before = state.rooms[roomId];
    patchRoom(roomId, (room) => applyMessageToRoom(room, message, userId, created));
    const after = state.rooms[roomId];
    // 新しいメッセージのルームを一覧の先頭に移す（最後のメッセージが新しい順）
    if (created && before && after && after !== before) {
      patchRoomList(after.workspace_id, (ids) =>
        ids[0] === roomId || !ids.includes(roomId) ? ids : [roomId, ...ids.filter((id) => id !== roomId)],
      );
    }
    if (created) removeTyping(roomId, message.sender.id);

    const timeline = state.timelines[roomId];
    if (!timeline) return;
    if (timeline.status === "loading") {
      // 開いている途中に届いた。取得の結果と合わせるので、範囲を決めずに持っておく
      patchTimeline(roomId, { messages: mergeMessages(timeline.messages, [message]) });
      return;
    }
    if (timeline.status !== "ready" || message.change_seq <= timeline.changeSeq) return;

    const previousNewest = timeline.messages.at(-1)?.seq;
    const messages = mergeIntoWindow(timeline.messages, timeline.hasOlder, [message]);
    // 読み込んでいない範囲の変更は足さないが、番号が続いていれば反映したことにしてよい（表示するものがない）
    const next = message.change_seq === timeline.changeSeq + 1 ? message.change_seq : timeline.changeSeq;
    const changeSeq = advanceCursor(next, messages);
    patchTimeline(roomId, { messages, changeSeq });
    afterNewMessages(roomId, previousNewest, [message]);
    // 間の変更が届いていない（落ちたか、順序が入れ替わった）。差分を取り直す
    if (message.change_seq > timeline.changeSeq + 1 && changeSeq < message.change_seq) void syncTimeline(roomId);
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
    // 開いているルームは、「外されました」を出している間だけ一覧に残す（離れたら setFocus が消す）
    if (state.focus?.roomId !== roomId) patchRoomList(workspaceId, (ids) => ids.filter((id) => id !== roomId));
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
        return;
      case "message.updated":
      case "message.deleted":
        receiveMessage(event.data, false);
        return;

      case "member.joined": {
        const { workspace_id, room_id, user } = event.data;
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
        return;
      case "room.read":
        patchRoom(event.data.room_id, (room) => applyReadToRoom(room, event.data.last_read_seq));
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
        // ほかの人のことは、ルームごとの member.left で扱う
        if (event.data.user_id === userId) removedFromWorkspace(event.data.workspace_id, event.data.reason);
        return;
      case "workspace.role_changed": {
        const { workspace_id, user_id, role } = event.data;
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
        const { user_id, online } = event.data;
        update((s) => {
          let rooms = s.rooms;
          for (const room of Object.values(s.rooms)) {
            if (room?.dm_peer?.id !== user_id || room.dm_peer.online === online) continue;
            if (rooms === s.rooms) rooms = { ...s.rooms };
            rooms[room.id] = { ...room, dm_peer: { ...room.dm_peer, online } };
          }
          let roomMembers = s.roomMembers;
          for (const [roomId, entry] of Object.entries(s.roomMembers)) {
            if (!entry?.members.some((m) => m.user.id === user_id && m.online !== online)) continue;
            if (roomMembers === s.roomMembers) roomMembers = { ...s.roomMembers };
            roomMembers[roomId] = {
              ...entry,
              members: entry.members.map((m) => (m.user.id === user_id ? { ...m, online } : m)),
            };
          }
          return rooms === s.rooms && roomMembers === s.roomMembers ? s : { ...s, rooms, roomMembers };
        });
        return;
      }
      case "typing.started":
        receiveTyping(event.data.room_id, event.data.user);
        return;
    }
  }

  function loadRooms(workspaceId: string): Promise<void> {
    return once(`rooms:${workspaceId}`, async () => {
      update((s) =>
        s.roomLists[workspaceId]
          ? s
          : { ...s, roomLists: { ...s.roomLists, [workspaceId]: { status: "loading", ids: [] } } },
      );
      try {
        const { rooms } = await api.listRooms(workspaceId);
        for (const room of rooms) putRoom(room);
        update((s) => {
          // 「外されました」を出しているルームは、一覧を取り直しても開いている間は残す
          const kept = s.roomLists[workspaceId]?.ids.filter((id) => s.removedRooms[id] && s.focus?.roomId === id) ?? [];
          const ids = [...rooms.map((r) => r.id), ...kept.filter((id) => !rooms.some((r) => r.id === id))];
          return { ...s, roomLists: { ...s.roomLists, [workspaceId]: { status: "ready", ids } } };
        });
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
      const room = await api.createRoom(workspaceId, input);
      putRoom(room);
      // 作成者にも member.joined が届くので、先に足してあれば足さない
      patchRoomList(workspaceId, (ids) => (ids.includes(room.id) ? ids : insertByActivity(ids, room, state.rooms)));
      return room;
    },

    /**
     * ルームを開く。ルームの情報（メンバー数・既読位置）を取り直し、表示したいちばん新しいメッセージまで読んだことにする。
     *
     * 前に開いて手元に残っているなら、差分（after_change_seq）だけを取る。なければ最新のページを取る（ADR 0026）。
     */
    openRoom(roomId: string): Promise<void> {
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
          patchTimeline(roomId, { unreadAfterSeq: room.last_read_seq });
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
                unreadAfterSeq: null,
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
              const messages = mergeIntoWindow(mergeMessages([], page.messages), page.has_more, arrived);
              return {
                ...s,
                timelines: {
                  ...s.timelines,
                  [roomId]: {
                    status: "ready",
                    messages,
                    hasOlder: page.has_more,
                    loadingOlder: false,
                    unreadAfterSeq: room.last_read_seq,
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
        const latestSeq = state.timelines[roomId]?.messages.at(-1)?.seq;
        if (latestSeq !== undefined) await requestMarkRead(roomId, latestSeq);
      });
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

    // ---- リアルタイム ----

    applyEvent,

    syncTimeline,

    setActiveWorkspace(workspaceId: string | null) {
      update((s) => (s.activeWorkspaceId === workspaceId ? s : { ...s, activeWorkspaceId: workspaceId }));
    },

    /**
     * 開いているルームと、その最新を見ているかを知らせる。見始めたら、表示しているところまで既読にする。
     * 「外されました」を出していたルームから離れたら、一覧から消す。
     */
    setFocus(focus: { roomId: string; caughtUp: boolean } | null) {
      const previous = state.focus;
      if (previous?.roomId === focus?.roomId && previous?.caughtUp === focus?.caughtUp) return;
      update((s) => ({ ...s, focus }));
      if (previous && previous.roomId !== focus?.roomId && state.removedRooms[previous.roomId]) {
        const workspaceId = state.rooms[previous.roomId]?.workspace_id;
        if (workspaceId) patchRoomList(workspaceId, (ids) => ids.filter((id) => id !== previous.roomId));
        // もう一度 URL を開いたら、ほかの読めないルームと同じく 404 で入口に戻す
        update((s) => ({ ...s, removedRooms: { ...s.removedRooms, [previous.roomId]: undefined } }));
      }
      if (focus?.caughtUp) {
        const latestSeq = state.timelines[focus.roomId]?.messages.at(-1)?.seq;
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

export type ChatStore = ReturnType<typeof createChatStore>;
