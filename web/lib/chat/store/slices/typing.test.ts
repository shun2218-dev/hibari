import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { miyuki, naoki } from "@/test/chat-data";
import { setup, msg, created } from "@/test/chat-store";

describe("入力中", () => {
  describe("typing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const typing = (user: typeof miyuki, threadRootId: string | null = null) => ({
      type: "typing.started" as const,
      data: { workspace_id: "ws-1", room_id: "r1", thread_root_id: threadRootId, user },
    });

    it("does not show typing in a thread as typing in the channel (ADR 0036)", () => {
      const { store } = setup({});

      store.applyEvent(typing(miyuki, "m-1"));

      expect(store.getSnapshot().typing.r1).toBeUndefined();
    });

    it("shows who is typing for 6 seconds after the last notice", async () => {
      const { store } = setup({});

      store.applyEvent(typing(miyuki));
      await vi.advanceTimersByTimeAsync(5_000);
      store.applyEvent(typing(miyuki));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(store.getSnapshot().typing.r1?.map((t) => t.user.id)).toEqual([miyuki.id]);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.getSnapshot().typing.r1).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores myself and clears someone once their message arrives", () => {
      const { store } = setup({});

      store.applyEvent(typing(naoki));
      store.applyEvent(typing(miyuki));
      expect(store.getSnapshot().typing.r1?.map((t) => t.user.id)).toEqual([miyuki.id]);

      store.applyEvent(created(msg(1, { sender: miyuki })));
      expect(store.getSnapshot().typing.r1).toBeUndefined();
    });

    it("stops its timers on dispose", () => {
      const { store } = setup({});
      store.applyEvent(typing(miyuki));

      store.dispose();

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
