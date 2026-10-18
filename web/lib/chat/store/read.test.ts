import { describe, expect, it, vi } from "vitest";

import { naoki, room } from "@/test/chat-data";
import { setup, body, opened, msg, page, created } from "@/test/chat-store";
import { json } from "@/test/fake-api";

describe("既読", () => {
  describe("reading while the room is open", () => {
    it("marks new messages read while the latest is in view, without showing the divider", async () => {
      const { store, api } = await opened();
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(created(msg(4)));

      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 4, last_read_user_seq: 4, unread_count: 0 }));
      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(4);
      expect(body(api.calls.at(-1)!.init)).toEqual({ seq: 4 });
    });

    it("shows the divider before messages that arrived while not looking, and reads them once caught up", async () => {
      const { store } = await opened();
      store.setFocus({ roomId: "r1", caughtUp: false });

      store.applyEvent(created(msg(4)));
      store.applyEvent(created(msg(5)));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 3, last_read_user_seq: 3, unread_count: 2 });

      store.setFocus({ roomId: "r1", caughtUp: true });
      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.unread_count).toBe(0));
      // 区切りは、開いている間は残す
      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
    });

    it("keeps an existing divider where it is when more messages arrive in view", async () => {
      const { store } = setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 3, last_read_seq: 1, last_user_seq: 3, last_read_user_seq: 1 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () => page([msg(1), msg(2), msg(3)], 3),
        "POST /api/v1/rooms/r1/read": (_url, init) => json(200, { last_read_seq: body(init).seq, last_read_user_seq: body(init).seq, unread_count: 0 }),
      });
      await store.openRoom("r1");
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(created(msg(4)));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(1);
    });

    it("brings the divider back after it was dismissed when messages arrive unseen", async () => {
      const { store } = await opened();
      store.dismissUnread("r1");

      store.applyEvent(created(msg(4)));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(3);
    });

    it("does not treat my own message from another tab as unread", async () => {
      const { store } = await opened();
      store.setFocus({ roomId: "r1", caughtUp: false });

      store.applyEvent(created(msg(4, { sender: naoki })));

      expect(store.getSnapshot().timelines.r1?.unreadAfterSeq).toBe(4);
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 4, last_read_user_seq: 4, unread_count: 0 });
    });

    it("sends one more read with the newest seq instead of one per message", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const reads: number[] = [];
      const { store } = await opened({
        "POST /api/v1/rooms/r1/read": async (_url, init) => {
          reads.push(body(init).seq);
          await gate;
          return json(200, { last_read_seq: body(init).seq, last_read_user_seq: body(init).seq, unread_count: 0 });
        },
      });
      store.setFocus({ roomId: "r1", caughtUp: true });

      store.applyEvent(created(msg(4)));
      store.applyEvent(created(msg(5)));
      store.applyEvent(created(msg(6)));
      release();

      await vi.waitFor(() => expect(store.getSnapshot().rooms.r1?.last_read_seq).toBe(6));
      expect(reads).toEqual([4, 6]);
    });

    it("applies room.read from another tab without moving backwards", async () => {
      const { store } = await opened();
      store.applyEvent(created(msg(4)));
      store.applyEvent(created(msg(5)));

      store.applyEvent({
        type: "room.read",
        data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 5, last_read_user_seq: 5, unread_count: 0, mention_count: 0 },
      });
      store.applyEvent({
        type: "room.read",
        data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 4, last_read_user_seq: 4, unread_count: 1, mention_count: 0 },
      });

      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_read_seq: 5, last_read_user_seq: 5, unread_count: 0 });
    });
  });
});
