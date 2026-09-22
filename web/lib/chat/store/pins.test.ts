import { describe, expect, it } from "vitest";

import { message, miyuki } from "@/test/chat-data";

import { applyPinnedMessages, comparePins } from "./pins";

const by = { id: miyuki.id, handle: "miyuki", display_name: "高橋 みゆき" };
const pinnedAt = (seq: number, at: string, extra: Parameters<typeof message>[1] = {}) =>
  message(seq, { pinned: { by, at }, ...extra });

describe("comparePins", () => {
  it("orders by the time pinned, newest first, then by id", () => {
    const list = [
      pinnedAt(1, "2026-09-22T01:00:00Z"),
      pinnedAt(2, "2026-09-22T03:00:00Z"),
      pinnedAt(3, "2026-09-22T01:00:00Z"),
    ].sort(comparePins);

    expect(list.map((m) => m.id)).toEqual(["m-2", "m-3", "m-1"]);
  });
});

describe("applyPinnedMessages", () => {
  const current = [pinnedAt(2, "2026-09-22T02:00:00Z"), pinnedAt(1, "2026-09-22T01:00:00Z")];

  it("returns the same array when nothing about the pins changes", () => {
    expect(applyPinnedMessages(current, [message(5)])).toBe(current);
  });

  it("inserts a newly pinned message in order and replaces an updated one", () => {
    const next = applyPinnedMessages(current, [
      pinnedAt(3, "2026-09-22T03:00:00Z"),
      pinnedAt(1, "2026-09-22T01:00:00Z", { change_seq: 9, body: "編集後" }),
    ]);

    expect(next.map((m) => [m.id, m.body])).toEqual([["m-3", "本文 3"], ["m-2", "本文 2"], ["m-1", "編集後"]]);
  });

  it("drops messages that were unpinned or deleted", () => {
    const next = applyPinnedMessages(current, [
      message(2, { change_seq: 9, pinned: null }),
      pinnedAt(1, "2026-09-22T01:00:00Z", { change_seq: 9, deleted_at: "2026-09-22T04:00:00Z" }),
    ]);

    expect(next).toEqual([]);
  });

  it("ignores an older copy of a message it already has", () => {
    const fresh = [pinnedAt(1, "2026-09-22T01:00:00Z", { change_seq: 5 })];

    expect(applyPinnedMessages(fresh, [message(1, { change_seq: 4, pinned: null })])).toBe(fresh);
  });
});
