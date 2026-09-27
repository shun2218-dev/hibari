import { describe, expect, it, vi } from "vitest";

import type { HuddleList, PastHuddle } from "@/lib/api/types.gen";

import { createRecentHuddles } from "./recent";

function past(id: string, overrides: Partial<PastHuddle> = {}): PastHuddle {
  return {
    id,
    message_id: `m-${id}`,
    started_by: "u1",
    room: { id: "r1", kind: "public", name: "設計" },
    started_at: "2026-09-26T02:00:00Z",
    ended_at: "2026-09-26T02:10:00Z",
    participant_ids: ["u1"],
    reply_count: 0,
    saved: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createRecentHuddles（ADR 0067 決定 6・7）", () => {
  it("開くと 1 ページ目を取り、続きを足す（重なりは足さない）", async () => {
    const listHuddles = vi
      .fn()
      .mockResolvedValueOnce({ huddles: [past("h3"), past("h2")], next_cursor: "h2" } satisfies HuddleList)
      .mockResolvedValueOnce({ huddles: [past("h2"), past("h1")], next_cursor: null } satisfies HuddleList);
    const store = createRecentHuddles({ listHuddles, huddleSuggestions: vi.fn() });

    store.load("ws-1", { filter: "all" });
    expect(store.getSnapshot().status).toBe("loading");
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
    await store.loadMore();

    expect(store.getSnapshot().items.map((h) => h.id)).toEqual(["h3", "h2", "h1"]);
    expect(store.getSnapshot().nextCursor).toBeNull();
    expect(listHuddles).toHaveBeenLastCalledWith("ws-1", { filter: "all", before: "h2" });
  });

  it("絞り込みを変えたら前の行を捨て、前の問い合わせの結果が後から届いても使わない", async () => {
    const first = deferred<HuddleList>();
    const listHuddles = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ huddles: [past("missed")], next_cursor: null });
    const store = createRecentHuddles({ listHuddles, huddleSuggestions: vi.fn() });

    store.load("ws-1", { filter: "all" });
    store.load("ws-1", { filter: "missed" });
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
    first.resolve({ huddles: [past("all")], next_cursor: null });
    await first.promise;

    expect(store.getSnapshot().items.map((h) => h.id)).toEqual(["missed"]);
  });

  it("同じ条件の取り直し（ハドルが終わった）では、届くまで今の行を残す", async () => {
    const again = deferred<HuddleList>();
    const listHuddles = vi.fn().mockResolvedValueOnce({ huddles: [past("h1")], next_cursor: null }).mockReturnValueOnce(again.promise);
    const store = createRecentHuddles({ listHuddles, huddleSuggestions: vi.fn() });

    store.load("ws-1", { filter: "all" });
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
    store.load("ws-1", { filter: "all" });
    expect(store.getSnapshot().items.map((h) => h.id)).toEqual(["h1"]);
    again.resolve({ huddles: [past("h2"), past("h1")], next_cursor: null });
    await vi.waitFor(() => expect(store.getSnapshot().items.map((h) => h.id)).toEqual(["h2", "h1"]));
  });

  it("提案のカードを取り、行の「後で」の印を手元で変える", async () => {
    const listHuddles = vi.fn().mockResolvedValue({ huddles: [past("h1")], next_cursor: null });
    const huddleSuggestions = vi.fn().mockResolvedValue({
      suggestions: [{ room: { id: "r1", kind: "public", name: "設計" }, count: 2, participant_ids: [] }],
    });
    const store = createRecentHuddles({ listHuddles, huddleSuggestions });

    store.load("ws-1", { filter: "all" });
    await store.loadSuggestions("ws-1");
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
    store.markSaved("h1", true);

    expect(store.getSnapshot().suggestions?.[0].count).toBe(2);
    expect(store.getSnapshot().items[0].saved).toBe(true);
  });
});
