import { describe, expect, it, vi } from "vitest";

import { message, naoki, room } from "@/test/chat-data";
import { setup, body, opened, msg, page, created, seqs } from "@/test/chat-store";
import { type Handler, json, problem } from "@/test/fake-api";

describe("送信", () => {
  describe("sending", () => {
    /** 応答を手で返す。 */
    function deferred() {
      let resolve!: (res: Response) => void;
      const promise = new Promise<Response>((r) => (resolve = r));
      return { promise, resolve };
    }

    const mine = (seq: number, clientMsgId: string, overrides: Parameters<typeof message>[1] = {}) =>
      msg(seq, { id: `m-${seq}`, sender: naoki, client_msg_id: clientMsgId, ...overrides });

    /** 送信の API。送られた本文の順と、応答（既定は client_msg_id ごとに 1 回だけ採番して 201 / 200）を持つ。 */
    function sendRoute() {
      const sent: { client_msg_id: string; body: string; reply_to_id?: string }[] = [];
      const byClientId = new Map<string, ReturnType<typeof message>>();
      let seq = 3;
      const handler: Handler = (_url, init) => {
        const req = body(init);
        sent.push(req);
        const existing = byClientId.get(req.client_msg_id);
        if (existing) return json(200, existing);
        const created = mine(++seq, req.client_msg_id, { body: req.body });
        byClientId.set(req.client_msg_id, created);
        return json(201, created);
      };
      return { sent, handler };
    }

    const outgoing = (store: ReturnType<typeof setup>["store"]) => store.getSnapshot().outgoing.r1 ?? [];

    it("shows the message at once with a ULID, then replaces it with the confirmed one", async () => {
      const route = sendRoute();
      const response = deferred();
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": async (url, init) => {
          await response.promise;
          return route.handler(url, init);
        },
      });

      store.sendMessage("r1", { body: "こんにちは" });

      expect(outgoing(store)).toMatchObject([{ body: "こんにちは", status: "pending" }]);
      const clientMsgId = outgoing(store)[0]!.clientMsgId;
      expect(clientMsgId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

      response.resolve(new Response());
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
      expect(store.getSnapshot().rooms.r1).toMatchObject({ last_message_seq: 4, last_read_seq: 4, last_user_seq: 4, last_read_user_seq: 4, unread_count: 0 });
      expect(route.sent).toEqual([{ client_msg_id: clientMsgId, body: "こんにちは" }]);
    });

    it("attaches uploaded files and keeps them when retrying", async () => {
      const route = sendRoute();
      let fail = true;
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": (url, init) => (fail ? problem(503, "internal") : route.handler(url, init)),
      });
      const pdf = {
        id: "a1",
        file_name: "scale.pdf",
        content_type: "application/pdf",
        size_bytes: 253_952,
        width: null,
        height: null,
      };

      store.sendMessage("r1", { body: "", attachments: [pdf] });
      expect(outgoing(store)).toMatchObject([{ body: "", attachments: [pdf], status: "pending" }]);
      await vi.waitFor(() => expect(outgoing(store)).toMatchObject([{ status: "failed", attachments: [pdf] }]));

      fail = false;
      store.retryMessage("r1", outgoing(store)[0]!.clientMsgId);
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));
      expect(route.sent).toEqual([expect.objectContaining({ body: "", attachment_ids: ["a1"] })]);
    });

    it("入力欄でプレビューを消した URL を送信に付け、再送でも保つ（ADR 0065 決定 13）", async () => {
      const route = sendRoute();
      let fail = true;
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": (url, init) => (fail ? problem(503, "internal") : route.handler(url, init)),
      });

      store.sendMessage("r1", { body: "https://a.example/ https://b.example/", suppressedLinkPreviewUrls: ["https://b.example/"] });
      await vi.waitFor(() => expect(outgoing(store)).toMatchObject([{ status: "failed" }]));
      fail = false;
      store.retryMessage("r1", outgoing(store)[0]!.clientMsgId);
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));

      // 失敗した 1 回目は route に届いていない。再送にも同じ値が付く
      expect(route.sent).toEqual([expect.objectContaining({ suppressed_link_preview_urls: ["https://b.example/"] })]);
    });

    it("消した URL がなければ suppressed_link_preview_urls を付けない", async () => {
      const route = sendRoute();
      const { store } = await opened({ "POST /api/v1/rooms/r1/messages": route.handler });

      store.sendMessage("r1", { body: "https://a.example/", suppressedLinkPreviewUrls: [] });
      await vi.waitFor(() => expect(route.sent).toHaveLength(1));
      expect(route.sent[0]).not.toHaveProperty("suppressed_link_preview_urls");
    });

    it("sends one message at a time, in the order they were written", async () => {
      const route = sendRoute();
      const responses = [deferred(), deferred()];
      let calls = 0;
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": async (url, init) => {
          await responses[calls++]!.promise;
          return route.handler(url, init);
        },
      });

      store.sendMessage("r1", { body: "1 通目" });
      store.sendMessage("r1", { body: "2 通目" });
      await vi.waitFor(() => expect(route.sent).toHaveLength(0));
      expect(calls).toBe(1);

      responses[0]!.resolve(new Response());
      await vi.waitFor(() => expect(calls).toBe(2));
      responses[1]!.resolve(new Response());
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));

      expect(route.sent.map((r) => r.body)).toEqual(["1 通目", "2 通目"]);
      expect(store.getSnapshot().timelines.r1?.messages.slice(-2).map((m) => [m.seq, m.body])).toEqual([
        [4, "1 通目"],
        [5, "2 通目"],
      ]);
    });

    it("fails the queued messages too, and a retry with the same client_msg_id does not post twice", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const route = sendRoute();
      let online = false;
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": (url, init) => {
          if (!online) {
            // 届いてコミットされたが、応答が切断で失われた
            route.handler(url, init);
            throw new TypeError("Failed to fetch");
          }
          return route.handler(url, init);
        },
      });

      store.sendMessage("r1", { body: "1 通目" });
      store.sendMessage("r1", { body: "2 通目" });
      await vi.waitFor(() => expect(outgoing(store).map((m) => m.status)).toEqual(["failed", "failed"]));
      // 1 通目で止まり、2 通目は送っていない
      expect(route.sent.map((r) => r.body)).toEqual(["1 通目"]);

      online = true;
      const [first, second] = outgoing(store);
      store.retryMessage("r1", first!.clientMsgId);
      store.retryMessage("r1", second!.clientMsgId);
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));

      expect(route.sent.map((r) => r.client_msg_id)).toEqual([first!.clientMsgId, first!.clientMsgId, second!.clientMsgId]);
      expect(seqs(store)).toEqual([1, 2, 3, 4, 5]);
    });

    it("drops the pending message when message.created arrives before the response, without a duplicate", async () => {
      const route = sendRoute();
      const response = deferred();
      const { store } = await opened({
        "POST /api/v1/rooms/r1/messages": async (url, init) => {
          const res = route.handler(url, init);
          await response.promise;
          return res;
        },
      });

      store.sendMessage("r1", { body: "先にイベント" });
      await vi.waitFor(() => expect(route.sent).toHaveLength(1));
      store.applyEvent(created(mine(4, route.sent[0]!.client_msg_id, { body: "先にイベント" })));
      expect(outgoing(store)).toEqual([]);

      response.resolve(new Response());
      await vi.waitFor(() => expect(store.getSnapshot().timelines.r1?.messages).toHaveLength(4));
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
    });

    it("gives up waiting after the timeout, and still accepts a response that arrives later", async () => {
      const route = sendRoute();
      const response = deferred();
      const { store } = await opened(
        {
          "POST /api/v1/rooms/r1/messages": async (url, init) => {
            await response.promise;
            return route.handler(url, init);
          },
        },
        { sendTimeoutMs: 20 },
      );

      store.sendMessage("r1", { body: "遅い" });
      await vi.waitFor(() => expect(outgoing(store)[0]?.status).toBe("failed"));

      response.resolve(new Response());
      await vi.waitFor(() => expect(outgoing(store)).toEqual([]));
      expect(seqs(store)).toEqual([1, 2, 3, 4]);
    });

    it("forgets unsent messages when removed from a private room", async () => {
      const { store } = await opened({
        "GET /api/v1/rooms/r1": () => json(200, room("r1", "雑談", { kind: "private", last_message_seq: 3, last_read_seq: 3, last_user_seq: 3, last_read_user_seq: 3 })),
        "POST /api/v1/rooms/r1/messages": () => new Promise<Response>(() => {}),
      });
      store.sendMessage("r1", { body: "送信中" });

      store.applyEvent({ type: "room.member_removed", data: { workspace_id: "ws-1", room_id: "r1", reason: "removed" } });

      expect(store.getSnapshot().outgoing.r1).toBeUndefined();
    });

    it("applies an edit from the response", async () => {
      const { api, store } = await opened({
        "PATCH /api/v1/rooms/r1/messages/m-3": (_url, init) =>
          json(200, mine(3, "c-3", { body: body(init).body, change_seq: 4, edited_at: "2026-09-13T02:00:00Z" })),
      });

      await store.editMessage("r1", "m-3", "直しました");

      expect(store.getSnapshot().timelines.r1?.messages.at(-1)).toMatchObject({ body: "直しました", change_seq: 4 });
      expect(store.getSnapshot().timelines.r1?.changeSeq).toBe(4);
      expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    });

    it("fetches the change after deleting, since the response has no body", async () => {
      const { store } = await opened({
        "DELETE /api/v1/rooms/r1/messages/m-2": () => new Response(null, { status: 204 }),
        "GET /api/v1/rooms/r1/messages?after_change_seq=3&limit=100": () =>
          page([msg(2, { body: "", change_seq: 4, deleted_at: "2026-09-13T02:00:00Z" })], 4),
      });

      await store.deleteMessage("r1", "m-2");

      expect(store.getSnapshot().timelines.r1?.messages[1]).toMatchObject({ id: "m-2", deleted_at: "2026-09-13T02:00:00Z" });
    });

    it("throws the API error when an edit is rejected", async () => {
      const { store } = await opened({
        "PATCH /api/v1/rooms/r1/messages/m-3": () => problem(409, "message-deleted"),
      });

      await expect(store.editMessage("r1", "m-3", "x")).rejects.toMatchObject({ status: 409 });
    });
  });
});
