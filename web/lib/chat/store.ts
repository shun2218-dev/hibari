import { ApiError } from "@/lib/api/error";
import type { Message, Room, RoomKind, RoomMember, Workspace } from "@/lib/api/types.gen";

import type { ChatApi } from "./api";
import { mergeMessages } from "./messages";

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
   * 開いた時点の last_read_seq。「ここから未読」の位置に使う。
   * 開いてすぐ既読にするので、ルームの last_read_seq を見ると区切りが消えてしまう。開いている間はこの値で固定する。
   */
  unreadAfterSeq: number | null;
};

export type ChatState = {
  workspaces: { status: LoadStatus; list: Workspace[] };
  /** ワークスペースごとのルームの ID。並びは API のまま（最後のメッセージが新しい順）。 */
  roomLists: Record<string, { status: LoadStatus; ids: string[] } | undefined>;
  /**
   * ルームの本体。一覧と 1 件の取得の両方がここを更新する。
   * 構築順 3 の WebSocket のイベント（room.updated、room.read など）も、ここを 1 箇所だけ更新すれば一覧とヘッダーの両方に反映される。
   */
  rooms: Record<string, Room | undefined>;
  timelines: Record<string, TimelineState | undefined>;
  roomMembers: Record<string, { status: LoadStatus; members: RoomMember[] } | undefined>;
};

function statusOf(err: unknown): LoadStatus {
  return err instanceof ApiError && err.status === 404 ? "not_found" : "error";
}

/**
 * チャットの状態のストア（ADR 0024 の session と同じく自作で、useSyncExternalStore で購読する）。
 *
 * 状態は置き換えるだけで、中身を書き換えない。変わった部分だけ新しいオブジェクトにするので、
 * コンポーネントは自分の見ている部分の参照が変わったときだけ描き直される。
 *
 * いまは REST だけで、開いたときに取り直す（構築順 2）。WebSocket のイベントと after_change_seq による同期は構築順 3 で足す。
 */
export function createChatStore(api: ChatApi) {
  let state: ChatState = {
    workspaces: { status: "loading", list: [] },
    roomLists: {},
    rooms: {},
    timelines: {},
    roomMembers: {},
  };
  const listeners = new Set<() => void>();
  // Strict Mode で effect が 2 回走っても、同じ取得を 2 本送らない。
  const inflight = new Map<string, Promise<void>>();

  function update(recipe: (s: ChatState) => ChatState) {
    state = recipe(state);
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

  function patchTimeline(roomId: string, patch: Partial<TimelineState>) {
    update((s) => {
      const current = s.timelines[roomId];
      if (!current) return s;
      return { ...s, timelines: { ...s.timelines, [roomId]: { ...current, ...patch } } };
    });
  }

  async function markRead(roomId: string, seq: number): Promise<void> {
    const read = await api.markRead(roomId, { seq });
    update((s) => {
      const room = s.rooms[roomId];
      if (!room) return s;
      return {
        ...s,
        rooms: { ...s.rooms, [roomId]: { ...room, last_read_seq: read.last_read_seq, unread_count: read.unread_count } },
      };
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

    loadRooms(workspaceId: string): Promise<void> {
      return once(`rooms:${workspaceId}`, async () => {
        update((s) =>
          s.roomLists[workspaceId]
            ? s
            : { ...s, roomLists: { ...s.roomLists, [workspaceId]: { status: "loading", ids: [] } } },
        );
        try {
          const { rooms } = await api.listRooms(workspaceId);
          for (const room of rooms) putRoom(room);
          update((s) => ({
            ...s,
            roomLists: { ...s.roomLists, [workspaceId]: { status: "ready", ids: rooms.map((r) => r.id) } },
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
    },

    /** 失敗したら ApiError を投げる。 */
    async createRoom(workspaceId: string, input: { kind: Exclude<RoomKind, "dm">; name: string }): Promise<Room> {
      const room = await api.createRoom(workspaceId, input);
      putRoom(room);
      update((s) => {
        const list = s.roomLists[workspaceId];
        if (!list) return s;
        // メッセージのないルームは、API の並び（最後のメッセージが新しい順、ないものは末尾）でも末尾に来る
        return { ...s, roomLists: { ...s.roomLists, [workspaceId]: { ...list, ids: [...list.ids, room.id] } } };
      });
      return room;
    },

    /**
     * ルームを開く。ルームの情報（メンバー数・既読位置）と最新のページを取り直し、最新まで読んだことにする。
     *
     * 開くたびに最新のページで置き換える。前に読み込んだ古いページとの間に抜けができないように、つなげずに捨てる
     * （WebSocket で最新を追えるようになる構築順 3 で見直す）。
     */
    openRoom(roomId: string): Promise<void> {
      return once(`room:${roomId}`, async () => {
        update((s) => ({
          ...s,
          timelines: {
            ...s.timelines,
            [roomId]: s.timelines[roomId] ?? {
              status: "loading",
              messages: [],
              hasOlder: false,
              loadingOlder: false,
              unreadAfterSeq: null,
            },
          },
        }));
        let room: Room;
        let latestSeq: number | undefined;
        try {
          const [fetchedRoom, page] = await Promise.all([api.getRoom(roomId), api.listMessages(roomId)]);
          room = fetchedRoom;
          const messages = mergeMessages([], page.messages);
          latestSeq = messages.at(-1)?.seq;
          putRoom(room);
          update((s) => ({
            ...s,
            timelines: {
              ...s.timelines,
              [roomId]: {
                status: "ready",
                messages,
                hasOlder: page.has_more,
                loadingOlder: false,
                unreadAfterSeq: room.last_read_seq,
              },
            },
          }));
        } catch (err) {
          patchTimeline(roomId, { status: statusOf(err) });
          if (statusOf(err) === "error") console.error("failed to open room", err);
          return;
        }

        // 画面に出したいちばん新しいメッセージまで読んだことにする。ルームの last_message_seq を使わないのは、
        // 2 本の取得の間に届いたメッセージを、見せる前に既読にしないため。メンバーでなければ既読位置はない
        if (room.last_read_seq !== null && latestSeq !== undefined && room.last_read_seq < latestSeq) {
          await markRead(roomId, latestSeq).catch((err) => console.error("failed to mark room read", err));
        }
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

    /** 「すべて既読にする」。開いたときに既読にしてあるので、区切りを消すだけ。 */
    dismissUnread(roomId: string) {
      patchTimeline(roomId, { unreadAfterSeq: null });
    },

    /** public ルームに参加する。失敗したら ApiError を投げる。 */
    async joinRoom(roomId: string): Promise<void> {
      putRoom(await api.joinRoom(roomId));
    },

    loadRoomMembers(roomId: string): Promise<void> {
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
    },
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;
