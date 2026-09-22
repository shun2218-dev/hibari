import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/auth/session";
import { message, naoki, room, roomMember, savedItem } from "@/test/chat-data";
import { type Handler, TEST_API_BASE, fakeApi, json, tokens } from "@/test/fake-api";
import { fakeSockets } from "@/test/fake-socket";

import { createChatApi } from "./api";
import { type RealtimeOptions, createRealtime } from "./realtime";
import { createChatStore } from "./store";

function setup(
  routes: Record<string, Handler>,
  { autoAck = true, createActivity }: { autoAck?: boolean; createActivity?: RealtimeOptions["createActivity"] } = {},
) {
  let tickets = 0;
  const log: string[] = [];
  const api = fakeApi({
    "POST /api/v1/auth/refresh": () => tokens("at-1"),
    "POST /api/v1/ws/ticket": () => json(200, { ticket: `t${++tickets}`, expires_in: 30 }),
    ...routes,
  });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const chatApi = createChatApi(session.request);
  const store = createChatStore(chatApi, { userId: naoki.id });
  const sockets = fakeSockets({ autoAck });
  const realtime = createRealtime({
    store,
    createActivity,
    url: "ws://api.test/api/v1/ws",
    createSocket: (url) => {
      const socket = sockets.createSocket(url);
      const send = socket.send.bind(socket);
      socket.send = (data) => {
        const m = JSON.parse(data);
        if (m.type === "activity") log.push(`ws activity ${m.active}`);
        else if (m.type !== "ping") log.push(`ws ${m.type} ${m.workspace_id ?? m.room_id}`);
        send(data);
      };
      return socket;
    },
    issueTicket: chatApi.issueTicket,
    revalidateSession: () => session.revalidate(),
    random: () => 1,
    isOnline: () => true,
    watchNetwork: () => () => {},
  });
  api.fetch.mockImplementation(
    ((original) => async (url: string, init: RequestInit = {}) => {
      const path = url.slice(TEST_API_BASE.length);
      if (!path.startsWith("/api/v1/auth") && !path.startsWith("/api/v1/ws")) log.push(`${init.method ?? "GET"} ${path}`);
      return original(url, init);
    })(api.fetch.getMockImplementation()!),
  );
  return { api, store, realtime, sockets, log };
}

const roomsOf = (...ids: string[]) => () => json(200, { rooms: ids.map((id) => room(id, id)) });

describe("createRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to the active workspace and its rooms, and only then reads the room list again", async () => {
    const { store, realtime, sockets, log } = setup({ "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1", "r2") });
    await store.loadRooms("ws-1");
    store.setActiveWorkspace("ws-1");
    log.length = 0;

    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);

    expect(log).toEqual([
      // つないだ直後に「画面を見ているか」を送る（ADR 0049 決定 3）。jsdom では見えていない扱いになる
      "ws activity false",
      "ws subscribe ws-1",
      "ws subscribe r1",
      "ws subscribe r2",
      // ack を待ってから、購読より前の変更を取り直す（参加中のスレッドの一覧も。ADR 0036）
      "GET /api/v1/workspaces/ws-1/rooms",
      "GET /api/v1/workspaces/ws-1/threads?limit=200",
    ]);
    expect(store.getSnapshot().connection).toEqual({ banner: null, unavailable: null });
    realtime.stop();
  });

  it("waits for the acks before reading over REST", async () => {
    const { store, realtime, sockets, log } = setup(
      { "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1") },
      { autoAck: false },
    );
    await store.loadRooms("ws-1");
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);
    log.length = 0;

    const [first, second] = sockets.last().sent.filter((m) => m.type === "subscribe");
    sockets.last().receive({ type: "ack", id: first.id! });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual([]);

    sockets.last().receive({ type: "ack", id: second.id! });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["GET /api/v1/workspaces/ws-1/rooms", "GET /api/v1/workspaces/ws-1/threads?limit=200"]);
    realtime.stop();
  });

  it("follows the workspace switch: unsubscribes the old one and subscribes the new one", async () => {
    const { store, realtime, sockets } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1"),
      "GET /api/v1/workspaces/ws-2/rooms": roomsOf("r9"),
    });
    await Promise.all([store.loadRooms("ws-1"), store.loadRooms("ws-2")]);
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);

    store.setActiveWorkspace("ws-2");
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets.last().messages().slice(2)).toEqual([
      { type: "unsubscribe", workspace_id: "ws-1" },
      { type: "unsubscribe", room_id: "r1" },
      { type: "subscribe", workspace_id: "ws-2" },
      { type: "subscribe", room_id: "r9" },
    ]);
    realtime.stop();
  });

  // ADR 0049 決定 3: 接続は「見ていない」から始まるので、つないだ直後に今の値を送り、あとは変わったときだけ送る
  it("sends the activity right after connecting and whenever it changes", async () => {
    let notify!: (active: boolean) => void;
    let viewing = true;
    const { store, realtime, sockets } = setup(
      { "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1") },
      {
        createActivity: (onChange) => {
          notify = onChange;
          return { start: () => {}, stop: () => {}, current: () => viewing, reset: () => {} };
        },
      },
    );
    await store.loadRooms("ws-1");
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets.last();
    socket.open();
    await vi.advanceTimersByTimeAsync(0);

    // つないだ直後の 1 回
    expect(socket.sent.filter((m) => m.type === "activity")).toEqual([{ type: "activity", active: true }]);

    // 画面を離れたら送る
    viewing = false;
    notify(false);
    expect(socket.sent.filter((m) => m.type === "activity")).toEqual([
      { type: "activity", active: true },
      { type: "activity", active: false },
    ]);
    realtime.stop();
  });

  it("subscribes to a room that appears in the list", async () => {
    const { store, realtime, sockets } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1"),
      "GET /api/v1/rooms/r2": () => json(200, room("r2", "r2")),
    });
    await store.loadRooms("ws-1");
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);

    sockets.last().receive({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r2", user: naoki } });
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets.last().messages()).toContainEqual({ type: "subscribe", room_id: "r2" });
    realtime.stop();
  });

  it("after reconnecting, resubscribes, fetches what was missed, and shows syncing then restored", async () => {
    let releaseChanges!: () => void;
    const changesGate = new Promise<void>((r) => (releaseChanges = r));
    const { store, realtime, sockets } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1"),
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "r1", { last_message_seq: 1, last_read_seq: 1 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () =>
        json(200, { messages: [message(1, { room_id: "r1" })], has_more: false, last_change_seq: 1 }),
      "GET /api/v1/rooms/r1/messages?after_change_seq=1&limit=100": async () => {
        await changesGate;
        return json(200, { messages: [message(2, { room_id: "r1" })], has_more: false, last_change_seq: 2 });
      },
      "GET /api/v1/rooms/r1/members?limit=200": () => json(200, { members: [roomMember(naoki)], next_cursor: null }),
    });
    await store.loadRooms("ws-1");
    await store.openRoom("r1");
    await store.loadRoomMembers("r1");
    store.setActiveWorkspace("ws-1");
    store.setFocus({ roomId: "r1", caughtUp: false });
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);
    // 最初の接続の同期（差分の取得）を終わらせておく
    releaseChanges();
    await vi.advanceTimersByTimeAsync(0);
    const firstSocket = sockets.last();

    firstSocket.serverClose(1012);
    expect(store.getSnapshot().connection.banner).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    sockets.last().open();
    expect(store.getSnapshot().connection.banner).toBe("syncing");
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets.last()).not.toBe(firstSocket);
    expect(sockets.last().messages()).toEqual([
      { type: "subscribe", workspace_id: "ws-1" },
      { type: "subscribe", room_id: "r1" },
    ]);
    expect(store.getSnapshot().connection.banner).toBe("restored");
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getSnapshot().connection.banner).toBeNull();
    realtime.stop();
  });

  it("after reconnecting, catches up with the saved messages from the cursor (ADR 0054)", async () => {
    const { store, realtime, sockets, log } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1"),
      "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [], next_cursor: null }),
      "GET /api/v1/workspaces/ws-1/saved?state=in_progress&limit=50": () =>
        json(200, { items: [savedItem(1)], in_progress_count: 1, last_change_seq: 3, has_more: false }),
      "GET /api/v1/workspaces/ws-1/saved?after_change_seq=3&limit=100": () =>
        json(200, {
          items: [savedItem(1, { state: "archived", change_seq: 4 })],
          in_progress_count: 0,
          last_change_seq: 4,
          has_more: false,
        }),
    });
    await store.loadRooms("ws-1");
    await store.loadSaved("ws-1", "in_progress");
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);

    expect(log).toContain("GET /api/v1/workspaces/ws-1/saved?after_change_seq=3&limit=100");
    expect(store.getSnapshot().saved["ws-1"]).toMatchObject({ cursor: 4, inProgressCount: 0 });
    realtime.stop();
  });

  it("keeps showing syncing until the missed changes are fetched", async () => {
    let release!: () => void;
    let calls = 0;
    const { store, realtime, sockets } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1"),
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "r1")),
      "GET /api/v1/rooms/r1/messages?limit=50": () => json(200, { messages: [], has_more: false, last_change_seq: 0 }),
      "GET /api/v1/rooms/r1/messages?after_change_seq=0&limit=100": async () => {
        if (++calls === 2) await new Promise<void>((r) => (release = r));
        return json(200, { messages: [], has_more: false, last_change_seq: 0 });
      },
    });
    await store.loadRooms("ws-1");
    await store.openRoom("r1");
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);

    sockets.last().serverClose(1001);
    await vi.advanceTimersByTimeAsync(1000);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().connection.banner).toBe("syncing");

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().connection.banner).toBe("restored");
    realtime.stop();
  });

  it("applies events to the store", async () => {
    const { store, realtime, sockets } = setup({ "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1") });
    await store.loadRooms("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();

    sockets.last().receive({ type: "message.created", data: message(1, { room_id: "r1" }) });

    expect(store.getSnapshot().rooms.r1?.last_message_seq).toBe(1);
    realtime.stop();
  });

  it("reloads the list instead of retrying when a room can no longer be subscribed", async () => {
    let rooms = ["r1", "gone"];
    const { store, realtime, sockets } = setup(
      { "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: rooms.map((id) => room(id, id)) }) },
      { autoAck: false },
    );
    await store.loadRooms("ws-1");
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets.last();
    socket.open();
    await vi.advanceTimersByTimeAsync(0);

    rooms = ["r1"];
    for (const m of socket.sent) {
      socket.receive({ type: "ack", id: m.id!, ...(m.room_id === "gone" ? { error: "not_found" as const } : {}) });
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1"]);
    expect(socket.messages().filter((m) => m.room_id === "gone")).toHaveLength(1);
    realtime.stop();
  });

  it("shows the server-unavailable screen after repeated unreachable attempts following a working connection", async () => {
    let reachable = true;
    const { store, realtime, sockets, api } = setup({});
    api.fetch.mockImplementation(
      ((original) => async (url: string, init?: RequestInit) => {
        if (!reachable && url.endsWith("/ws/ticket")) throw new TypeError("fetch failed");
        return original(url, init);
      })(api.fetch.getMockImplementation()!),
    );
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    const openedAt = Date.now();

    reachable = false;
    sockets.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000 + 2000);
    expect(store.getSnapshot().connection).toEqual({ banner: "reconnecting", unavailable: null });

    await vi.advanceTimersByTimeAsync(4000);
    expect(store.getSnapshot().connection).toEqual({
      banner: "reconnecting",
      unavailable: { lastConnectedAt: openedAt, retryCount: 3 },
    });

    reachable = true;
    realtime.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    expect(store.getSnapshot().connection.unavailable).toBeNull();
    realtime.stop();
  });

  it("sends typing only for subscribed rooms, at most once every 3 seconds", async () => {
    const { store, realtime, sockets, log } = setup({ "GET /api/v1/workspaces/ws-1/rooms": roomsOf("r1") });
    // つながる前は落とす
    realtime.sendTyping("r1");
    await store.loadRooms("ws-1");
    store.setActiveWorkspace("ws-1");
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();
    await vi.advanceTimersByTimeAsync(0);
    log.length = 0;

    realtime.sendTyping("r1");
    realtime.sendTyping("r1");
    realtime.sendTyping("other");
    await vi.advanceTimersByTimeAsync(2_999);
    realtime.sendTyping("r1");
    await vi.advanceTimersByTimeAsync(1);
    realtime.sendTyping("r1");

    expect(log).toEqual(["ws typing r1", "ws typing r1"]);
    realtime.stop();
  });

  it("stops listening to the store and closes the socket on stop", async () => {
    const { store, realtime, sockets } = setup({});
    realtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets.last().open();

    realtime.stop();
    store.setActiveWorkspace("ws-1");
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets.last().closed).toBe(true);
    expect(sockets.last().messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
