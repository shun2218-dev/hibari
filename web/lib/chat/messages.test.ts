import { describe, expect, it } from "vitest";

import { message } from "@/test/chat-data";

import { mergeMessages } from "./messages";

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
