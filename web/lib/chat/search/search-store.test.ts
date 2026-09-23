import { describe, expect, it, vi } from "vitest";

import type { Search, SearchResult } from "@/lib/api/types.gen";
import type { ChatApi } from "@/lib/chat/api/chat-api";
import { createSearchStore } from "@/lib/chat/search/search-store";

const result = (id: string): SearchResult =>
  ({
    id,
    room_id: "r1",
    seq: 1,
    room: { id: "r1", kind: "public", name: "雑談", dm_peer: null },
    sender: { id: "u1", handle: "naoki", display_name: "佐藤 直樹" },
    body: "面談の話",
    thread_root_id: null,
    created_at: "2026-09-23T01:00:00Z",
    edited_at: null,
    attachment_count: 0,
  }) as SearchResult;

const page = (items: SearchResult[], next: string | null = null): Search =>
  ({ items, next_cursor: next, terms: ["面談"] }) as Search;

/** searchMessages だけを持つ、検索に必要な最小の API。 */
function fakeApi(searchMessages: ReturnType<typeof vi.fn>) {
  return { searchMessages } as unknown as ChatApi;
}

const query = { text: "面談" };

describe("検索のストア（ADR 0061）", () => {
  it("結果と塗る語とカーソルを持つ", async () => {
    const search = vi.fn().mockResolvedValue(page([result("m1")], "c1"));
    const store = createSearchStore(fakeApi(search));

    await store.run("ws-1", query);

    expect(store.getSnapshot()).toMatchObject({
      query,
      terms: ["面談"],
      cursor: "c1",
      status: "ready",
    });
    expect(store.getSnapshot().results.map((r) => r.id)).toEqual(["m1"]);
    expect(search).toHaveBeenCalledWith("ws-1", query);
  });

  it("続きを足す（前のページの結果は残す）", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce(page([result("m1")], "c1"))
      .mockResolvedValueOnce(page([result("m2")]));
    const store = createSearchStore(fakeApi(search));

    await store.run("ws-1", query);
    await store.loadMore("ws-1");

    expect(store.getSnapshot().results.map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(store.getSnapshot().cursor).toBeNull();
    expect(search).toHaveBeenLastCalledWith("ws-1", query, "c1");
  });

  it("続きがなければ、続きを頼まない", async () => {
    const search = vi.fn().mockResolvedValue(page([result("m1")]));
    const store = createSearchStore(fakeApi(search));

    await store.run("ws-1", query);
    await store.loadMore("ws-1");

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("まだ検索していなければ、続きを頼まない", async () => {
    const search = vi.fn();
    const store = createSearchStore(fakeApi(search));

    await store.loadMore("ws-1");

    expect(search).not.toHaveBeenCalled();
  });

  it("本文の条件が空なら、サーバーに聞かずに空の結果にする（サーバーは 422 を返す）", async () => {
    const search = vi.fn();
    const store = createSearchStore(fakeApi(search));

    await store.run("ws-1", { text: "   " });

    expect(search).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ results: [], status: "ready" });
  });

  it("前の検索が返ってきても、次の検索が始まっていれば捨てる", async () => {
    let resolveFirst: (value: Search) => void = () => {};
    const search = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Search>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(page([result("new")]));
    const store = createSearchStore(fakeApi(search));

    const first = store.run("ws-1", { text: "古い" });
    await store.run("ws-1", { text: "新しい" });
    resolveFirst(page([result("old")]));
    await first;

    expect(store.getSnapshot().results.map((r) => r.id)).toEqual(["new"]);
    expect(store.getSnapshot().query).toEqual({ text: "新しい" });
  });

  it("失敗したら error にする（画面は「取れなかった」を出せる）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createSearchStore(fakeApi(vi.fn().mockRejectedValue(new Error("boom"))));

    await store.run("ws-1", query);

    expect(store.getSnapshot().status).toBe("error");
  });

  it("続きが取れなくても、いま出ている結果は残す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const search = vi
      .fn()
      .mockResolvedValueOnce(page([result("m1")], "c1"))
      .mockRejectedValueOnce(new Error("boom"));
    const store = createSearchStore(fakeApi(search));

    await store.run("ws-1", query);
    await store.loadMore("ws-1");

    expect(store.getSnapshot().results.map((r) => r.id)).toEqual(["m1"]);
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("やめると空に戻る", async () => {
    const store = createSearchStore(fakeApi(vi.fn().mockResolvedValue(page([result("m1")]))));
    await store.run("ws-1", query);

    store.clear();

    expect(store.getSnapshot()).toMatchObject({ query: null, results: [], status: "idle" });
  });

  it("変わったら購読している人に知らせる", async () => {
    const store = createSearchStore(fakeApi(vi.fn().mockResolvedValue(page([result("m1")]))));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.run("ws-1", query);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    store.clear();
    expect(listener).not.toHaveBeenCalled();
  });
});
