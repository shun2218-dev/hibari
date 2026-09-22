import { describe, expect, it, vi } from "vitest";

import { miyuki, naoki } from "@/test/chat-data";
import { setup, body, opened, msg, created, seqs } from "@/test/chat-store";
import { type Handler, json, problem } from "@/test/fake-api";

describe("スレッド", () => {
  const thread = {
    room: { id: "r1", kind: "public" as const, name: "雑談" },
    root: { id: "m-1", sender: miyuki, kind: "user" as const, body: "親", created_at: "2026-09-13T01:00:00Z", deleted: false },
    root_seq: 1,
    reply_count: 1,
    last_reply_at: "2026-09-13T01:00:00Z",
    last_thread_seq: 1,
    last_read_thread_seq: 1,
    unread_count: 0,
    notify_replies: true,
    mention_count: 0,
  };

  describe("threads (ADR 0036)", () => {
    const threadRoot = (lastThreadSeq: number, changeSeq: number) =>
      msg(2, { change_seq: changeSeq, thread: { reply_count: lastThreadSeq, last_thread_seq: lastThreadSeq, last_reply_at: "2026-09-13T02:00:00Z" } });
    const followedRow = {
      room: { id: "r1", kind: "public" as const, name: "雑談" },
      root: { id: "m-2", sender: miyuki, kind: "user" as const, body: "本文 2", created_at: "2026-09-13T01:00:00Z", deleted: false },
      root_seq: 2,
      reply_count: 1,
      last_reply_at: "2026-09-13T01:30:00Z",
      last_thread_seq: 1,
      last_read_thread_seq: 1,
      unread_count: 0,
    };
    const threadRoutes: Record<string, Handler> = {
      "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [followedRow], next_cursor: null }),
      "GET /api/v1/rooms/r1/threads/m-2/messages?limit=50": () =>
        json(200, {
          root: threadRoot(1, 4),
          messages: [msg(4, { change_seq: 3, thread_root_id: "m-2", thread_seq: 1 })],
          has_more: false,
          last_change_seq: 4,
          last_read_thread_seq: 1,
        }),
    };

    it("keeps replies out of the channel's read position while still advancing the sync cursor", async () => {
      const { store } = await opened();

      store.applyEvent(created(msg(4, { change_seq: 4, sender: miyuki, thread_root_id: "m-9", thread_seq: 1 })));

      const state = store.getSnapshot();
      expect(state.timelines.r1?.changeSeq).toBe(4);
      // チャンネルの未読・最後のメッセージは動かない
      expect(state.rooms.r1).toMatchObject({ last_message_seq: 3, unread_count: 0 });
    });

    it("adds replies to an open thread and advances my own read position when I reply", async () => {
      const { store } = await opened(threadRoutes);
      await store.loadThreads("ws-1");
      await store.openThread("r1", "m-2");

      store.applyEvent(created(msg(5, { change_seq: 5, sender: naoki, client_msg_id: "c-5", thread_root_id: "m-2", thread_seq: 2 })));
      store.applyEvent({ type: "message.updated", data: threadRoot(2, 6) });

      const state = store.getSnapshot();
      expect(state.threads["m-2"]?.replies.map((m) => m.seq)).toEqual([4, 5]);
      expect(state.threads["m-2"]?.lastReadThreadSeq).toBe(2);
      expect(state.threadLists["ws-1"]?.list[0]).toMatchObject({ last_thread_seq: 2, last_read_thread_seq: 2, unread_count: 0, reply_count: 2 });
    });

    it("sends a thread reply with thread_root_id on the room's send queue", async () => {
      const sent: unknown[] = [];
      const { store } = await opened({
        ...threadRoutes,
        "POST /api/v1/rooms/r1/messages": (_url, init) => {
          const req = body(init);
          sent.push(req);
          return json(201, msg(5, { change_seq: 5, sender: naoki, client_msg_id: req.client_msg_id, body: req.body, thread_root_id: "m-2", thread_seq: 2 }));
        },
      });
      await store.openThread("r1", "m-2");

      store.sendMessage("r1", { body: "返信", threadRootId: "m-2" });

      await vi.waitFor(() => expect(store.getSnapshot().outgoing.r1).toBeUndefined());
      expect(sent).toEqual([expect.objectContaining({ body: "返信", thread_root_id: "m-2" })]);
      expect(store.getSnapshot().threads["m-2"]?.replies.map((m) => m.body)).toEqual(["本文 4", "返信"]);
    });

    it("sends also_in_channel with the reply and shows it in the channel too (ADR 0039)", async () => {
      const sent: unknown[] = [];
      const { store } = await opened({
        ...threadRoutes,
        "POST /api/v1/rooms/r1/messages": (_url, init) => {
          const req = body(init);
          sent.push(req);
          return json(201, msg(5, {
            change_seq: 5, user_seq: 4, sender: naoki, client_msg_id: req.client_msg_id, body: req.body,
            thread_root_id: "m-2", thread_seq: 2, also_in_channel: req.also_in_channel,
          }));
        },
      });
      await store.openThread("r1", "m-2");

      store.sendMessage("r1", { body: "みんなにも", threadRootId: "m-2", alsoInChannel: true });

      await vi.waitFor(() => expect(store.getSnapshot().outgoing.r1).toBeUndefined());
      expect(sent).toEqual([expect.objectContaining({ thread_root_id: "m-2", also_in_channel: true })]);
      const state = store.getSnapshot();
      // 同じ 1 行が、スレッドにもチャンネルにも並ぶ
      expect(state.threads["m-2"]?.replies.map((m) => m.body)).toEqual(["本文 4", "みんなにも"]);
      expect(seqs(store)).toEqual([1, 2, 3, 5]);
      // 自分の発言なので、チャンネルの既読位置も進む（未読を作らない）
      expect(state.rooms.r1).toMatchObject({ last_message_seq: 5, unread_count: 0 });
    });

    it("never sends also_in_channel for a channel message (the server would answer 422)", async () => {
      const sent: unknown[] = [];
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": (_url, init) => {
          const req = body(init);
          sent.push(req);
          return json(201, msg(4, { change_seq: 4, sender: naoki, client_msg_id: req.client_msg_id, body: req.body }));
        },
      });

      store.sendMessage("r1", { body: "チャンネルへ", alsoInChannel: true });

      await vi.waitFor(() => expect(store.getSnapshot().outgoing.r1).toBeUndefined());
      expect(sent[0]).not.toHaveProperty("thread_root_id");
      expect(sent[0]).not.toHaveProperty("also_in_channel");
    });

    it("counts a broadcast reply from someone else as unread in the channel", async () => {
      const { store } = await opened();

      store.applyEvent(created(msg(4, {
        change_seq: 4, user_seq: 4, sender: miyuki, thread_root_id: "m-2", thread_seq: 1, also_in_channel: true,
      })));

      const state = store.getSnapshot();
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
      expect(state.rooms.r1).toMatchObject({ last_message_seq: 4, unread_count: 1 });
    });

    it("restores a broadcast reply sent while disconnected in both the channel and the thread", async () => {
      const broadcast = msg(5, {
        change_seq: 5, user_seq: 4, sender: miyuki, thread_root_id: "m-2", thread_seq: 2, also_in_channel: true,
      });
      const { store } = await opened({
        ...threadRoutes,
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () =>
          json(200, { messages: [broadcast], has_more: false, last_change_seq: 5 }),
      });
      await store.openThread("r1", "m-2");

      await store.syncTimeline("r1");

      const state = store.getSnapshot();
      expect(seqs(store)).toEqual([1, 2, 3, 5]);
      expect(state.threads["m-2"]?.replies.map((m) => m.seq)).toEqual([4, 5]);
      // 見ていない間に届いた分なので、「ここから未読」は同期の前の最新（3）の後ろに出す
      expect(state.timelines.r1?.unreadAfterSeq).toBe(3);
    });

    it("reloads the followed threads when the server says I followed one", async () => {
      const { store, requests } = await opened(threadRoutes);
      await store.loadThreads("ws-1");

      store.applyEvent({ type: "thread.followed", data: { workspace_id: "ws-1", room_id: "r1", thread_root_id: "m-2", last_read_thread_seq: 0 } });

      await vi.waitFor(() =>
        expect(requests().filter((p) => p === "GET /api/v1/workspaces/ws-1/threads?limit=200")).toHaveLength(2),
      );
    });

    it("forgets the threads of a room I was removed from", async () => {
      const { store } = await opened(threadRoutes);
      await store.loadThreads("ws-1");
      await store.openThread("r1", "m-2");

      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "removed" } });

      expect(store.getSnapshot().threadLists["ws-1"]?.list).toEqual([]);
      // public ルームは読めるので、スレッドは残して参加だけを外す
      expect(store.getSnapshot().threads["m-2"]?.lastReadThreadSeq).toBeNull();
    });
  });

  it("thread.notifications_updated を一覧に当てる（別のタブで切り替えた）", async () => {
    const { store } = setup({ "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [thread], next_cursor: null }) });
    await store.reloadThreads("ws-1");

    store.applyEvent({
      type: "thread.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", thread_root_id: "m-1", notify_replies: false },
    });

    expect(store.getSnapshot().threadLists["ws-1"]?.list[0].notify_replies).toBe(false);
  });

  it("失敗したら元に戻して投げる", async () => {
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/threads?limit=200": () => json(200, { threads: [thread], next_cursor: null }),
      "PUT /api/v1/rooms/r1/threads/m-1/me/notifications": () => problem(500, "internal"),
    });
    await store.reloadThreads("ws-1");

    await expect(store.setThreadNotifications("ws-1", "r1", "m-1", false)).rejects.toThrow();
    expect(store.getSnapshot().threadLists["ws-1"]?.list[0].notify_replies).toBe(true);
  });
});
