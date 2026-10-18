import { describe, expect, it } from "vitest";

import { miyuki } from "@/test/chat-data";
import { setup, opened, msg, page } from "@/test/chat-store";
import { json } from "@/test/fake-api";

describe("ピン留め", () => {
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
});
