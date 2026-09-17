import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/auth/session";
import { message, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { type Handler, TEST_API_BASE, fakeApi, json, problem, tokens } from "@/test/fake-api";

import { createChatApi } from "./api";
import { createChatStore } from "./store";

function setup(routes: Record<string, Handler>) {
  const api = fakeApi({ "POST /api/v1/auth/refresh": () => tokens("at-1"), ...routes });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const store = createChatStore(createChatApi(session.request), { userId: naoki.id });
  return { api, store, requests: () => api.paths().filter((p) => !p.includes("/auth/")) };
}

function body(init: RequestInit) {
  return JSON.parse(init.body as string);
}

describe("createChatStore", () => {
  it("loads workspaces once even if asked twice at the same time", async () => {
    const { store, requests } = setup({
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
    });

    await Promise.all([store.loadWorkspaces(), store.loadWorkspaces()]);

    expect(requests()).toEqual(["GET /api/v1/workspaces"]);
    expect(store.getSnapshot().workspaces).toEqual({ status: "ready", list: [workspace("ws-1", "hibari 開発")] });
  });

  it("marks a room list as not_found on 404", async () => {
    const { store } = setup({ "GET /api/v1/workspaces/ws-x/rooms": () => problem(404, "not-found") });

    await store.loadRooms("ws-x");

    expect(store.getSnapshot().roomLists["ws-x"]?.status).toBe("not_found");
  });

  it("keeps member_count from the single-room fetch when the list is reloaded", async () => {
    const { store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { member_count: 4 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () => json(200, { messages: [], has_more: false, last_change_seq: 0 }),
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談 改")] }),
    });

    await store.openRoom("r1");
    await store.loadRooms("ws-1");

    expect(store.getSnapshot().rooms.r1).toMatchObject({ name: "雑談 改", member_count: 4 });
  });

  describe("openRoom", () => {
    it("fixes the unread divider at the read position before opening, then marks the shown messages read", async () => {
      const { api, store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 1, unread_count: 2 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [message(3), message(1), message(2)], has_more: true, last_change_seq: 3 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 3, unread_count: 0 }),
      });

      await store.openRoom("r1");

      const state = store.getSnapshot();
      expect(state.timelines.r1).toMatchObject({ status: "ready", hasOlder: true, unreadAfterSeq: 1 });
      expect(state.timelines.r1?.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
      expect(state.rooms.r1).toMatchObject({ last_read_seq: 3, unread_count: 0 });
      const read = api.calls.find((c) => c.path === "/api/v1/rooms/r1/read")!;
      expect(body(read.init)).toEqual({ seq: 3 });
    });

    it("marks read only up to the newest message it shows, not the room's latest seq", async () => {
      const { api, store } = setup({
        // メッセージの取得の後に 1 件届いた
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 0 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [message(1), message(2)], has_more: false, last_change_seq: 2 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 2, unread_count: 1 }),
      });

      await store.openRoom("r1");

      expect(body(api.calls.find((c) => c.path === "/api/v1/rooms/r1/read")!.init)).toEqual({ seq: 2 });
    });

    it("does not mark read when already read or when not a member", async () => {
      const { requests, store } = setup({
        "GET /api/v1/rooms/seen": () => json(200, room("seen", "a", { last_message_seq: 2, last_read_seq: 2 })),
        "GET /api/v1/rooms/seen/messages?limit=50": () =>
          json(200, { messages: [message(1), message(2)], has_more: false, last_change_seq: 2 }),
        "GET /api/v1/rooms/guest": () =>
          json(200, room("guest", "b", { is_member: false, last_message_seq: 2, last_read_seq: null })),
        "GET /api/v1/rooms/guest/messages?limit=50": () =>
          json(200, { messages: [message(1), message(2)], has_more: false, last_change_seq: 2 }),
      });

      await store.openRoom("seen");
      await store.openRoom("guest");

      expect(requests().some((p) => p.startsWith("POST") && p.endsWith("/read"))).toBe(false);
      expect(store.getSnapshot().timelines.guest?.unreadAfterSeq).toBeNull();
    });

    it("reports not_found when the room cannot be read", async () => {
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => problem(404, "not-found"),
        "GET /api/v1/rooms/r1/messages?limit=50": () => problem(404, "not-found"),
      });

      await store.openRoom("r1");

      expect(store.getSnapshot().timelines.r1?.status).toBe("not_found");
    });
  });

  it("prepends older pages by seq and stops when there are no more", async () => {
    const { requests, store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_read_seq: 60, last_message_seq: 60 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () =>
        json(200, { messages: [message(59), message(60)], has_more: true, last_change_seq: 60 }),
      "GET /api/v1/rooms/r1/messages?limit=50&before_seq=59": () =>
        json(200, { messages: [message(57), message(58)], has_more: false, last_change_seq: 60 }),
    });
    await store.openRoom("r1");

    await Promise.all([store.loadOlder("r1"), store.loadOlder("r1")]);
    await store.loadOlder("r1");

    expect(store.getSnapshot().timelines.r1).toMatchObject({ hasOlder: false, loadingOlder: false });
    expect(store.getSnapshot().timelines.r1?.messages.map((m) => m.seq)).toEqual([57, 58, 59, 60]);
    expect(requests().filter((p) => p.includes("before_seq"))).toHaveLength(1);
  });

  it("keeps hasOlder after a failed older page so it can be retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_read_seq: 2, last_message_seq: 2 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () =>
        json(200, { messages: [message(2)], has_more: true, last_change_seq: 2 }),
      "GET /api/v1/rooms/r1/messages?limit=50&before_seq=2": () => problem(500, "internal"),
    });
    await store.openRoom("r1");

    await store.loadOlder("r1");

    expect(store.getSnapshot().timelines.r1).toMatchObject({ hasOlder: true, loadingOlder: false });
  });

  it("dismisses the unread divider without another request", async () => {
    const { requests, store } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_read_seq: 1, last_message_seq: 1 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () =>
        json(200, { messages: [message(1)], has_more: false, last_change_seq: 1 }),
    });
    await store.openRoom("r1");
    const before = requests().length;

    store.dismissUnread("r1");

    expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBeNull();
    expect(requests()).toHaveLength(before);
  });

  it("creates a room and appends it to the workspace's list", async () => {
    const { api, store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "POST /api/v1/workspaces/ws-1/rooms": () => json(201, room("r2", "デザイン", { kind: "private" })),
    });
    await store.loadRooms("ws-1");

    const created = await store.createRoom("ws-1", { kind: "private", name: "デザイン" });

    expect(created.id).toBe("r2");
    expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1", "r2"]);
    expect(body(api.calls.at(-1)!.init)).toEqual({ kind: "private", name: "デザイン" });
  });

  it("updates the room after joining", async () => {
    const { store } = setup({
      "POST /api/v1/rooms/r1/join": () => json(200, room("r1", "雑談", { is_member: true, last_read_seq: 0 })),
    });

    await store.joinRoom("r1");

    expect(store.getSnapshot().rooms.r1).toMatchObject({ is_member: true, last_read_seq: 0 });
  });

  it("follows the member list cursor to the end", async () => {
    const { store } = setup({
      "GET /api/v1/rooms/r1/members?limit=200": () =>
        json(200, { members: [roomMember(naoki)], next_cursor: naoki.id }),
      [`GET /api/v1/rooms/r1/members?limit=200&after=${naoki.id}`]: () =>
        json(200, { members: [roomMember(miyuki)], next_cursor: null }),
    });

    await store.loadRoomMembers("r1");

    expect(store.getSnapshot().roomMembers.r1).toEqual({ status: "ready", members: [roomMember(naoki), roomMember(miyuki)] });
  });

  it("notifies subscribers and replaces only the changed parts", async () => {
    const { store } = setup({
      "GET /api/v1/workspaces": () => json(200, { workspaces: [] }),
    });
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    await store.loadWorkspaces();

    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().rooms).toBe(before.rooms);
  });
});

describe("createChatStore realtime", () => {
  const me = naoki.id;
  const msg = (seq: number, overrides: Parameters<typeof message>[1] = {}) =>
    message(seq, { room_id: "r1", ...overrides });

  function page(messages: ReturnType<typeof message>[], lastChangeSeq: number, hasMore = false) {
    return json(200, { messages, has_more: hasMore, last_change_seq: lastChangeSeq });
  }

  /** r1（最新 3 件、既読 3）を開いた状態にする。 */
  async function opened(routes: Record<string, Handler> = {}) {
    const ctx = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, { rooms: [room("r0", "先頭"), room("r1", "雑談", { last_message_seq: 3, last_read_seq: 3 })] }),
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 3 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(1), msg(2), msg(3)], 3),
      "POST /api/v1/rooms/r1/read": (_url, init) => {
        const { seq } = body(init);
        return json(200, { last_read_seq: seq, unread_count: 0 });
      },
      ...routes,
    });
    await ctx.store.loadRooms("ws-1");
    await ctx.store.openRoom("r1");
    return ctx;
  }

  const created = (m: ReturnType<typeof message>) => ({ type: "message.created" as const, data: m });
  const seqs = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().timelines.r1?.messages.map((m) => m.seq);

  describe("message events", () => {
    it("appends a new message, advances the cursor, and moves the room to the top of the list", async () => {
      const { store, requests } = await opened();
      const before = requests().length;

      store.applyEvent(created(msg(4)));

      const state = store.getSnapshot();
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
      expect(state.timelines.r1?.changeSeq).toBe(4);
      expect(state.rooms.r1).toMatchObject({ last_message_seq: 4, unread_count: 1, last_message: { id: "m-4" } });
      expect(state.roomLists["ws-1"]?.ids).toEqual(["r1", "r0"]);
      expect(requests()).toHaveLength(before);
    });

    it("ignores an event that is already reflected", async () => {
      const { store } = await opened();
      const before = store.getSnapshot();

      store.applyEvent(created(msg(3)));

      expect(store.getSnapshot().timelines).toBe(before.timelines);
    });

    it("applies edits and deletions by id without changing the order", async () => {
      const { store } = await opened();

      store.applyEvent({ type: "message.updated", data: msg(2, { change_seq: 4, body: "編集後" }) });
      store.applyEvent({ type: "message.deleted", data: msg(3, { change_seq: 5, body: "", deleted_at: "2026-09-13T02:00:00Z" }) });

      const messages = store.getSnapshot().timelines.r1!.messages;
      expect(messages.map((m) => [m.seq, m.body])).toEqual([[1, "本文 1"], [2, "編集後"], [3, ""]]);
      expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(5);
    });

    it("fetches the missing changes when an event skips a change_seq", async () => {
      const { store, requests } = await opened({
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () =>
          page([msg(2, { change_seq: 4, body: "取りこぼした編集" }), msg(4, { change_seq: 5 })], 6),
      });

      store.applyEvent(created(msg(5, { change_seq: 6 })));
      // 表示はすぐに足す
      expect(seqs(store)).toEqual([1, 2, 3, 5]);
      await vi.waitFor(() => expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(6));

      expect(seqs(store)).toEqual([1, 2, 3, 4, 5]);
      expect(store.getSnapshot().timelines.r1?.messages[1].body).toBe("取りこぼした編集");
      expect(requests().filter((p) => p.includes("after_change_seq"))).toHaveLength(1);
    });

    it("counts events that arrive out of order once the gap is filled, without fetching again", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () =>
          new Promise<Response>(() => {}), // 差分の取得は返らないまま
      });

      store.applyEvent(created(msg(5, { change_seq: 5 })));
      store.applyEvent(created(msg(4, { change_seq: 4 })));

      expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(5);
      expect(seqs(store)).toEqual([1, 2, 3, 4, 5]);
    });

    it("does not insert edits of messages older than the loaded page", async () => {
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 60, last_read_seq: 60 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(59), msg(60)], 60, true),
      });
      await store.openRoom("r1");

      store.applyEvent({ type: "message.updated", data: msg(10, { change_seq: 61 }) });

      expect(seqs(store)).toEqual([59, 60]);
      expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(61);
    });

    it("keeps events that arrive while the room is still loading", async () => {
      let respond!: (r: Response) => void;
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 2, last_read_seq: 2 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => new Promise<Response>((r) => (respond = r)),
      });

      const opening = store.openRoom("r1");
      await vi.waitFor(() => expect(respond).toBeDefined());
      store.applyEvent(created(msg(3)));
      respond(page([msg(1), msg(2)], 2));
      await opening;

      expect(seqs(store)).toEqual([1, 2, 3]);
      expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(3);
    });
  });

  describe("syncTimeline", () => {
    it("merges the changes after the cursor and moves the cursor to last_change_seq", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () =>
          page([msg(2, { change_seq: 5, body: "編集" }), msg(4, { change_seq: 6 })], 7),
      });

      await store.syncTimeline("r1");

      expect(seqs(store)).toEqual([1, 2, 3, 4]);
      // 7 は他人のルームの別の変更ではなく、このルームの変更で、差分に含まれていた（読む前の値なので進めてよい）
      expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(7);
    });

    it("reloads the latest page when it is too far behind, keeping events that arrived meanwhile", async () => {
      let latestCalls = 0;
      let respondLatest!: (r: Response) => void;
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50": () => {
          latestCalls++;
          if (latestCalls === 1) return page([msg(1), msg(2), msg(3)], 3);
          return new Promise<Response>((r) => (respondLatest = r));
        },
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () => page([msg(4)], 300, true),
      });

      const syncing = store.syncTimeline("r1");
      await vi.waitFor(() => expect(respondLatest).toBeDefined());
      // 最新のページを読んだ後に届いたイベント
      store.applyEvent(created(msg(252, { change_seq: 301 })));
      respondLatest(page([msg(250, { change_seq: 299 }), msg(251, { change_seq: 300 })], 300, true));
      await syncing;

      expect(store.getSnapshot().timelines.r1).toMatchObject({ hasOlder: true, changeSeq: 301 });
      expect(seqs(store)).toEqual([250, 251, 252]);
    });

    it("runs once more instead of in parallel when asked during a sync", async () => {
      const cursors: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": async (url) => {
          cursors.push(url);
          await gate;
          return page([msg(4)], 4);
        },
        "GET /api/v1/rooms/r1/messages?after_change_seq=4&limit=100": (url) => {
          cursors.push(url);
          return page([], 4);
        },
      });

      const first = store.syncTimeline("r1");
      const second = store.syncTimeline("r1");
      const third = store.syncTimeline("r1");
      release();
      await Promise.all([first, second, third]);

      expect(cursors.map((u) => new URL(u).searchParams.get("after_change_seq"))).toEqual(["3", "4"]);
    });
  });

  describe("reading while the room is open", () => {
    it("marks new messages read while the latest is in view, without showing the divider", async () => {
      const { store, api } = await opened();
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(created(msg(4)));

      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 4, unread_count: 0 }));
      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(4);
      expect(body(api.calls.at(-1)!.init)).toEqual({ seq: 4 });
    });

    it("shows the divider before messages that arrived while not looking, and reads them once caught up", async () => {
      const { store } = await opened();
      store.setFocus({ roomId: "r1", caughtUp: false });

      store.applyEvent(created(msg(4)));
      store.applyEvent(created(msg(5)));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 3, unread_count: 2 });

      store.setFocus({ roomId: "r1", caughtUp: true });
      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.unread_count).toBe(0));
      // 区切りは、開いている間は残す
      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
    });

    it("keeps an existing divider where it is when more messages arrive in view", async () => {
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 1 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(1), msg(2), msg(3)], 3),
        "POST /api/v1/rooms/r1/read": (_url, init) => json(200, { last_read_seq: body(init).seq, unread_count: 0 }),
      });
      await store.openRoom("r1");
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(created(msg(4)));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(1);
    });

    it("brings the divider back after it was dismissed when messages arrive unseen", async () => {
      const { store } = await opened();
      store.dismissUnread("r1");

      store.applyEvent(created(msg(4)));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
    });

    it("does not treat my own message from another tab as unread", async () => {
      const { store } = await opened();
      store.setFocus({ roomId: "r1", caughtUp: false });

      store.applyEvent(created(msg(4, { sender: naoki })));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(4);
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 4, unread_count: 0 });
    });

    it("sends one more read with the newest seq instead of one per message", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const reads: number[] = [];
      const { store } = await opened({
        "POST /api/v1/rooms/r1/read": async (_url, init) => {
          reads.push(body(init).seq);
          await gate;
          return json(200, { last_read_seq: body(init).seq, unread_count: 0 });
        },
      });
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(created(msg(4)));
      store.applyEvent(created(msg(5)));
      store.applyEvent(created(msg(6)));
      release();

      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.last_read_seq).toBe(6));
      expect(reads).toEqual([4, 6]);
    });

    it("applies room.read from another tab without moving backwards", async () => {
      const { store } = await opened();
      store.applyEvent(created(msg(4)));
      store.applyEvent(created(msg(5)));

      store.applyEvent({ type: "room.read", data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 5, unread_count: 0 } });
      store.applyEvent({ type: "room.read", data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 4, unread_count: 1 } });

      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 5, unread_count: 0 });
    });
  });

  it("syncs the cached timeline instead of reloading when a room is opened again", async () => {
    const { store, requests } = await opened({
      "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () => page([msg(4)], 4),
    });
    store.dismissUnread("r1");

    await store.openRoom("r1");

    expect(seqs(store)).toEqual([1, 2, 3, 4]);
    expect(requests().filter((p) => p === "GET /api/v1/rooms/r1/messages?limit=50")).toHaveLength(1);
    // 区切りは開き直した時点の既読位置に戻る
    expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
  });

  describe("typing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const typing = (user: typeof miyuki) => ({
      type: "typing.started" as const,
      data: { workspace_id: "ws-1", room_id: "r1", user },
    });

    it("shows who is typing for 6 seconds after the last notice", async () => {
      const { store } = setup({});

      store.applyEvent(typing(miyuki));
      await vi.advanceTimersByTimeAsync(5_000);
      store.applyEvent(typing(miyuki));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.getSnapshot().typing.r1?.map((t) => t.user.id)).toEqual([miyuki.id]);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.getSnapshot().typing.r1).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores myself and clears someone once their message arrives", () => {
      const { store } = setup({});

      store.applyEvent(typing(naoki));
      store.applyEvent(typing(miyuki));
      expect(store.getSnapshot().typing.r1?.map((t) => t.user.id)).toEqual([miyuki.id]);

      store.applyEvent(created(msg(1, { sender: miyuki })));
      expect(store.getSnapshot().typing.r1).toBeUndefined();
    });

    it("stops its timers on dispose", () => {
      const { store } = setup({});
      store.applyEvent(typing(miyuki));

      store.dispose();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("members and presence", () => {
    it("updates presence in DM peers and loaded member lists", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () =>
          json(200, { rooms: [room("dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, online: false } })] }),
        "GET /api/v1/rooms/r1/members?limit=200": () =>
          json(200, { members: [roomMember(miyuki), roomMember(naoki, { online: true })], next_cursor: null }),
      });
      await store.loadRooms("ws-1");
      await store.loadRoomMembers("r1");
      const untouched = store.getSnapshot().roomMembers.r1!.members[1];

      store.applyEvent({ type: "presence.changed", data: { user_id: miyuki.id, online: true } });

      const state = store.getSnapshot();
      expect(state.rooms.dm?.dm_peer?.online).toBe(true);
      expect(state.roomMembers.r1?.members[0].online).toBe(true);
      expect(state.roomMembers.r1?.members[1]).toBe(untouched);
    });

    it("reloads a loaded member list and the member count when someone joins, and removes those who left", async () => {
      let members = [roomMember(miyuki)];
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { member_count: members.length })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([], 0),
        "GET /api/v1/rooms/r1/members?limit=200": () => json(200, { members, next_cursor: null }),
      });
      await store.openRoom("r1");
      await store.loadRoomMembers("r1");

      members = [roomMember(miyuki), roomMember(naoki)];
      store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r1", user: { ...miyuki, id: "other" } } });
      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.member_count).toBe(2));
      expect(store.getSnapshot().roomMembers.r1?.members).toHaveLength(2);

      members = [roomMember(naoki)];
      store.applyEvent({ type: "member.left", data: { workspace_id: "ws-1", room_id: "r1", user_id: miyuki.id } });
      expect(store.getSnapshot().roomMembers.r1?.members.map((m) => m.user.id)).toEqual([naoki.id]);
      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.member_count).toBe(1));
    });

    it("adds a room I was added to from elsewhere to the list", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () =>
          json(200, { rooms: [room("r-new", "新しい", { last_message_at: "2026-09-13T03:00:00Z" }), room("r-quiet", "静か")] }),
        "GET /api/v1/rooms/r-added": () =>
          json(200, room("r-added", "追加された", { kind: "private", last_message_at: "2026-09-13T02:00:00Z" })),
      });
      await store.loadRooms("ws-1");

      store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r-added", user: naoki } });

      await vi.waitFor(() => expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r-new", "r-added", "r-quiet"]));
    });

    it("updates roles in member lists and my role in the workspace", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
        "GET /api/v1/rooms/r1/members?limit=200": () => json(200, { members: [roomMember(naoki)], next_cursor: null }),
      });
      await Promise.all([store.loadWorkspaces(), store.loadRooms("ws-1"), store.loadRoomMembers("r1")]);

      store.applyEvent({ type: "workspace.role_changed", data: { workspace_id: "ws-1", user_id: me, role: "admin" } });

      expect(store.getSnapshot().workspaces.list[0].my_role).toBe("admin");
      expect(store.getSnapshot().roomMembers.r1?.members[0].role).toBe("admin");
    });

    it("renames rooms and workspaces", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      });
      await Promise.all([store.loadWorkspaces(), store.loadRooms("ws-1")]);

      store.applyEvent({ type: "room.updated", data: { workspace_id: "ws-1", room_id: "r1", name: "雑談 改", is_default: true } });
      store.applyEvent({ type: "workspace.updated", data: { workspace_id: "ws-1", name: "hibari", invite_policy: "all_members" } });

      expect(store.getSnapshot().rooms.r1).toMatchObject({ name: "雑談 改", is_default: true });
      expect(store.getSnapshot().workspaces.list[0]).toMatchObject({ name: "hibari", invite_policy: "all_members" });
    });
  });

  describe("removal", () => {
    const privateRoomRoutes = {
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発"), workspace("ws-2", "個人メモ")] }),
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, { rooms: [room("r1", "雑談", { kind: "private" }), room("r2", "設計", { kind: "private" })] }),
    };
    const removed = (roomId: string) => ({
      type: "room.member_removed" as const,
      data: { workspace_id: "ws-1", room_id: roomId, reason: "removed" as const },
    });

    it("keeps the open private room in the list with a notice until I leave it, and drops others at once", async () => {
      const { store } = setup(privateRoomRoutes);
      await store.loadRooms("ws-1");
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(removed("r1"));
      store.applyEvent(removed("r2"));

      expect(store.getSnapshot().removedRooms).toMatchObject({ r1: "removed", r2: "removed" });
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1"]);

      store.setFocus(null);
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual([]);
      expect(store.getSnapshot().removedRooms.r1).toBeUndefined();
    });

    it("turns a public room back into a readable room I have not joined", async () => {
      const { store } = await opened();

      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "left" } });

      const state = store.getSnapshot();
      expect(state.rooms.r1).toMatchObject({ is_member: false, last_read_seq: null, unread_count: 0 });
      expect(state.roomLists["ws-1"]?.ids).toContain("r1");
      expect(state.removedRooms.r1).toBeUndefined();
      expect(state.timelines.r1?.unreadAfterSeq).toBeNull();
    });

    it("takes the workspace out of the list but remembers its name for the notice", async () => {
      const { store } = setup(privateRoomRoutes);
      await store.loadWorkspaces();

      store.applyEvent({ type: "workspace.member_removed", data: { workspace_id: "ws-1", user_id: miyuki.id, reason: "removed" } });
      expect(store.getSnapshot().workspaces.list).toHaveLength(2);

      store.applyEvent({ type: "workspace.member_removed", data: { workspace_id: "ws-1", user_id: me, reason: "removed" } });
      expect(store.getSnapshot().workspaces.list.map((w) => w.id)).toEqual(["ws-2"]);
      expect(store.getSnapshot().removedWorkspaces["ws-1"]).toMatchObject({ reason: "removed", workspace: { name: "hibari 開発" } });

      store.forgetRemovedWorkspace("ws-1");
      expect(store.getSnapshot().removedWorkspaces["ws-1"]).toBeUndefined();
    });
  });
});
