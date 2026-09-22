import { describe, expect, it } from "vitest";

import { message, miyuki, naoki, room } from "@/test/chat-data";
import { setup } from "@/test/chat-store";
import { type Handler, json, problem } from "@/test/fake-api";

describe("メッセージへの操作", () => {
  describe("toggleReaction", () => {
    // room_id は開いているルームに合わせる（receiveMessage はメッセージ自身の room_id で振り分ける）
    const reacted = (me: boolean | undefined, count: number, users: string[], changeSeq = 2) =>
      message(1, {
        room_id: "r1",
        change_seq: changeSeq,
        reactions: [{ emoji: "👍", count, ...(me === undefined ? {} : { me }), users }],
      });

    function reactionSetup(routes: Record<string, Handler>) {
      return setup({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { last_message_seq: 1, last_read_seq: 1, last_user_seq: 1, last_read_user_seq: 1 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [message(1)], has_more: false, last_change_seq: 1 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 1, last_read_user_seq: 1, unread_count: 0 }),
        ...routes,
      });
    }

    const reactionsOf = (store: ReturnType<typeof setup>["store"]) =>
      store.getSnapshot().timelines.r1?.messages[0]?.reactions;

    it("shows the reaction before the server answers, then settles on the response", async () => {
      let resolve = () => {};
      const pending = new Promise<void>((r) => (resolve = r));
      const { store, requests } = reactionSetup({
        "PUT /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D": async () => {
          await pending;
          // サーバーは自分を含めた集計を返す（別の人がその間に押していた）
          return json(200, reacted(true, 2, [naoki.id, miyuki.id]));
        },
      });
      await store.openRoom("r1");

      const done = store.toggleReaction("r1", "m-1", "👍");
      // 応答を待たずに手元で反映されている（ADR 0044 決定 8）
      expect(reactionsOf(store)).toEqual([{ emoji: "👍", count: 1, me: true, users: [naoki.id] }]);

      resolve();
      await done;

      expect(reactionsOf(store)).toEqual([{ emoji: "👍", count: 2, me: true, users: [naoki.id, miyuki.id] }]);
      expect(requests()).toContain("PUT /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D");
    });

    it("removes it with DELETE when it is already mine", async () => {
      const { store, requests } = reactionSetup({
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [reacted(true, 1, [naoki.id], 1)], has_more: false, last_change_seq: 1 }),
        "DELETE /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D": () =>
          json(200, message(1, { room_id: "r1", change_seq: 2 })),
      });
      await store.openRoom("r1");

      await store.toggleReaction("r1", "m-1", "👍");

      expect(reactionsOf(store)).toEqual([]);
      expect(requests()).toContain("DELETE /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D");
    });

    it("puts it back when the request fails", async () => {
      const { store } = reactionSetup({
        "PUT /api/v1/rooms/r1/messages/m-1/reactions/%F0%9F%91%8D": () => problem(422, "validation-error"),
      });
      await store.openRoom("r1");

      await expect(store.toggleReaction("r1", "m-1", "👍")).rejects.toThrow();

      expect(reactionsOf(store)).toEqual([]);
    });

    it("keeps my own me when an update arrives without it (ADR 0044)", async () => {
      const { store } = reactionSetup({
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [reacted(true, 1, [naoki.id], 1)], has_more: false, last_change_seq: 1 }),
      });
      await store.openRoom("r1");

      // 配信には me が載らない（受け取る人ごとの値を入れられない）
      store.applyEvent({
        type: "message.updated",
        data: reacted(undefined, 2, [naoki.id, miyuki.id]),
      });

      expect(reactionsOf(store)).toEqual([{ emoji: "👍", count: 2, me: true, users: [naoki.id, miyuki.id] }]);
    });
  });
  // 添付ファイルだけの削除（ADR 0045）。
  describe("deleteAttachment", () => {
    const image = { id: "a-1", file_name: "01.png", content_type: "image/png", size_bytes: 12, width: 100, height: 80 };
    const file = { id: "a-2", file_name: "b.pdf", content_type: "application/pdf", size_bytes: 34, width: null, height: null };
    const withAttachments = (attachments: unknown[], overrides = {}) =>
      message(1, { room_id: "r1", attachments: attachments as never, ...overrides });

    function attachmentSetup(routes: Record<string, Handler>, attachments: unknown[] = [image, file]) {
      return setup({
        "GET /api/v1/rooms/r1": () =>
          json(200, room("r1", "雑談", { last_message_seq: 1, last_read_seq: 1, last_user_seq: 1, last_read_user_seq: 1 })),
        "GET /api/v1/rooms/r1/messages?limit=50": () =>
          json(200, { messages: [withAttachments(attachments)], has_more: false, last_change_seq: 1 }),
        "POST /api/v1/rooms/r1/read": () => json(200, { last_read_seq: 1, last_read_user_seq: 1, unread_count: 0 }),
        ...routes,
      });
    }

    const messageOf = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().timelines.r1?.messages[0];

    it("waits for the response instead of removing it up front (ADR 0045)", async () => {
      let resolve = () => {};
      const pending = new Promise<void>((r) => (resolve = r));
      const { store, requests } = attachmentSetup({
        "DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1": async () => {
          await pending;
          return json(200, withAttachments([file], { change_seq: 2 }));
        },
      });
      await store.openRoom("r1");

      const done = store.deleteAttachment("r1", "m-1", "a-1");
      // 取り消せない操作なので楽観的更新はしない（「消えたのに戻ってきた」を起こさない）
      expect(messageOf(store)?.attachments).toHaveLength(2);

      resolve();
      await done;

      expect(messageOf(store)?.attachments.map((a) => a.id)).toEqual(["a-2"]);
      expect(messageOf(store)?.change_seq).toBe(2);
      expect(requests()).toContain("DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1");
    });

    it("turns the message into a tombstone when the response says it is gone (ADR 0045 決定 8)", async () => {
      const { store } = attachmentSetup(
        {
          "DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1": () =>
            json(200, withAttachments([], { change_seq: 2, body: "", deleted_at: "2026-09-20T01:00:00Z" })),
        },
        [image],
      );
      await store.openRoom("r1");

      await store.deleteAttachment("r1", "m-1", "a-1");

      expect(messageOf(store)?.deleted_at).not.toBeNull();
      expect(messageOf(store)?.attachments).toEqual([]);
    });

    it("removes it on everyone's screen through message.updated (ADR 0045 決定 7)", async () => {
      const { store } = attachmentSetup({});
      await store.openRoom("r1");

      // ほかの人が消した。専用のイベントは作らず、添付の減ったメッセージが message.updated で届く
      store.applyEvent({ type: "message.updated", data: withAttachments([file], { change_seq: 2 }) as never });

      expect(messageOf(store)?.attachments.map((a) => a.id)).toEqual(["a-2"]);
    });

    it("catches up on a delete that happened while disconnected (after_change_seq)", async () => {
      const { store } = attachmentSetup({
        "GET /api/v1/rooms/r1/messages?after_change_seq=1&limit=100": () =>
          json(200, { messages: [withAttachments([file], { change_seq: 2 })], has_more: false, last_change_seq: 2 }),
      });
      await store.openRoom("r1");

      await store.syncTimeline("r1");

      expect(messageOf(store)?.attachments.map((a) => a.id)).toEqual(["a-2"]);
    });

    it("keeps the attachment when the request fails", async () => {
      const { store } = attachmentSetup({
        "DELETE /api/v1/rooms/r1/messages/m-1/attachments/a-1": () => problem(403, "forbidden"),
      });
      await store.openRoom("r1");

      await expect(store.deleteAttachment("r1", "m-1", "a-1")).rejects.toThrow();

      expect(messageOf(store)?.attachments).toHaveLength(2);
    });
  });
});
