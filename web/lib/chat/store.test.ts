import { describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/auth/session";
import { message, miyuki, naoki, room, roomMember, workspace } from "@/test/chat-data";
import { type Handler, TEST_API_BASE, fakeApi, json, problem, tokens } from "@/test/fake-api";

import { createChatApi } from "./api";
import { createChatStore } from "./store";

function setup(routes: Record<string, Handler>) {
  const api = fakeApi({ "POST /api/v1/auth/refresh": () => tokens("at-1"), ...routes });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const store = createChatStore(createChatApi(session.request));
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
