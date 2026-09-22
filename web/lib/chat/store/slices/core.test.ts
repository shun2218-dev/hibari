import { describe, expect, it, vi } from "vitest";

import { setup } from "@/test/chat-store";
import { json } from "@/test/fake-api";

describe("ストアの土台", () => {
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
