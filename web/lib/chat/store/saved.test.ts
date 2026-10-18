import { describe, expect, it, vi } from "vitest";

import { savedItem } from "@/test/chat-data";
import { setup, opened, msg } from "@/test/chat-store";
import { json, problem } from "@/test/fake-api";

describe("「後で」", () => {
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
});
