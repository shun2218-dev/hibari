import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/auth/session";
import { invite, member, message, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { type Handler, TEST_API_BASE, fakeApi, json, problem, tokens } from "@/test/fake-api";

import { createChatApi } from "./api";
import { type ChatStoreOptions, createChatStore } from "./store";

function setup(routes: Record<string, Handler>, options: Partial<ChatStoreOptions> = {}) {
  const api = fakeApi({ "POST /api/v1/auth/refresh": () => tokens("at-1"), ...routes });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const store = createChatStore(createChatApi(session.request), { userId: naoki.id, ...options });
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

  it("adds the workspace to the list when an invite is accepted", async () => {
    const joined = workspace("ws-2", "山と印刷");
    const { store } = setup({
      "GET /api/v1/workspaces": () => json(200, { workspaces: [workspace("ws-1", "hibari 開発")] }),
      "POST /api/v1/invites/abc/accept": () => json(200, { workspace: joined, already_member: false }),
    });
    await store.loadWorkspaces();

    await store.acceptInvite("abc");
    // すでにメンバーだった招待は使用回数を消費せず（ADR 0011）、一覧も増やさない
    await store.acceptInvite("abc");

    expect(store.getSnapshot().workspaces.list.map((w) => w.id)).toEqual(["ws-1", "ws-2"]);
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
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 1, last_user_seq: 3, last_read_user_seq: 1, unread_count: 2 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [message(3), message(1), message(2)], has_more: true, last_change_seq: 3 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 3, last_read_user_seq: 3, unread_count: 0 }),
      });

      await store.openRoom("r1");

      const state = store.getSnapshot();
      expect(state.timelines.r1).toMatchObject({ status: "ready", hasOlder: true, unreadAfterSeq: 1 });
      expect(state.timelines.r1?.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
      expect(state.rooms.r1).toMatchObject({ last_read_seq: 3, last_read_user_seq: 3, unread_count: 0 });
      const read = api.calls.find((c) => c.path === "/api/v1/rooms/r1/read")!;
      expect(body(read.init)).toEqual({ seq: 3 });
    });

    it("marks read only up to the newest message it shows, not the room's latest seq", async () => {
      const { api, store } = setup({
        // メッセージの取得の後に 1 件届いた
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 0, last_user_seq: 3, last_read_user_seq: 0 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [message(1), message(2)], has_more: false, last_change_seq: 2 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 2, last_read_user_seq: 2, unread_count: 1 }),
      });

      await store.openRoom("r1");

      expect(body(api.calls.find((c) => c.path === "/api/v1/rooms/r1/read")!.init)).toEqual({ seq: 2 });
    });

    it("does not mark read when already read or when not a member", async () => {
      const { requests, store } = setup({
        "GET /api/v1/rooms/seen": () => json(200, room("seen", "a", { last_message_seq: 2, last_read_seq: 2, last_user_seq: 2, last_read_user_seq: 2 })),
        "GET /api/v1/rooms/seen/messages?limit=50": () =>
          json(200, { messages: [message(1), message(2)], has_more: false, last_change_seq: 2 }),
        "GET /api/v1/rooms/guest": () =>
          json(200, room("guest", "b", { is_member: false, last_message_seq: 2, last_read_seq: null, last_user_seq: 2, last_read_user_seq: null })),
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
  async function opened(routes: Record<string, Handler> = {}, options: Partial<ChatStoreOptions> = {}) {
    const ctx = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, { rooms: [room("r0", "先頭"), room("r1", "雑談", { last_message_seq: 3, last_read_seq: 3, last_user_seq: 3, last_read_user_seq: 3 })] }),
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 3, last_user_seq: 3, last_read_user_seq: 3 })),
      "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(1), msg(2), msg(3)], 3),
      "POST /api/v1/rooms/r1/read": (_url, init) => {
        const { seq } = body(init);
        return json(200, { last_read_seq: seq, last_read_user_seq: seq, unread_count: 0 });
      },
      ...routes,
    }, options);
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
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 60, last_read_seq: 60, last_user_seq: 60, last_read_user_seq: 60 })),
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
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 2, last_read_seq: 2, last_user_seq: 2, last_read_user_seq: 2 })),
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

      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 4, last_read_user_seq: 4, unread_count: 0 }));
      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(4);
      expect(body(api.calls.at(-1)!.init)).toEqual({ seq: 4 });
    });

    it("shows the divider before messages that arrived while not looking, and reads them once caught up", async () => {
      const { store } = await opened();
      store.setFocus({ roomId: "r1", caughtUp: false });

      store.applyEvent(created(msg(4)));
      store.applyEvent(created(msg(5)));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 3, last_read_user_seq: 3, unread_count: 2 });

      store.setFocus({ roomId: "r1", caughtUp: true });
      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.unread_count).toBe(0));
      // 区切りは、開いている間は残す
      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
    });

    it("keeps an existing divider where it is when more messages arrive in view", async () => {
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 1, last_user_seq: 3, last_read_user_seq: 1 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(1), msg(2), msg(3)], 3),
        "POST /api/v1/rooms/r1/read": (_url, init) => json(200, { last_read_seq: body(init).seq, last_read_user_seq: body(init).seq, unread_count: 0 }),
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
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 4, last_read_user_seq: 4, unread_count: 0 });
    });

    it("sends one more read with the newest seq instead of one per message", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const reads: number[] = [];
      const { store } = await opened({
        "POST /api/v1/rooms/r1/read": async (_url, init) => {
          reads.push(body(init).seq);
          await gate;
          return json(200, { last_read_seq: body(init).seq, last_read_user_seq: body(init).seq, unread_count: 0 });
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

      store.applyEvent({
        type: "room.read",
        data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 5, last_read_user_seq: 5, unread_count: 0, mention_count: 0 },
      });
      store.applyEvent({
        type: "room.read",
        data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 4, last_read_user_seq: 4, unread_count: 1, mention_count: 0 },
      });

      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 5, last_read_user_seq: 5, unread_count: 0 });
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

  describe("threads (ADR 0036)", () => {
    const threadRoot = (lastThreadSeq: number, changeSeq: number) =>
      msg(2, { change_seq: changeSeq, thread: { reply_count: lastThreadSeq, last_thread_seq: lastThreadSeq, last_reply_at: "2026-09-13T02:00:00Z" } });
    const followedRow = {
      room: { id: "r1", kind: "public" as const, name: "雑談" },
      root: { id: "m-2", sender: miyuki, kind: "user" as const, body: "本文 2", created_at: "2026-09-13T01:00:00Z", deleted: false },
      root_seq: 2,
      reply_count: 1,
      last_reply_at: "2026-09-13T01:30:00Z",
      last_thread_seq: 1,
      last_read_thread_seq: 1,
      unread_count: 0,
    };
    const threadRoutes: Record<string, Handler> = {
      "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [followedRow], next_cursor: null }),
      "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50": () =>
        json(200, {
          root: threadRoot(1, 4),
          messages: [msg(4, { change_seq: 3, thread_root_id: "m-2", thread_seq: 1 })],
          has_more: false,
          last_change_seq: 4,
          last_read_thread_seq: 1,
        }),
    };

    it("keeps replies out of the channel's read position while still advancing the sync cursor", async () => {
      const { store } = await opened();

      store.applyEvent(created(msg(4, { change_seq: 4, sender: miyuki, thread_root_id: "m-9", thread_seq: 1 })));

      const state = store.getSnapshot();
      expect(state.timelines.r1?.changeSeq).toBe(4);
      // チャンネルの未読・最後のメッセージは動かない
      expect(state.rooms.r1).toMatchObject({ last_message_seq: 3, unread_count: 0 });
    });

    it("adds replies to an open thread and advances my own read position when I reply", async () => {
      const { store } = await opened(threadRoutes);
      await store.loadThreads("ws-1");
      await store.openThread("r1", "m-2");

      store.applyEvent(created(msg(5, { change_seq: 5, sender: naoki, client_msg_id: "c-5", thread_root_id: "m-2", thread_seq: 2 })));
      store.applyEvent({ type: "message.updated", data: threadRoot(2, 6) });

      const state = store.getSnapshot();
      expect(state.threads["m-2"]?.replies.map((m) => m.seq)).toEqual([4, 5]);
      expect(state.threads["m-2"]?.lastReadThreadSeq).toBe(2);
      expect(state.threadLists["ws-1"]?.list[0]).toMatchObject({ last_thread_seq: 2, last_read_thread_seq: 2, unread_count: 0, reply_count: 2 });
    });

    it("sends a thread reply with thread_root_id on the room's send queue", async () => {
      const sent: unknown[] = [];
      const { store } = await opened({
        ...threadRoutes,
        "POST /api/v1/rooms/r1/messages": (_url, init) => {
          const req = body(init);
          sent.push(req);
          return json(201, msg(5, { change_seq: 5, sender: naoki, client_msg_id: req.client_msg_id, body: req.body, thread_root_id: "m-2", thread_seq: 2 }));
        },
      });
      await store.openThread("r1", "m-2");

      store.sendMessage("r1", { body: "返信", threadRootId: "m-2" });

      await vi.waitFor(() => expect(store.getSnapshot().outgoing.r1).toBeUndefined());
      expect(sent).toEqual([expect.objectContaining({ body: "返信", thread_root_id: "m-2" })]);
      expect(store.getSnapshot().threads["m-2"]?.replies.map((m) => m.body)).toEqual(["本文 4", "返信"]);
    });

    it("sends also_in_channel with the reply and shows it in the channel too (ADR 0039)", async () => {
      const sent: unknown[] = [];
      const { store } = await opened({
        ...threadRoutes,
        "POST /api/v1/rooms/r1/messages": (_url, init) => {
          const req = body(init);
          sent.push(req);
          return json(201, msg(5, {
            change_seq: 5, user_seq: 4, sender: naoki, client_msg_id: req.client_msg_id, body: req.body,
            thread_root_id: "m-2", thread_seq: 2, also_in_channel: req.also_in_channel,
          }));
        },
      });
      await store.openThread("r1", "m-2");

      store.sendMessage("r1", { body: "みんなにも", threadRootId: "m-2", alsoInChannel: true });

      await vi.waitFor(() => expect(store.getSnapshot().outgoing.r1).toBeUndefined());
      expect(sent).toEqual([expect.objectContaining({ thread_root_id: "m-2", also_in_channel: true })]);
      const state = store.getSnapshot();
      // 同じ 1 行が、スレッドにもチャンネルにも並ぶ
      expect(state.threads["m-2"]?.replies.map((m) => m.body)).toEqual(["本文 4", "みんなにも"]);
      expect(seqs(store)).toEqual([1, 2, 3, 5]);
      // 自分の発言なので、チャンネルの既読位置も進む（未読を作らない）
      expect(state.rooms.r1).toMatchObject({ last_message_seq: 5, unread_count: 0 });
    });

    it("never sends also_in_channel for a channel message (the server would answer 422)", async () => {
      const sent: unknown[] = [];
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": (_url, init) => {
          const req = body(init);
          sent.push(req);
          return json(201, msg(4, { change_seq: 4, sender: naoki, client_msg_id: req.client_msg_id, body: req.body }));
        },
      });

      store.sendMessage("r1", { body: "チャンネルへ", alsoInChannel: true });

      await vi.waitFor(() => expect(store.getSnapshot().outgoing.r1).toBeUndefined());
      expect(sent[0]).not.toHaveProperty("thread_root_id");
      expect(sent[0]).not.toHaveProperty("also_in_channel");
    });

    it("counts a broadcast reply from someone else as unread in the channel", async () => {
      const { store } = await opened();

      store.applyEvent(created(msg(4, {
        change_seq: 4, user_seq: 4, sender: miyuki, thread_root_id: "m-2", thread_seq: 1, also_in_channel: true,
      })));

      const state = store.getSnapshot();
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
      expect(state.rooms.r1).toMatchObject({ last_message_seq: 4, unread_count: 1 });
    });

    it("restores a broadcast reply sent while disconnected in both the channel and the thread", async () => {
      const broadcast = msg(5, {
        change_seq: 5, user_seq: 4, sender: miyuki, thread_root_id: "m-2", thread_seq: 2, also_in_channel: true,
      });
      const { store } = await opened({
        ...threadRoutes,
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () =>
          json(200, { messages: [broadcast], has_more: false, last_change_seq: 5 }),
      });
      await store.openThread("r1", "m-2");

      await store.syncTimeline("r1");

      const state = store.getSnapshot();
      expect(seqs(store)).toEqual([1, 2, 3, 5]);
      expect(state.threads["m-2"]?.replies.map((m) => m.seq)).toEqual([4, 5]);
      // 見ていない間に届いた分なので、「ここから未読」は同期の前の最新（3）の後ろに出す
      expect(state.timelines.r1?.unreadAfterSeq).toBe(3);
    });

    it("reloads the followed threads when the server says I followed one", async () => {
      const { store, requests } = await opened(threadRoutes);
      await store.loadThreads("ws-1");

      store.applyEvent({ type: "thread.followed", data: { workspace_id: "ws-1", room_id: "r1", thread_root_id: "m-2", last_read_thread_seq: 0 } });

      await vi.waitFor(() =>
        expect(requests().filter((p) => p === "GET /api/v1/workspaces/ws-1/threads?limit=200")).toHaveLength(2),
      );
    });

    it("forgets the threads of a room I was removed from", async () => {
      const { store } = await opened(threadRoutes);
      await store.loadThreads("ws-1");
      await store.openThread("r1", "m-2");

      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "removed" } });

      expect(store.getSnapshot().threadLists["ws-1"]?.list).toEqual([]);
      // public ルームは読めるので、スレッドは残して参加だけを外す
      expect(store.getSnapshot().threads["m-2"]?.lastReadThreadSeq).toBeNull();
    });
  });

  describe("typing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const typing = (user: typeof miyuki, threadRootId: string | null = null) => ({
      type: "typing.started" as const,
      data: { workspace_id: "ws-1", room_id: "r1", thread_root_id: threadRootId, user },
    });

    it("does not show typing in a thread as typing in the channel (ADR 0036)", () => {
      const { store } = setup({});

      store.applyEvent(typing(miyuki, "m-1"));

      expect(store.getSnapshot().typing.r1).toBeUndefined();
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

    it("drops a private room from the list at once, even the open one, and remembers it only while it stays open", async () => {
      const { store } = setup(privateRoomRoutes);
      await store.loadRooms("ws-1");
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(removed("r1"));
      store.applyEvent(removed("r2"));

      // 名前も見せないので、開いていても一覧に残さない（ADR 0035）
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual([]);
      expect(store.getSnapshot().removedRooms).toMatchObject({ r1: "removed", r2: "removed" });

      store.setFocus(null);
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

  describe("sending", () => {
    /** 応答を手で返す。 */
    function deferred() {
      let resolve!: (res: Response) => void;
      const promise = new Promise<Response>((r) => (resolve = r));
      return { promise, resolve };
    }

    const mine = (seq: number, clientMsgId: string, overrides: Parameters<typeof message>[1] = {}) =>
      msg(seq, { id: `m-${seq}`, sender: naoki, client_msg_id: clientMsgId, ...overrides });

    /** 送信の API。送られた本文の順と、応答（既定は client_msg_id ごとに 1 回だけ採番して 201 / 200）を持つ。 */
    function sendRoute() {
      const sent: { client_msg_id: string; body: string; reply_to_id?: string }[] = [];
      const byClientId = new Map<string, ReturnType<typeof message>>();
      let seq = 3;
      const handler: Handler = (_url, init) => {
        const req = body(init);
        sent.push(req);
        const existing = byClientId.get(req.client_msg_id);
        if (existing) return json(200, existing);
        const created = mine(++seq, req.client_msg_id, { body: req.body });
        byClientId.set(req.client_msg_id, created);
        return json(201, created);
      };
      return { sent, handler };
    }

    const outgoing = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().outgoing.r1 ?? [];

    it("shows the message at once with a ULID, then replaces it with the confirmed one", async () => {
      const route = sendRoute();
      const response = deferred();
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": async (url, init) => {
          await response.promise;
          return route.handler(url, init);
        },
      });

      store.sendMessage("r1", { body: "こんにちは" });

      expect(outgoing(store)).toMatchObject([{ body: "こんにちは", status: "pending" }]);
      const clientMsgId = outgoing(store)[0]!.clientMsgId;
      expect(clientMsgId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

      response.resolve(new Response());
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_message_seq: 4, last_read_seq: 4, last_user_seq: 4, last_read_user_seq: 4, unread_count: 0 });
      expect(route.sent).toEqual([{ client_msg_id: clientMsgId, body: "こんにちは" }]);
    });

    it("attaches uploaded files and keeps them when retrying", async () => {
      const route = sendRoute();
      let fail = true;
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": (url, init) => (fail ? problem(503, "internal") : route.handler(url, init)),
      });
      const pdf = {
        id: "a1",
        file_name: "scale.pdf",
        content_type: "application/pdf",
        size_bytes: 253_952,
        width: null,
        height: null,
      };

      store.sendMessage("r1", { body: "", attachments: [pdf] });
      expect(outgoing(store)).toMatchObject([{ body: "", attachments: [pdf], status: "pending" }]);
      await vi.waitFor(() => expect(outgoing(store)).toMatchObject([{ status: "failed", attachments: [pdf] }]));

      fail = false;
      store.retryMessage("r1", outgoing(store)[0]!.clientMsgId);
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));
      expect(route.sent).toEqual([expect.objectContaining({ body: "", attachment_ids: ["a1"] })]);
    });

    it("sends one message at a time, in the order they were written", async () => {
      const route = sendRoute();
      const responses = [deferred(), deferred()];
      let calls = 0;
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": async (url, init) => {
          await responses[calls++]!.promise;
          return route.handler(url, init);
        },
      });

      store.sendMessage("r1", { body: "1 通目" });
      store.sendMessage("r1", { body: "2 通目" });
      await vi.waitFor(() => expect(route.sent).toHaveLength(0));
      expect(calls).toBe(1);

      responses[0]!.resolve(new Response());
      await vi.waitFor(() => expect(calls).toBe(2));
      responses[1]!.resolve(new Response());
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));

      expect(route.sent.map((r) => r.body)).toEqual(["1 通目", "2 通目"]);
      expect(store.getSnapshot().timelines.r1?.messages.slice(-2).map((m) => [m.seq, m.body])).toEqual([
        [4, "1 通目"],
        [5, "2 通目"],
      ]);
    });

    it("fails the queued messages too, and a retry with the same client_msg_id does not post twice", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const route = sendRoute();
      let online = false;
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": (url, init) => {
          if (!online) {
            // 届いてコミットされたが、応答が切断で失われた
            route.handler(url, init);
            throw new TypeError("Failed to fetch");
          }
          return route.handler(url, init);
        },
      });

      store.sendMessage("r1", { body: "1 通目" });
      store.sendMessage("r1", { body: "2 通目" });
      await vi.waitFor(() => expect(outgoing(store).map((m) => m.status)).toEqual(["failed", "failed"]));
      // 1 通目で止まり、2 通目は送っていない
      expect(route.sent.map((r) => r.body)).toEqual(["1 通目"]);

      online = true;
      const [first, second] = outgoing(store);
      store.retryMessage("r1", first!.clientMsgId);
      store.retryMessage("r1", second!.clientMsgId);
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));

      expect(route.sent.map((r) => r.client_msg_id)).toEqual([first!.clientMsgId, first!.clientMsgId, second!.clientMsgId]);
      expect(seqs(store)).toEqual([1, 2, 3, 4, 5]);
    });

    it("drops the pending message when message.created arrives before the response, without a duplicate", async () => {
      const route = sendRoute();
      const response = deferred();
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": async (url, init) => {
          const res = route.handler(url, init);
          await response.promise;
          return res;
        },
      });

      store.sendMessage("r1", { body: "先にイベント" });
      await vi.waitFor(() => expect(route.sent).toHaveLength(1));
      store.applyEvent(created(mine(4, route.sent[0]!.client_msg_id, { body: "先にイベント" })));
      expect(outgoing(store)).toEqual([]);

      response.resolve(new Response());
      await vi.waitFor(() => expect(store.getSnapshot().timelines.r1?.messages).toHaveLength(4));
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
    });

    it("gives up waiting after the timeout, and still accepts a response that arrives later", async () => {
      const route = sendRoute();
      const response = deferred();
      const { store } = await opened(
        {
          "POST /api/v1/rooms/r1/messages": async (url, init) => {
            await response.promise;
            return route.handler(url, init);
          },
        },
        { sendTimeoutMs: 20 },
      );

      store.sendMessage("r1", { body: "遅い" });
      await vi.waitFor(() => expect(outgoing(store)[0]?.status).toBe("failed"));

      response.resolve(new Response());
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
    });

    it("forgets unsent messages when removed from a private room", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { kind: "private", last_message_seq: 3, last_read_seq: 3, last_user_seq: 3, last_read_user_seq: 3 })),
        "POST /api/v1/rooms/r1/messages": () => new Promise<Response>(() => {}),
      });
      store.sendMessage("r1", { body: "送信中" });

      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "removed" } });

      expect(store.getSnapshot().outgoing.r1).toBeUndefined();
    });

    it("applies an edit from the response", async () => {
      const { api, store } = await opened({
        "PATCH /api/v1/rooms/r1/messages/m-3": (_url, init) =>
          json(200, mine(3, "c-3", { body: body(init).body, change_seq: 4, edited_at: "2026-09-13T02:00:00Z" })),
      });

      await store.editMessage("r1", "m-3", "直しました");

      expect(store.getSnapshot().timelines.r1?.messages.at(-1)).toMatchObject({ body: "直しました", change_seq: 4 });
      expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(4);
      expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    });

    it("fetches the change after deleting, since the response has no body", async () => {
      const { store } = await opened({
        "DELETE /api/v1/rooms/r1/messages/m-2": () => new Response(null, { status: 204 }),
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () =>
          page([msg(2, { body: "", change_seq: 4, deleted_at: "2026-09-13T02:00:00Z" })], 4),
      });

      await store.deleteMessage("r1", "m-2");

      expect(store.getSnapshot().timelines.r1?.messages[1]).toMatchObject({ id: "m-2", deleted_at: "2026-09-13T02:00:00Z" });
    });

    it("throws the API error when an edit is rejected", async () => {
      const { store } = await opened({
        "PATCH /api/v1/rooms/r1/messages/m-3": () => problem(409, "message-deleted"),
      });

      await expect(store.editMessage("r1", "m-3", "x")).rejects.toMatchObject({ status: 409 });
    });
  });
});

describe("createChatStore rooms", () => {
  it("opens a dm and puts it in the list only once", async () => {
    const dm = room("r-dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, online: true } });
    const { store, api } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "POST /api/v1/workspaces/ws-1/rooms": () => json(200, dm),
    });
    await store.loadRooms("ws-1");

    await store.openDm("ws-1", miyuki.id);
    // 同じ相手をもう一度開いてもサーバーは同じルームを返す（dm_key の UNIQUE。ADR 0011）
    await store.openDm("ws-1", miyuki.id);

    expect(body(api.calls.at(-1)!.init)).toEqual({ kind: "dm", user_id: miyuki.id });
    // 並びは最後のメッセージが新しい順。まだ何も送っていない DM は後ろに入る
    expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1", "r-dm"]);
  });

  it("renames a room", async () => {
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "PATCH /api/v1/rooms/r1": (_url, init) => json(200, room("r1", JSON.parse(init.body as string).name)),
    });
    await store.loadRooms("ws-1");

    await store.updateRoom("r1", { name: "雑談 改" });

    expect(store.getSnapshot().rooms.r1?.name).toBe("雑談 改");
  });

  it("reloads the members and the room after adding someone, and drops the row after removing", async () => {
    let members = [roomMember(naoki, { role: "admin" })];
    const { store, requests } = setup({
      "GET /api/v1/rooms/r1": () => json(200, room("r1", "リリース準備", { kind: "private", member_count: members.length })),
      "GET /api/v1/rooms/r1/members?limit=200": () => json(200, { members, next_cursor: null }),
      "POST /api/v1/rooms/r1/members": () => new Response(null, { status: 204 }),
      [`DELETE /api/v1/rooms/r1/members/${miyuki.id}`]: () => new Response(null, { status: 204 }),
    });
    await store.loadRoomMembers("r1");
    members = [roomMember(naoki, { role: "admin" }), roomMember(miyuki)];

    await store.addRoomMember("r1", miyuki.id);
    expect(store.getSnapshot().roomMembers.r1?.members).toHaveLength(2);
    expect(requests()).toContain("POST /api/v1/rooms/r1/members");

    await store.removeRoomMember("r1", miyuki.id);
    expect(store.getSnapshot().roomMembers.r1?.members.map((m) => m.user.id)).toEqual([naoki.id]);
  });

  describe("leaveRoom", () => {
    function setupLeave(kind: "public" | "private") {
      return setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談", { kind }), room("r2", "設計")] }),
        [`DELETE /api/v1/rooms/r1/members/${naoki.id}`]: () => new Response(null, { status: 204 }),
      });
    }

    it("keeps a public room readable as a room I have not joined, without waiting for the event", async () => {
      const { store, requests } = setupLeave("public");
      await store.loadRooms("ws-1");

      await store.leaveRoom("r1");

      expect(requests()).toContain(`DELETE /api/v1/rooms/r1/members/${naoki.id}`);
      const state = store.getSnapshot();
      expect(state.rooms.r1).toMatchObject({ is_member: false, unread_count: 0 });
      expect(state.roomLists["ws-1"]?.ids).toContain("r1");
      expect(state.removedRooms.r1).toBeUndefined();
    });

    it("marks an open private room as left (not removed) so the screen goes back instead of showing a notice", async () => {
      const { store } = setupLeave("private");
      await store.loadRooms("ws-1");
      store.setFocus({ roomId: "r1", caughtUp: true });

      await store.leaveRoom("r1");
      // 同じ端末にもイベントが届く。2 回目の後始末で状態が変わらない
      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "left" } });

      expect(store.getSnapshot().removedRooms.r1).toBe("left");
      store.setFocus(null);
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r2"]);
    });

    it("leaves the room as it was when the server refuses", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談", { kind: "private" })] }),
        [`DELETE /api/v1/rooms/r1/members/${naoki.id}`]: () => problem(403, "forbidden"),
      });
      await store.loadRooms("ws-1");

      await expect(store.leaveRoom("r1")).rejects.toThrow();

      expect(store.getSnapshot().removedRooms.r1).toBeUndefined();
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1"]);
    });
  });
});

describe("createChatStore workspace admin", () => {
  const ws = workspace("ws-1", "山と印刷", { my_role: "owner" });
  const roster = [member(naoki, { role: "owner" }), member(miyuki, { role: "member" })];

  function setupAdmin(routes: Record<string, Handler> = {}) {
    return setup({
      "GET /api/v1/workspaces": () => json(200, { workspaces: [ws] }),
      "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: roster, next_cursor: null }),
      "GET /api/v1/workspaces/ws-1/invites?limit=200": () =>
        json(200, { invites: [invite("i-1"), invite("i-2", { status: "revoked" })], next_cursor: null }),
      ...routes,
    });
  }

  it("follows the cursor to load every member, and keeps the invites newest first", async () => {
    const { store, requests } = setupAdmin({
      "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: [roster[0]], next_cursor: naoki.id }),
      [`GET /api/v1/workspaces/ws-1/members?limit=200&after=${naoki.id}`]: () =>
        json(200, { members: [roster[1]], next_cursor: null }),
    });

    await Promise.all([store.loadMembers("ws-1"), store.loadMembers("ws-1"), store.loadInvites("ws-1")]);

    expect(store.getSnapshot().members["ws-1"]).toEqual({ status: "ready", list: roster });
    // 同じ取得は 2 本送らない（ページの 2 本目は別の URL）
    expect(requests().filter((p) => p.includes("/members")).length).toBe(2);
    expect(store.getSnapshot().invites["ws-1"]?.list.map((i) => i.id)).toEqual(["i-2", "i-1"]);
  });

  it("marks the member list as not_found when the workspace cannot be read", async () => {
    const { store } = setupAdmin({ "GET /api/v1/workspaces/ws-1/members?limit=200": () => problem(404, "not-found") });

    await store.loadMembers("ws-1");

    expect(store.getSnapshot().members["ws-1"]?.status).toBe("not_found");
  });

  it("changes a role and keeps my own role in the workspace list", async () => {
    const { store, api } = setupAdmin({
      [`PATCH /api/v1/workspaces/ws-1/members/${miyuki.id}`]: () => json(200, member(miyuki, { role: "admin" })),
      [`PATCH /api/v1/workspaces/ws-1/members/${naoki.id}`]: () => json(200, member(naoki, { role: "admin" })),
    });
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    await store.changeMemberRole("ws-1", miyuki.id, "admin");
    expect(body(api.calls.at(-1)!.init)).toEqual({ role: "admin" });
    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => m.role)).toEqual(["owner", "admin"]);
    expect(store.getSnapshot().workspaces.list[0].my_role).toBe("owner");

    await store.changeMemberRole("ws-1", naoki.id, "admin");
    expect(store.getSnapshot().workspaces.list[0].my_role).toBe("admin");
  });

  it("removes a kicked member from the list", async () => {
    const { store } = setupAdmin({ [`DELETE /api/v1/workspaces/ws-1/members/${miyuki.id}`]: () => new Response(null, { status: 204 }) });
    await store.loadMembers("ws-1");

    await store.removeMember("ws-1", miyuki.id);

    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => m.user.id)).toEqual([naoki.id]);
  });

  it("drops the workspace when I leave it myself", async () => {
    const { store } = setupAdmin({ [`DELETE /api/v1/workspaces/ws-1/members/${naoki.id}`]: () => new Response(null, { status: 204 }) });
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    await store.removeMember("ws-1", naoki.id);

    expect(store.getSnapshot().workspaces.list).toEqual([]);
    expect(store.getSnapshot().removedWorkspaces["ws-1"]?.reason).toBe("left");
  });

  it("swaps the roles locally when ownership is transferred (the response has no body)", async () => {
    const { store, api } = setupAdmin({
      "POST /api/v1/workspaces/ws-1/ownership-transfer": () => new Response(null, { status: 204 }),
    });
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    await store.transferOwnership("ws-1", miyuki.id);

    expect(body(api.calls.at(-1)!.init)).toEqual({ user_id: miyuki.id });
    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => [m.user.id, m.role])).toEqual([
      [naoki.id, "admin"],
      [miyuki.id, "owner"],
    ]);
    expect(store.getSnapshot().workspaces.list[0].my_role).toBe("admin");
  });

  it("returns the invite code once and never keeps it in the list", async () => {
    const created = { ...invite("i-3"), code: "7Qv2xkR8mA" };
    const { store, api } = setupAdmin({ "POST /api/v1/workspaces/ws-1/invites": () => json(201, created) });
    await store.loadInvites("ws-1");

    const result = await store.createInvite("ws-1", { maxUses: 10, expiresInSeconds: 604800 });

    expect(result.code).toBe("7Qv2xkR8mA");
    expect(body(api.calls.at(-1)!.init)).toEqual({ max_uses: 10, expires_in_seconds: 604800 });
    const list = store.getSnapshot().invites["ws-1"]!.list;
    expect(list.map((i) => i.id)).toEqual(["i-3", "i-2", "i-1"]);
    expect(list[0]).not.toHaveProperty("code");
  });

  it("marks a revoked invite without reloading the list", async () => {
    const { store, requests } = setupAdmin({
      "DELETE /api/v1/workspaces/ws-1/invites/i-1": () => new Response(null, { status: 204 }),
    });
    await store.loadInvites("ws-1");

    await store.revokeInvite("ws-1", "i-1");

    expect(store.getSnapshot().invites["ws-1"]?.list.find((i) => i.id === "i-1")?.status).toBe("revoked");
    expect(requests().filter((p) => p.includes("/invites")).length).toBe(2);
  });

  it("applies role changes, removals and presence from events", async () => {
    const { store } = setupAdmin();
    await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

    store.applyEvent({ type: "workspace.role_changed", data: { workspace_id: "ws-1", user_id: miyuki.id, role: "admin" } });
    store.applyEvent({ type: "presence.changed", data: { user_id: miyuki.id, online: true } });
    expect(store.getSnapshot().members["ws-1"]?.list[1]).toMatchObject({ role: "admin", online: true });

    store.applyEvent({
      type: "workspace.member_removed",
      data: { workspace_id: "ws-1", user_id: miyuki.id, reason: "removed" },
    });
    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => m.user.id)).toEqual([naoki.id]);
  });

  it("reloads the members when someone the list does not know joins a room", async () => {
    let listed = [roster[0]];
    const { store, requests } = setupAdmin({
      "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: listed, next_cursor: null }),
    });
    const loads = () => requests().filter((p) => p.includes("/members")).length;
    await store.loadMembers("ws-1");
    listed = roster;

    store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r-1", user: miyuki } });
    await vi.waitFor(() => expect(store.getSnapshot().members["ws-1"]?.list).toHaveLength(2));
    expect(loads()).toBe(2);

    // すでに一覧にいる人が別のルームに参加しただけなら、取り直さない
    store.applyEvent({ type: "member.joined", data: { workspace_id: "ws-1", room_id: "r-2", user: miyuki } });
    await vi.waitFor(() => expect(loads()).toBe(2));
  });
});
