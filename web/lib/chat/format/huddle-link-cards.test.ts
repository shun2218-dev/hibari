import { describe, expect, it, vi } from "vitest";

import type { HuddleLinks } from "@/lib/api/types.gen";

import { createHuddleLinkCardStore } from "./huddle-link-cards";

function link(roomId: string) {
  return { room_id: roomId, status: "unavailable" as const, workspace: null, room: null, huddle: null, can_join: false };
}

describe("createHuddleLinkCardStore（ADR 0067 決定 2）", () => {
  it("同じ描画の中で頼まれたルームを 1 回にまとめて取り、取ったルームは二度取りにいかない", async () => {
    const resolveHuddleLinks = vi.fn(async (ids: readonly string[]): Promise<HuddleLinks> => ({ links: ids.map(link) }));
    const store = createHuddleLinkCardStore({ resolveHuddleLinks });

    store.request(["r1", "r2"]);
    store.request(["r2", "r3"]);
    await vi.waitFor(() => expect(store.getSnapshot().r3).toBeDefined());
    expect(resolveHuddleLinks).toHaveBeenCalledTimes(1);
    expect(resolveHuddleLinks).toHaveBeenCalledWith(["r1", "r2", "r3"]);

    store.request(["r1"]);
    await Promise.resolve();
    expect(resolveHuddleLinks).toHaveBeenCalledTimes(1);
  });

  it("取れなかったら覚えず、次に頼まれたときに取り直す", async () => {
    const resolveHuddleLinks = vi
      .fn<(ids: readonly string[]) => Promise<HuddleLinks>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ links: [link("r1")] });
    const store = createHuddleLinkCardStore({ resolveHuddleLinks });
    vi.spyOn(console, "error").mockImplementation(() => {});

    store.request(["r1"]);
    await vi.waitFor(() => expect(resolveHuddleLinks).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(store.getSnapshot().r1).toBeUndefined();

    store.request(["r1"]);
    await vi.waitFor(() => expect(store.getSnapshot().r1).toBeDefined());
  });
});
