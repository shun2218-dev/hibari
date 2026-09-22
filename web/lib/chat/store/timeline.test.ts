import { describe, expect, it, vi } from "vitest";

import { message, room } from "@/test/chat-data";
import { setup, body, opened, msg, page, created, seqs } from "@/test/chat-store";
import { json, problem } from "@/test/fake-api";

describe("タイムライン", () => {
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
});
