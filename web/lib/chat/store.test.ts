import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/auth/session";
import { invite, member, message, miyuki, naoki, room, roomMember, savedItem, workspace } from "@/test/chat-data";
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

  describe("ピン留め（ADR 0054）", () => {
    const pin = { by: { id: miyuki.id, handle: "miyuki", display_name: "高橋 みゆき" }, at: "2026-09-22T01:00:00Z" };
    const pinsOf = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().pins.r1?.messages.map((m) => m.id);

    it("loads the pins once and keeps them in order as message.updated arrives", async () => {
      const { store, requests } = await opened({
        "GET /api/v1/rooms/r1/pins": () => json(200, { messages: [msg(1, { pinned: pin })] }),
      });
      await Promise.all([store.loadPins("r1"), store.loadPins("r1")]);
      expect(requests().filter((r) => r.endsWith("/pins"))).toHaveLength(1);

      // 後からピン留めしたものは先頭（ピン留めした新しい順）
      store.applyEvent({ type: "message.updated", data: msg(3, { change_seq: 4, pinned: { ...pin, at: "2026-09-22T02:00:00Z" } }) });
      expect(pinsOf(store)).toEqual(["m-3", "m-1"]);

      // 外れたら除く
      store.applyEvent({ type: "message.updated", data: msg(1, { change_seq: 5, pinned: null }) });
      expect(pinsOf(store)).toEqual(["m-3"]);

      // 削除するとピンも外れる（tombstone の pinned は null）
      store.applyEvent({ type: "message.deleted", data: msg(3, { change_seq: 6, body: "", deleted_at: "2026-09-22T03:00:00Z" }) });
      expect(pinsOf(store)).toEqual([]);
    });

    it("does not go back to an older state of a pinned message", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/pins": () => json(200, { messages: [msg(1, { change_seq: 5, pinned: pin })] }),
      });
      await store.loadPins("r1");

      store.applyEvent({ type: "message.updated", data: msg(1, { change_seq: 4, pinned: null }) });

      expect(pinsOf(store)).toEqual(["m-1"]);
    });

    it("applies pins found in the sync diff", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/pins": () => json(200, { messages: [] }),
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () => page([msg(2, { change_seq: 4, pinned: pin })], 4),
      });
      await store.loadPins("r1");

      await store.syncTimeline("r1");

      expect(pinsOf(store)).toEqual(["m-2"]);
    });

    it("pins with PUT and unpins with DELETE, settling on the response", async () => {
      const { store, requests } = await opened({
        "GET /api/v1/rooms/r1/pins": () => json(200, { messages: [] }),
        "PUT /api/v1/rooms/r1/messages/m-2/pin": () => json(200, msg(2, { change_seq: 4, pinned: pin })),
        "DELETE /api/v1/rooms/r1/messages/m-2/pin": () => json(200, msg(2, { change_seq: 6, pinned: null })),
      });
      await store.loadPins("r1");

      await store.togglePin("r1", "m-2");
      expect(store.getSnapshot().timelines.r1?.messages[1]?.pinned).toEqual(pin);
      expect(pinsOf(store)).toEqual(["m-2"]);

      await store.togglePin("r1", "m-2");
      expect(store.getSnapshot().timelines.r1?.messages[1]?.pinned).toBeNull();
      expect(pinsOf(store)).toEqual([]);
      expect(requests()).toEqual(expect.arrayContaining(["PUT /api/v1/rooms/r1/messages/m-2/pin", "DELETE /api/v1/rooms/r1/messages/m-2/pin"]));
    });
  });

  describe("「後で」（ADR 0054）", () => {
    const inRoom = (seq: number, overrides: Parameters<typeof savedItem>[1] = {}) =>
      savedItem(seq, { room_id: "r1", message: msg(seq, { saved: true }), ...overrides });
    const savedList = (items: ReturnType<typeof savedItem>[], lastChangeSeq: number, count = items.length, hasMore = false) =>
      json(200, { items, in_progress_count: count, last_change_seq: lastChangeSeq, has_more: hasMore });
    const inProgress = "GET /api/v1/workspaces/ws-1/saved?state=in_progress&limit=50";
    const savedOf = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().saved["ws-1"];
    const tabIds = (store: ReturnType<typeof setup>["store"], tab: "in_progress" | "archived") =>
      savedOf(store)?.tabs[tab]?.items.map((i) => i.message_id);
    const flag = (store: ReturnType<typeof setup>["store"], seq: number) =>
      store.getSnapshot().timelines.r1?.messages.find((m) => m.seq === seq)?.saved;

    it("takes the cursor and the count from the first page of 進行中", async () => {
      const { store } = await opened({ [inProgress]: () => savedList([inRoom(2)], 4, 3) });

      await store.loadSaved("ws-1", "in_progress");

      expect(savedOf(store)).toMatchObject({ cursor: 4, inProgressCount: 3 });
      expect(tabIds(store, "in_progress")).toEqual(["m-2"]);
    });

    it("applies saved.updated in order: moves the item, fixes the count and the flag, and advances the cursor", async () => {
      const { store } = await opened({ [inProgress]: () => savedList([inRoom(2)], 4) });
      await store.loadSaved("ws-1", "in_progress");

      store.applyEvent({ type: "saved.updated", data: inRoom(2, { state: "archived", change_seq: 5 }) });

      expect(tabIds(store, "in_progress")).toEqual([]);
      expect(savedOf(store)).toMatchObject({ cursor: 5, inProgressCount: 0 });

      store.applyEvent({ type: "saved.updated", data: inRoom(3, { change_seq: 6, id: "s-900" }) });
      expect(tabIds(store, "in_progress")).toEqual(["m-3"]);
      expect(flag(store, 3)).toBe(true);

      // 反映済みの番号は捨てる
      store.applyEvent({ type: "saved.updated", data: inRoom(3, { state: "removed", change_seq: 6 }) });
      expect(tabIds(store, "in_progress")).toEqual(["m-3"]);
    });

    it("fetches the diff when saved.updated skips a number", async () => {
      const { store, requests } = await opened({
        [inProgress]: () => savedList([inRoom(2)], 4),
        "GET /api/v1/workspaces/ws-1/saved?after_change_seq=4&limit=100": () =>
          savedList([inRoom(2, { state: "removed", change_seq: 5, status: "unavailable", room: null, message: null }), inRoom(3, { change_seq: 7, id: "s-900" })], 7),
      });
      await store.loadSaved("ws-1", "in_progress");

      store.applyEvent({ type: "saved.updated", data: inRoom(3, { change_seq: 7, id: "s-900" }) });
      await vi.waitFor(() => expect(savedOf(store)?.cursor).toBe(7));

      expect(requests()).toContain("GET /api/v1/workspaces/ws-1/saved?after_change_seq=4&limit=100");
      expect(tabIds(store, "in_progress")).toEqual(["m-3"]);
      expect(flag(store, 2)).toBe(false);
    });

    it("catches up with the diff after reconnecting (syncSaved)", async () => {
      const { store } = await opened({
        [inProgress]: () => savedList([inRoom(2)], 4),
        "GET /api/v1/workspaces/ws-1/saved?after_change_seq=4&limit=100": () =>
          savedList([inRoom(2, { state: "archived", change_seq: 5 })], 5),
      });
      await store.loadSaved("ws-1", "in_progress");

      await store.syncSaved("ws-1");

      expect(tabIds(store, "in_progress")).toEqual([]);
      expect(savedOf(store)?.cursor).toBe(5);
    });

    it("toggles the flag before the server answers and puts it back on failure", async () => {
      let fail = false;
      const { store } = await opened({
        [inProgress]: () => savedList([], 0),
        "PUT /api/v1/rooms/r1/messages/m-2/saved": () =>
          fail ? problem(500, "internal") : json(200, inRoom(2, { change_seq: 1 })),
      });
      await store.loadSaved("ws-1", "in_progress");

      const done = store.toggleSaved("ws-1", "r1", "m-2");
      expect(flag(store, 2)).toBe(true);
      await done;
      expect(savedOf(store)).toMatchObject({ cursor: 1 });
      expect(tabIds(store, "in_progress")).toEqual(["m-2"]);

      fail = true;
      await expect(store.toggleSaved("ws-1", "r1", "m-3")).rejects.toThrow();
      expect(flag(store, 3)).toBe(false);
    });

    it("removes from the list at once and sends DELETE", async () => {
      const { store, requests } = await opened({
        [inProgress]: () => savedList([inRoom(2)], 4),
        "DELETE /api/v1/workspaces/ws-1/saved/m-2": () => new Response(null, { status: 204 }),
      });
      await store.loadSaved("ws-1", "in_progress");

      await store.removeSaved("ws-1", "m-2");

      expect(tabIds(store, "in_progress")).toEqual([]);
      expect(savedOf(store)?.inProgressCount).toBe(0);
      expect(requests()).toContain("DELETE /api/v1/workspaces/ws-1/saved/m-2");
    });

    it("moves between tabs at once and settles on the response", async () => {
      const { store } = await opened({
        [inProgress]: () => savedList([inRoom(2)], 4),
        "GET /api/v1/workspaces/ws-1/saved?state=archived&limit=50": () => savedList([], 4, 1),
        "PATCH /api/v1/workspaces/ws-1/saved/m-2": () => json(200, inRoom(2, { state: "archived", change_seq: 5 })),
      });
      await store.loadSaved("ws-1", "in_progress");
      await store.loadSaved("ws-1", "archived");

      const done = store.moveSaved("ws-1", "m-2", "archived");
      expect(tabIds(store, "archived")).toEqual(["m-2"]);
      await done;

      expect(savedOf(store)).toMatchObject({ cursor: 5, inProgressCount: 0 });
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

  describe("指定したメッセージへ飛ぶ（ADR 0042）", () => {
    /** around のページ。前後を返し、両側にまだあるかを伝える。 */
    function around(messages: ReturnType<typeof message>[], lastChangeSeq: number, seq: number) {
      return json(200, {
        messages,
        has_more: true,
        has_more_after: true,
        around: { seq, thread_root_id: null },
        last_change_seq: lastChangeSeq,
      });
    }

    it("前後のページで窓を置き換え、どちら側にまだあるかを覚える", async () => {
      const { store, requests } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () => around([msg(6), msg(7), msg(8)], 20, 7),
      });

      const result = await store.jumpToMessage("r1", "m-7");

      expect(result).toEqual({ found: true, threadRootId: null });
      expect(seqs(store)).toEqual([6, 7, 8]);
      const timeline = store.getSnapshot().timelines.r1!;
      expect(timeline).toMatchObject({ hasOlder: true, hasNewer: true, changeSeq: 20 });
      // 開く処理より後に飛ぶ（どちらも同じ窓を置き換えるので、競争させない）
      expect(requests().at(-1)).toBe("GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7");
    });

    it("見つからなければ最新のページのままで、見つからなかったことだけを返す", async () => {
      // ない・読めない・削除済みを区別しない（ADR 0040 と同じ方針）ので、サーバーは最新のページを around: null で返す
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-99": () =>
          json(200, { messages: [msg(1), msg(2), msg(3)], has_more: false, has_more_after: false, around: null, last_change_seq: 3 }),
      });

      expect(await store.jumpToMessage("r1", "m-99")).toEqual({ found: false, threadRootId: null });
      expect(store.getSnapshot().timelines.r1).toMatchObject({ hasNewer: false });
    });

    it("スレッドの返信を指していれば、その親を返す（呼ぶ側がパネルを開く）", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () =>
          json(200, {
            messages: [msg(7, { thread_root_id: "m-2", thread_seq: 1 })],
            has_more: true,
            has_more_after: false,
            around: { seq: 7, thread_root_id: "m-2" },
            last_change_seq: 20,
          }),
        "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50": () =>
          json(200, { root: msg(2), messages: [], has_more: false, has_more_after: false, around: null, last_change_seq: 20, last_read_thread_seq: 0 }),
      });

      expect(await store.jumpToMessage("r1", "m-7")).toEqual({ found: true, threadRootId: "m-2" });
    });

    it("飛んだ先にいる間は、届いたメッセージを末尾に足さない（つながらないため）", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () => around([msg(6), msg(7), msg(8)], 20, 7),
      });
      await store.jumpToMessage("r1", "m-7");

      store.applyEvent(created(msg(30, { change_seq: 21 })));

      expect(seqs(store)).toEqual([6, 7, 8]);
      // 番号が続いているので、反映したことにしてカーソルだけ進める（差分を取り直さない）
      expect(store.getSnapshot().timelines.r1).toMatchObject({ changeSeq: 21 });
      // ルームの一覧（サイドバー）は、窓の外の発言でも動く
      expect(store.getSnapshot().rooms.r1?.last_message_seq).toBe(30);
    });

    it("新しい方へ読み足して最新につながると、また末尾に並ぶ", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1/messages?limit=50&around_message_id=m-7": () => around([msg(6), msg(7), msg(8)], 20, 7),
        "GET /api/v1/rooms/r1/messages?limit=50&after_seq=8": () =>
          json(200, { messages: [msg(9), msg(10)], has_more: false, has_more_after: false, around: null, last_change_seq: 20 }),
        "GET /api/v1/rooms/r1/messages?after_change_seq=20&limit=100": () =>
          json(200, { messages: [], has_more: false, last_change_seq: 20 }),
      });
      await store.jumpToMessage("r1", "m-7");

      await store.loadNewer("r1");

      expect(seqs(store)).toEqual([6, 7, 8, 9, 10]);
      expect(store.getSnapshot().timelines.r1).toMatchObject({ hasNewer: false, loadingNewer: false });

      store.applyEvent(created(msg(11, { change_seq: 21 })));
      expect(seqs(store)).toEqual([6, 7, 8, 9, 10, 11]);
    });

    it("スレッドのパネルでも、指定した返信の前後で置き換える", async () => {
      const reply = (seq: number) => msg(seq, { thread_root_id: "m-2", thread_seq: seq, change_seq: seq });
      const { store } = await opened({
        "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50": () =>
          json(200, { root: msg(2), messages: [reply(20)], has_more: true, has_more_after: false, around: null, last_change_seq: 20, last_read_thread_seq: 0 }),
        "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50&around_message_id=m-11": () =>
          json(200, {
            root: msg(2),
            messages: [reply(10), reply(11), reply(12)],
            has_more: true,
            has_more_after: true,
            around: { seq: 11, thread_root_id: "m-2" },
            last_change_seq: 20,
            last_read_thread_seq: 0,
          }),
      });

      expect(await store.jumpToThreadMessage("r1", "m-2", "m-11")).toEqual({ found: true });

      const thread = store.getSnapshot().threads["m-2"]!;
      expect(thread.replies.map((m) => m.seq)).toEqual([10, 11, 12]);
      expect(thread).toMatchObject({ hasOlder: true, hasNewer: true });
    });

    it("最初の未読から読み直す（after_seq = 開いた時点の既読位置）", async () => {
      const { store } = setup({
        "GET /api/v1/rooms/r1": () =>
          json(200, room("r1", "雑談", { last_message_seq: 40, last_read_seq: 4, last_user_seq: 40, last_read_user_seq: 4, unread_count: 36 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(38), msg(39), msg(40)], 40, true),
        "GET /api/v1/rooms/r1/messages?limit=50&after_seq=4": () =>
          json(200, { messages: [msg(5), msg(6)], has_more: true, has_more_after: false, around: null, last_change_seq: 40 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 40, last_read_user_seq: 40, unread_count: 0 }),
      });
      await store.openRoom("r1");
      // 未読の数は開いた時点で覚える（開くとすぐ既読にするので、ルームの unread_count は 0 になる）
      expect(store.getSnapshot().timelines.r1).toMatchObject({ unreadAtOpen: 36, unreadAfterSeq: 4 });

      await store.jumpToUnread("r1");

      expect(seqs(store)).toEqual([5, 6]);
      // 古い方は飛ばしてきたので開いたまま、新しい方も読み切っていない
      expect(store.getSnapshot().timelines.r1).toMatchObject({ hasOlder: true, hasNewer: true });
    });
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
          json(200, { rooms: [room("dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, presence: "offline" } })] }),
        "GET /api/v1/rooms/r1/members?limit=200": () =>
          json(200, { members: [roomMember(miyuki), roomMember(naoki, { presence: "active" })], next_cursor: null }),
      });
      await store.loadRooms("ws-1");
      await store.loadRoomMembers("r1");
      const untouched = store.getSnapshot().roomMembers.r1!.members[1];

      store.applyEvent({ type: "presence.changed", data: { user_id: miyuki.id, presence: "active" } });

      const state = store.getSnapshot();
      expect(state.rooms.dm?.dm_peer?.presence).toBe("active");
      expect(state.roomMembers.r1?.members[0].presence).toBe("active");
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

      store.applyEvent({ type: "room.updated", data: { workspace_id: "ws-1", room_id: "r1", name: "雑談 改", is_default: true, archived_at: null } });
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
    const dm = room("r-dm", "", { kind: "dm", name: null, dm_peer: { ...miyuki, presence: "active" } });
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

  describe("アーカイブと削除（ADR 0059）", () => {
    const archivedAt = "2026-09-23T01:00:00Z";

    it("アーカイブ・復元の応答でルームを置き換える", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案")] }),
        "POST /api/v1/rooms/r1/archive": () => json(200, room("r1", "旧案", { archived_at: archivedAt })),
        "POST /api/v1/rooms/r1/unarchive": () => json(200, room("r1", "旧案")),
      });
      await store.loadRooms("ws-1");

      await store.archiveRoom("r1");
      expect(store.getSnapshot().rooms.r1?.archived_at).toBe(archivedAt);
      // 一覧からは外さない（サイドバーの検索で探せるように。出し分けは Sidebar）
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r1"]);

      await store.unarchiveRoom("r1");
      expect(store.getSnapshot().rooms.r1?.archived_at).toBeNull();
    });

    it("ほかの端末のアーカイブは room.updated の archived_at で届く", async () => {
      const { store } = setup({ "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案")] }) });
      await store.loadRooms("ws-1");

      store.applyEvent({
        type: "room.updated",
        data: { workspace_id: "ws-1", room_id: "r1", name: "旧案", is_default: false, archived_at: archivedAt },
      });
      expect(store.getSnapshot().rooms.r1?.archived_at).toBe(archivedAt);
    });

    it("room.deleted で、公開ルームでも一覧と中身を捨て、開いている画面は「アクセスできません」にする", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案"), room("r2", "設計")] }),
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "旧案")),
        "GET /api/v1/rooms/r1/messages?limit=50": () => json(200, { messages: [message(1, { room_id: "r1" })], has_more: false, last_change_seq: 1 }),
      });
      await store.loadRooms("ws-1");
      await store.openRoom("r1");

      store.applyEvent({ type: "room.deleted", data: { workspace_id: "ws-1", room_id: "r1" } });

      const state = store.getSnapshot();
      expect(state.roomLists["ws-1"]?.ids).toEqual(["r2"]);
      expect(state.timelines.r1).toBeUndefined();
      expect(state.removedRooms.r1).toBe("removed");
    });

    it("自分で削除したら left にして、あとから自分宛ての room.deleted が届いても変えない", async () => {
      const { store, requests } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案"), room("r2", "設計")] }),
        "DELETE /api/v1/rooms/r1": () => new Response(null, { status: 204 }),
      });
      await store.loadRooms("ws-1");

      await store.deleteRoom("r1");
      store.applyEvent({ type: "room.deleted", data: { workspace_id: "ws-1", room_id: "r1" } });

      expect(requests()).toContain("DELETE /api/v1/rooms/r1");
      expect(store.getSnapshot().removedRooms.r1).toBe("left");
      expect(store.getSnapshot().roomLists["ws-1"]?.ids).toEqual(["r2"]);
    });

    it("削除を断られたら、何も変えない", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "旧案")] }),
        "DELETE /api/v1/rooms/r1": () => problem(403, "forbidden"),
      });
      await store.loadRooms("ws-1");

      await expect(store.deleteRoom("r1")).rejects.toThrow();
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
    store.applyEvent({ type: "presence.changed", data: { user_id: miyuki.id, presence: "active" } });
    expect(store.getSnapshot().members["ws-1"]?.list[1]).toMatchObject({ role: "admin", presence: "active" });

    store.applyEvent({
      type: "workspace.member_removed",
      data: { workspace_id: "ws-1", user_id: miyuki.id, reason: "removed" },
    });
    expect(store.getSnapshot().members["ws-1"]?.list.map((m) => m.user.id)).toEqual([naoki.id]);
  });

  // 離席とカスタムステータス（ADR 0049）
  describe("本人が選んだ設定", () => {
    it("member.status_changed を、そのワークスペースのメンバーの行に当てる", async () => {
      const { store } = setupAdmin();
      await Promise.all([store.loadWorkspaces(), store.loadMembers("ws-1")]);

      store.applyEvent({
        type: "member.status_changed",
        data: {
          workspace_id: "ws-1",
          user_id: miyuki.id,
          away: true,
          status: { emoji: "🍵", text: "休憩中", expires_at: null },
        },
      });

      expect(store.getSnapshot().members["ws-1"]?.list[1]).toMatchObject({
        away: true,
        status: { emoji: "🍵", text: "休憩中" },
      });
    });

    it("別のワークスペースには away だけを当てる（ステータスはワークスペースごと）", async () => {
      const { store } = setup({
        "GET /api/v1/workspaces": () => json(200, { workspaces: [ws] }),
        "GET /api/v1/workspaces/ws-1/members?limit=200": () => json(200, { members: roster, next_cursor: null }),
        "GET /api/v1/workspaces/ws-2/members?limit=200": () => json(200, { members: roster, next_cursor: null }),
      });
      await Promise.all([store.loadMembers("ws-1"), store.loadMembers("ws-2")]);

      store.applyEvent({
        type: "member.status_changed",
        data: { workspace_id: "ws-1", user_id: miyuki.id, away: true, status: { emoji: "🍵", text: "", expires_at: null } },
      });

      const state = store.getSnapshot();
      expect(state.members["ws-1"]?.list[1]).toMatchObject({ away: true, status: { emoji: "🍵" } });
      // away はユーザーごとなので当たるが、ステータスは当たらない
      expect(state.members["ws-2"]?.list[1]).toMatchObject({ away: true, status: null });
    });

    it("自分で離席にすると手元で先に反映し、失敗したら戻す", async () => {
      let fail = false;
      const { store } = setupAdmin({
        "PUT /api/v1/users/me/presence": () => (fail ? json(500, {}) : json(200, { away: true })),
      });
      await store.loadMembers("ws-1");

      await store.setAway(true);
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ away: true });

      fail = true;
      await expect(store.setAway(false)).rejects.toThrow();
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ away: true });
    });

    it("ステータスの設定と解除も手元で先に反映する", async () => {
      const { store } = setupAdmin({
        "PUT /api/v1/workspaces/ws-1/me/status": () => json(200, { emoji: "🍵", text: "休憩中", expires_at: null }),
        "DELETE /api/v1/workspaces/ws-1/me/status": () => json(204, undefined),
      });
      await store.loadMembers("ws-1");

      await store.setStatus("ws-1", { emoji: "🍵", text: "休憩中", expires_at: null });
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ status: { emoji: "🍵", text: "休憩中" } });

      await store.setStatus("ws-1", null);
      expect(store.getSnapshot().members["ws-1"]?.list[0]).toMatchObject({ status: null });
    });
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
  // 絵文字のリアクション（ADR 0044）。
  describe("toggleReaction", () => {
    // room_id は開いているルームに合わせる（receiveMessage はメッセージ自身の room_id で振り分ける）
    const reacted = (me: boolean | undefined, count: number, users: string[], changeSeq = 2) =>
      message(1, {
        room_id: "r1",
        change_seq: changeSeq,
        reactions: [{ emoji: "👍", count, ...(me === undefined ? {} : { me }), users }],
      });

    function reactionSetup(routes: Record<string, Handler>) {
      return setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 1, last_read_seq: 1, last_user_seq: 1, last_read_user_seq: 1 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [message(1)], has_more: false, last_change_seq: 1 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 1, last_read_user_seq: 1, unread_count: 0 }),
        ...routes,
      });
    }

    const reactionsOf = (store: ReturnType<typeof setup>["store"]) =>
      store.getSnapshot().timelines.r1?.messages[0]?.reactions;

    it("shows the reaction before the server answers, then settles on the response", async () => {
      let resolve = () => {};
      const pending = new Promise<void>((r) => (resolve = r));
      const { store, requests } = reactionSetup({
        "PUT /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D": async () => {
          await pending;
          // サーバーは自分を含めた集計を返す（別の人がその間に押していた）
          return json(200, reacted(true, 2, [naoki.id, miyuki.id]));
        },
      });
      await store.openRoom("r1");

      const done = store.toggleReaction("r1", "m-1", "👍");
      // 応答を待たずに手元で反映されている（ADR 0044 決定 8）
      expect(reactionsOf(store)).toEqual([{ emoji: "👍", count: 1, me: true, users: [naoki.id] }]);

      resolve();
      await done;

      expect(reactionsOf(store)).toEqual([{ emoji: "👍", count: 2, me: true, users: [naoki.id, miyuki.id] }]);
      expect(requests()).toContain("PUT /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D");
    });

    it("removes it with DELETE when it is already mine", async () => {
      const { store, requests } = reactionSetup({
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [reacted(true, 1, [naoki.id], 1)], has_more: false, last_change_seq: 1 }),
        "DELETE /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D": () =>
          json(200, message(1, { room_id: "r1", change_seq: 2 })),
      });
      await store.openRoom("r1");

      await store.toggleReaction("r1", "m-1", "👍");

      expect(reactionsOf(store)).toEqual([]);
      expect(requests()).toContain("DELETE /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D");
    });

    it("puts it back when the request fails", async () => {
      const { store } = reactionSetup({
        "PUT /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D": () => problem(422, "validation-error"),
      });
      await store.openRoom("r1");

      await expect(store.toggleReaction("r1", "m-1", "👍")).rejects.toThrow();

      expect(reactionsOf(store)).toEqual([]);
    });

    it("keeps my own me when an update arrives without it (ADR 0044)", async () => {
      const { store } = reactionSetup({
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [reacted(true, 1, [naoki.id], 1)], has_more: false, last_change_seq: 1 }),
      });
      await store.openRoom("r1");

      // 配信には me が載らない（受け取る人ごとの値を入れられない）
      store.applyEvent({
        type: "message.updated",
        data: reacted(undefined, 2, [naoki.id, miyuki.id]),
      });

      expect(reactionsOf(store)).toEqual([{ emoji: "👍", count: 2, me: true, users: [naoki.id, miyuki.id] }]);
    });
  });
  // 添付ファイルだけの削除（ADR 0045）。
  describe("deleteAttachment", () => {
    const image = { id: "a-1", file_name: "01.png", content_type: "image/png", size_bytes: 12, width: 100, height: 80 };
    const file = { id: "a-2", file_name: "b.pdf", content_type: "application/pdf", size_bytes: 34, width: null, height: null };
    const withAttachments = (attachments: unknown[], overrides = {}) =>
      message(1, { room_id: "r1", attachments: attachments as never, ...overrides });

    function attachmentSetup(routes: Record<string, Handler>, attachments: unknown[] = [image, file]) {
      return setup({
        "GET /api/v1/rooms/r1": () =>
          json(200, room("r1", "雑談", { last_message_seq: 1, last_read_seq: 1, last_user_seq: 1, last_read_user_seq: 1 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [withAttachments(attachments)], has_more: false, last_change_seq: 1 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 1, last_read_user_seq: 1, unread_count: 0 }),
        ...routes,
      });
    }

    const messageOf = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().timelines.r1?.messages[0];

    it("waits for the response instead of removing it up front (ADR 0045)", async () => {
      let resolve = () => {};
      const pending = new Promise<void>((r) => (resolve = r));
      const { store, requests } = attachmentSetup({
        "DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1": async () => {
          await pending;
          return json(200, withAttachments([file], { change_seq: 2 }));
        },
      });
      await store.openRoom("r1");

      const done = store.deleteAttachment("r1", "m-1", "a-1");
      // 取り消せない操作なので楽観的更新はしない（「消えたのに戻ってきた」を起こさない）
      expect(messageOf(store)?.attachments).toHaveLength(2);

      resolve();
      await done;

      expect(messageOf(store)?.attachments.map((a) => a.id)).toEqual(["a-2"]);
      expect(messageOf(store)?.change_seq).toBe(2);
      expect(requests()).toContain("DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1");
    });

    it("turns the message into a tombstone when the response says it is gone (ADR 0045 決定 8)", async () => {
      const { store } = attachmentSetup(
        {
          "DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1": () =>
            json(200, withAttachments([], { change_seq: 2, body: "", deleted_at: "2026-09-20T01:00:00Z" })),
        },
        [image],
      );
      await store.openRoom("r1");

      await store.deleteAttachment("r1", "m-1", "a-1");

      expect(messageOf(store)?.deleted_at).not.toBeNull();
      expect(messageOf(store)?.attachments).toEqual([]);
    });

    it("removes it on everyone's screen through message.updated (ADR 0045 決定 7)", async () => {
      const { store } = attachmentSetup({});
      await store.openRoom("r1");

      // ほかの人が消した。専用のイベントは作らず、添付の減ったメッセージが message.updated で届く
      store.applyEvent({ type: "message.updated", data: withAttachments([file], { change_seq: 2 }) as never });

      expect(messageOf(store)?.attachments.map((a) => a.id)).toEqual(["a-2"]);
    });

    it("catches up on a delete that happened while disconnected (after_change_seq)", async () => {
      const { store } = attachmentSetup({
        "GET /api/v1/rooms/r1/messages?after_change_seq=1&limit=100": () =>
          json(200, { messages: [withAttachments([file], { change_seq: 2 })], has_more: false, last_change_seq: 2 }),
      });
      await store.openRoom("r1");

      await store.syncTimeline("r1");

      expect(messageOf(store)?.attachments.map((a) => a.id)).toEqual(["a-2"]);
    });

    it("keeps the attachment when the request fails", async () => {
      const { store } = attachmentSetup({
        "DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1": () => problem(403, "forbidden"),
      });
      await store.openRoom("r1");

      await expect(store.deleteAttachment("r1", "m-1", "a-1")).rejects.toThrow();

      expect(messageOf(store)?.attachments).toHaveLength(2);
    });
  });
});

describe("ミュートと通知の設定（ADR 0055）", () => {
  const T0 = Date.parse("2026-09-22T09:00:00Z");
  const notifications = (overrides = {}) => ({ level: null, muted: false, muted_until: null, ...overrides });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("room.notifications_updated を、ルームの本体に当てる（別のタブで変えた）", async () => {
    const { store } = setup({ "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }) });
    await store.loadRooms("ws-1");

    store.applyEvent({
      type: "room.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", level: "all", muted: true, muted_until: null },
    });

    expect(store.getSnapshot().rooms.r1?.notifications).toEqual({ level: "all", muted: true, muted_until: null });
  });

  it("notifications.updated で、そのワークスペースの全体の設定を置き換える", () => {
    const { store } = setup({});

    store.applyEvent({ type: "notifications.updated", data: { workspace_id: "ws-1", level: "none" } });

    expect(store.getSnapshot().notificationLevels["ws-1"]).toBe("none");
  });

  it("ルームの設定は全部の値で PUT し、応答で上書きする", async () => {
    let sent: unknown;
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "PUT /api/v1/rooms/r1/me/notifications": (_url, init) => {
        sent = body(init);
        return json(200, { level: "mentions", muted: true, muted_until: null });
      },
    });
    await store.loadRooms("ws-1");

    await store.setRoomNotifications("r1", notifications({ level: "mentions", muted: true }));

    expect(sent).toEqual({ level: "mentions", muted: true, muted_until: null });
    expect(store.getSnapshot().rooms.r1?.notifications).toEqual({ level: "mentions", muted: true, muted_until: null });
  });

  it("失敗したら元に戻して投げる", async () => {
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "PUT /api/v1/rooms/r1/me/notifications": () => problem(403, "forbidden"),
      "PUT /api/v1/workspaces/ws-1/me/notifications": () => problem(500, "internal"),
    });
    await store.loadRooms("ws-1");

    await expect(store.setRoomNotifications("r1", notifications({ muted: true }))).rejects.toThrow();
    await expect(store.setNotificationLevel("ws-1", "all")).rejects.toThrow();

    expect(store.getSnapshot().rooms.r1?.notifications).toEqual(notifications());
    expect(store.getSnapshot().notificationLevels["ws-1"]).toBeUndefined();
  });

  it("一時的なミュートは、期限が来たら再読み込みなしで戻る（6.14a の DoD）", async () => {
    vi.useFakeTimers({ now: T0 });
    const until = new Date(T0 + 60 * 60 * 1000).toISOString();
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, {
          rooms: [
            room("r1", "雑談", { notifications: notifications({ muted: true, muted_until: until }) }),
            // 期限なしのミュートは、時間がたっても戻らない
            room("r2", "リリース", { notifications: notifications({ muted: true }) }),
          ],
        }),
    });
    await store.loadRooms("ws-1");
    const listener = vi.fn();
    store.subscribe(listener);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
    expect(store.getSnapshot().rooms.r1?.notifications?.muted).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot().rooms.r1?.notifications).toEqual(notifications());
    expect(store.getSnapshot().rooms.r2?.notifications?.muted).toBe(true);
    // 描き直しのきっかけになる（サイドバーの薄い表示が戻る）
    expect(listener).toHaveBeenCalled();
    store.dispose();
  });

  it("期限を延ばしたら、前のタイマーでは戻さない", async () => {
    vi.useFakeTimers({ now: T0 });
    const hour = 60 * 60 * 1000;
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, { rooms: [room("r1", "雑談", { notifications: notifications({ muted: true, muted_until: new Date(T0 + hour).toISOString() }) })] }),
    });
    await store.loadRooms("ws-1");

    store.applyEvent({
      type: "room.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", level: null, muted: true, muted_until: new Date(T0 + 3 * hour).toISOString() },
    });
    await vi.advanceTimersByTimeAsync(2 * hour);

    expect(store.getSnapshot().rooms.r1?.notifications?.muted).toBe(true);
    await vi.advanceTimersByTimeAsync(hour);
    expect(store.getSnapshot().rooms.r1?.notifications?.muted).toBe(false);
    store.dispose();
  });
});

describe("スレッドの返信の通知（ADR 0056）", () => {
  const thread = {
    room: { id: "r1", kind: "public" as const, name: "雑談" },
    root: { id: "m-1", sender: miyuki, kind: "user" as const, body: "親", created_at: "2026-09-13T01:00:00Z", deleted: false },
    root_seq: 1,
    reply_count: 1,
    last_reply_at: "2026-09-13T01:00:00Z",
    last_thread_seq: 1,
    last_read_thread_seq: 1,
    unread_count: 0,
    notify_replies: true,
    mention_count: 0,
  };

  it("thread.notifications_updated を一覧に当てる（別のタブで切り替えた）", async () => {
    const { store } = setup({ "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [thread], next_cursor: null }) });
    await store.reloadThreads("ws-1");

    store.applyEvent({
      type: "thread.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", thread_root_id: "m-1", notify_replies: false },
    });

    expect(store.getSnapshot().threadLists["ws-1"]?.list[0].notify_replies).toBe(false);
  });

  it("失敗したら元に戻して投げる", async () => {
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [thread], next_cursor: null }),
      "PUT /api/v1/rooms/r1/threads/m-1/me/notifications": () => problem(500, "internal"),
    });
    await store.reloadThreads("ws-1");

    await expect(store.setThreadNotifications("ws-1", "r1", "m-1", false)).rejects.toThrow();
    expect(store.getSnapshot().threadLists["ws-1"]?.list[0].notify_replies).toBe(true);
  });
});

describe("アクティビティ（ADR 0058）", () => {
  const design = room("r1", "デザインレビュー", { last_user_seq: 2, last_read_user_seq: 2 });
  const mention = { mentions: [{ kind: "user" as const, user: naoki }] };
  const page = (items: unknown[], next: string | null = null) => json(200, { items, next_cursor: next, has_more: next !== null });
  const listed = (seq: number, overrides: Record<string, unknown> = {}) => ({
    id: `m:${seq}`,
    type: "message",
    reasons: ["mention"],
    unread: true,
    occurred_at: `2026-09-13T01:0${seq}:00Z`,
    room: { id: "r1", kind: "public", name: "デザインレビュー", dm_peer: null },
    message: message(seq, { id: `m-${seq}`, room_id: "r1", ...mention }),
    reaction: null,
    ...overrides,
  });

  function activityStore(routes: Record<string, Handler> = {}) {
    const env = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [design] }),
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50": () => page([listed(2)]),
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50&unread=true": () => page([listed(2)]),
      "GET /api/v1/workspaces/ws-1/activity/unread_count": () => json(200, { count: 1 }),
      ...routes,
    });
    return env;
  }

  const items = (store: ReturnType<typeof setup>["store"], key = "all:all") =>
    store.getSnapshot().activity["ws-1"]?.lists[key]?.items.map((i) => i.message.id);

  it("自分宛てのメンションが届いたら先頭に足し、未読の件数を 1 つ増やす（同じメッセージは 1 回だけ）", async () => {
    const { store } = activityStore();
    await store.loadRooms("ws-1");
    await Promise.all([store.loadActivity("ws-1", "all", false), store.loadActivityUnreadCount("ws-1")]);

    const created = message(3, { id: "m-3", room_id: "r1", user_seq: 3, created_at: "2026-09-13T01:09:00Z", ...mention });
    store.applyEvent({ type: "message.created", data: created });
    store.applyEvent({ type: "message.created", data: created });

    expect(items(store)).toEqual(["m-3", "m-2"]);
    expect(store.getSnapshot().activity["ws-1"]?.lists["all:all"]?.items[0]).toMatchObject({ reasons: ["mention"], unread: true });
    expect(store.getSnapshot().activity["ws-1"]?.unreadCount).toBe(2);
  });

  it("規則に当たらない投稿と、自分の投稿は足さない", async () => {
    const { store } = activityStore();
    await store.loadRooms("ws-1");
    await store.loadActivity("ws-1", "all", false);

    store.applyEvent({ type: "message.created", data: message(3, { id: "m-3", room_id: "r1" }) });
    store.applyEvent({ type: "message.created", data: message(4, { id: "m-4", room_id: "r1", sender: naoki, ...mention }) });

    expect(items(store)).toEqual(["m-2"]);
  });

  it("ルームを読むと 1 件を既読にし、「未読メッセージ」の一覧からは外して、件数を取り直す", async () => {
    let count = 1;
    const { store, requests } = activityStore({
      "GET /api/v1/workspaces/ws-1/activity/unread_count": () => json(200, { count }),
    });
    await store.loadRooms("ws-1");
    await Promise.all([
      store.loadActivity("ws-1", "all", false),
      store.loadActivity("ws-1", "all", true),
      store.loadActivityUnreadCount("ws-1"),
    ]);

    count = 0;
    store.applyEvent({
      type: "room.read",
      data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 2, last_read_user_seq: 2, unread_count: 0, mention_count: 0 },
    });

    expect(store.getSnapshot().activity["ws-1"]?.lists["all:all"]?.items[0]?.unread).toBe(false);
    expect(items(store, "all:unread")).toEqual([]);
    await vi.waitFor(() => expect(store.getSnapshot().activity["ws-1"]?.unreadCount).toBe(0));
    expect(requests().filter((p) => p.endsWith("/activity/unread_count"))).toHaveLength(2);
  });

  it("削除されたメッセージは外す", async () => {
    const { store } = activityStore();
    await store.loadRooms("ws-1");
    await store.loadActivity("ws-1", "all", false);

    store.applyEvent({ type: "message.deleted", data: message(2, { id: "m-2", room_id: "r1", deleted_at: "2026-09-13T02:00:00Z" }) });

    expect(items(store)).toEqual([]);
  });

  it("自分のメッセージへのリアクションを足し・外す（リアクションのタブにも、未読の一覧には入れない）", async () => {
    const { store } = activityStore({
      "GET /api/v1/workspaces/ws-1/activity?filter=reaction&limit=50": () => page([]),
    });
    await store.loadRooms("ws-1");
    await Promise.all([
      store.loadActivity("ws-1", "all", false),
      store.loadActivity("ws-1", "reaction", false),
      store.loadActivity("ws-1", "all", true),
    ]);
    const reacted = listed(5, {
      id: "r:m-5:u:👍",
      type: "reaction",
      reasons: ["reaction"],
      unread: false,
      occurred_at: "2026-09-13T01:09:00Z",
      message: message(5, { id: "m-5", room_id: "r1", sender: naoki }),
      reaction: { emoji: "👍", user: miyuki },
    });

    store.applyEvent({ type: "activity.reaction_added", data: { workspace_id: "ws-1", item: reacted as never } });
    expect(items(store)).toEqual(["m-5", "m-2"]);
    expect(items(store, "reaction:all")).toEqual(["m-5"]);
    expect(items(store, "all:unread")).toEqual(["m-2"]);

    store.applyEvent({ type: "activity.reaction_removed", data: { workspace_id: "ws-1", id: "r:m-5:u:👍" } });
    expect(items(store)).toEqual(["m-2"]);
  });

  it("通知の設定が変わったら、読み込んでいる一覧と件数を取り直す（そのときの設定で当てはめるため）", async () => {
    const { store, requests } = activityStore();
    await store.loadRooms("ws-1");
    await Promise.all([store.loadActivity("ws-1", "all", false), store.loadActivityUnreadCount("ws-1")]);

    store.applyEvent({
      type: "room.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", level: null, muted: true, muted_until: null },
    });

    await vi.waitFor(() =>
      expect(requests().filter((p) => p === "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50")).toHaveLength(2),
    );
    expect(requests().filter((p) => p.endsWith("/activity/unread_count"))).toHaveLength(2);
  });

  it("続きを取ると、前のページの next_cursor を before に渡して後ろに足す", async () => {
    const { store, requests } = activityStore({
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50": () => page([listed(3)], "c1"),
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50&before=c1": () => page([listed(2)]),
    });
    await store.loadActivity("ws-1", "all", false);

    await store.loadMoreActivity("ws-1", "all", false);
    await store.loadMoreActivity("ws-1", "all", false);

    expect(items(store)).toEqual(["m-3", "m-2"]);
    expect(requests().filter((p) => p.includes("before="))).toHaveLength(1);
  });
});
