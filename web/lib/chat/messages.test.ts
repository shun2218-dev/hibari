import { describe, expect, it } from "vitest";

import { message, miyuki, naoki, room } from "@/test/chat-data";

import { advanceCursor, applyMessageToRoom, applyReadToRoom, insertByActivity, mergeIntoWindow, mergeMessages } from "./messages";

describe("mergeMessages", () => {
  it("orders by seq regardless of created_at or arrival order", () => {
    const merged = mergeMessages(
      [message(3, { created_at: "2026-09-13T00:00:00Z" })],
      [message(5), message(1, { created_at: "2026-09-13T09:00:00Z" })],
    );

    expect(merged.map((m) => m.seq)).toEqual([1, 3, 5]);
  });

  it("keeps the copy with the larger change_seq when the same message arrives twice", () => {
    const edited = message(2, { body: "編集後", change_seq: 10 });
    const stale = message(2, { body: "編集前", change_seq: 2 });

    expect(mergeMessages([edited], [stale])[0].body).toBe("編集後");
    expect(mergeMessages([stale], [edited])[0].body).toBe("編集後");
  });

  it("does not mutate its inputs", () => {
    const current = [message(2)];
    const incoming = [message(1)];

    mergeMessages(current, incoming);

    expect(current.map((m) => m.seq)).toEqual([2]);
    expect(incoming.map((m) => m.seq)).toEqual([1]);
  });
});

describe("mergeIntoWindow", () => {
  it("drops changes to messages older than the loaded range while older pages remain", () => {
    const current = [message(50), message(51)];

    const merged = mergeIntoWindow(current, true, [message(10, { change_seq: 60 }), message(52, { change_seq: 61 })]);

    expect(merged.map((m) => m.seq)).toEqual([50, 51, 52]);
  });

  it("takes everything when the whole history is loaded", () => {
    const merged = mergeIntoWindow([message(2)], false, [message(1, { change_seq: 5 })]);

    expect(merged.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("returns the same array when nothing applies", () => {
    const current = [message(50)];

    expect(mergeIntoWindow(current, true, [message(3)])).toBe(current);
  });
});

describe("advanceCursor", () => {
  it("moves over consecutive change_seq only", () => {
    const messages = [message(1, { change_seq: 4 }), message(2, { change_seq: 5 }), message(3, { change_seq: 7 })];

    expect(advanceCursor(3, messages)).toBe(5);
    expect(advanceCursor(6, messages)).toBe(7);
    expect(advanceCursor(10, messages)).toBe(10);
  });
});

describe("applyMessageToRoom", () => {
  const me = naoki.id;
  const base = room("r1", "雑談", { last_message_seq: 5, last_read_seq: 3, unread_count: 2 });

  it("updates the last message and recomputes unread from seq, so a duplicate does not count twice", () => {
    const created = message(6, { sender: miyuki, body: "新着" });

    const once = applyMessageToRoom(base, created, me, true);
    const twice = applyMessageToRoom(once, created, me, true);

    expect(once).toMatchObject({ last_message_seq: 6, unread_count: 3, last_message: { id: "m-6", body: "新着" } });
    expect(twice).toBe(once);
  });

  it("moves my read position with my own message", () => {
    expect(applyMessageToRoom(base, message(6, { sender: naoki }), me, true)).toMatchObject({
      last_read_seq: 6,
      unread_count: 0,
    });
  });

  it("keeps unread at zero in a public room I have not joined", () => {
    const guest = room("r1", "雑談", { is_member: false, last_read_seq: null, last_message_seq: 5 });

    expect(applyMessageToRoom(guest, message(6), me, true)).toMatchObject({ last_read_seq: null, unread_count: 0 });
  });

  it("reflects an edit or deletion only when it is the last message", () => {
    const withLast = applyMessageToRoom(base, message(6), me, true);

    expect(applyMessageToRoom(withLast, message(6, { deleted_at: "2026-09-13T02:00:00Z", body: "" }), me, false))
      .toMatchObject({ last_message: { deleted: true } });
    expect(applyMessageToRoom(withLast, message(4, { body: "古い編集" }), me, false)).toBe(withLast);
  });
});

describe("applyReadToRoom", () => {
  it("never moves the read position back", () => {
    const r = room("r1", "雑談", { last_message_seq: 9, last_read_seq: 7, unread_count: 2 });

    expect(applyReadToRoom(r, 5)).toBe(r);
    expect(applyReadToRoom(r, 9)).toMatchObject({ last_read_seq: 9, unread_count: 0 });
  });
});

describe("insertByActivity", () => {
  it("places a room by its last message time, rooms without messages last", () => {
    const rooms = {
      a: room("a", "a", { last_message_at: "2026-09-13T03:00:00Z" }),
      b: room("b", "b", { last_message_at: "2026-09-13T01:00:00Z" }),
      c: room("c", "c"),
    };
    const middle = room("n", "n", { last_message_at: "2026-09-13T02:00:00Z" });

    expect(insertByActivity(["a", "b", "c"], middle, rooms)).toEqual(["a", "n", "b", "c"]);
    expect(insertByActivity(["a", "b", "c"], room("n", "n"), rooms)).toEqual(["a", "b", "c", "n"]);
  });
});
