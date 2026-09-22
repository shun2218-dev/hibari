import { afterEach, describe, expect, it, vi } from "vitest";

import { createSession } from "@/lib/auth/session";
import { type Handler, TEST_API_BASE, fakeApi, json, tokens } from "@/test/fake-api";

import { createChatApi } from "@/lib/chat/api/chat-api";
import { createLinkCardStore } from "./link-cards";

const ROOM = "01J9ZQZQZQZQZQZQZQZQZQZQZB";
const ROOM2 = "01J9ZQZQZQZQZQZQZQZQZQZQZE";
const MSG = "01J9ZQZQZQZQZQZQZQZQZQZQZC";
const MSG2 = "01J9ZQZQZQZQZQZQZQZQZQZQZD";

function setup(routes: Record<string, Handler>) {
  const api = fakeApi({ "POST /api/v1/auth/refresh": () => tokens("at-1"), ...routes });
  const session = createSession({ baseUrl: TEST_API_BASE, fetch: api.fetch });
  const store = createLinkCardStore(createChatApi(session.request));
  return { api, store, requests: () => api.calls.filter((c) => !c.path.includes("/auth/")) };
}

function ok(roomId: string, messageId: string) {
  return {
    room_id: roomId,
    message_id: messageId,
    status: "ok",
    workspace: { id: "01J9ZQZQZQZQZQZQZQZQZQZQZA", name: "山と印刷" },
    room: { id: roomId, kind: "public", name: "雑談", dm_peer: null },
    message: {
      id: messageId,
      seq: 1,
      sender: { id: "u1", handle: "naoki", display_name: "佐藤 直樹" },
      body: "元の発言",
      thread_root_id: null,
      attachment_count: 0,
      created_at: "2026-09-19T00:00:00Z",
      edited_at: null,
      deleted_at: null,
    },
  };
}

function unavailable(roomId: string, messageId: string) {
  return { room_id: roomId, message_id: messageId, status: "unavailable", workspace: null, room: null, message: null };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLinkCardStore", () => {
  it("同じ描画で頼まれたリンクを 1 回のリクエストにまとめる", async () => {
    const { store, requests } = setup({
      "POST /api/v1/messages/links": () => json(200, { links: [ok(ROOM, MSG), unavailable(ROOM, MSG2)] }),
    });

    store.request([{ roomId: ROOM, messageId: MSG }]);
    store.request([{ roomId: ROOM, messageId: MSG2 }]);

    await vi.waitFor(() => expect(Object.keys(store.getSnapshot())).toHaveLength(2));
    expect(requests()).toHaveLength(1);
    expect(JSON.parse(requests()[0]!.init.body as string)).toEqual({
      links: [
        { room_id: ROOM, message_id: MSG },
        { room_id: ROOM, message_id: MSG2 },
      ],
    });
  });

  it("同じリンクを二度取りにいかない（カードは追従しない。ADR 0040）", async () => {
    const { store, requests } = setup({
      "POST /api/v1/messages/links": () => json(200, { links: [ok(ROOM, MSG)] }),
    });

    store.request([{ roomId: ROOM, messageId: MSG }]);
    await vi.waitFor(() => expect(store.getSnapshot()[`${ROOM}/${MSG}`]).toBeDefined());

    // 取れたあとに何度頼まれても、取り直さない
    store.request([{ roomId: ROOM, messageId: MSG }]);
    store.request([{ roomId: ROOM, messageId: MSG }]);
    await Promise.resolve();

    expect(requests()).toHaveLength(1);
  });

  it("取れた結果は、返ってきた ID で引き当てる（送った順に頼らない）", async () => {
    const { store } = setup({
      // わざと逆順で返す
      "POST /api/v1/messages/links": () => json(200, { links: [unavailable(ROOM2, MSG2), ok(ROOM, MSG)] }),
    });

    store.request([
      { roomId: ROOM, messageId: MSG },
      { roomId: ROOM2, messageId: MSG2 },
    ]);

    await vi.waitFor(() => expect(Object.keys(store.getSnapshot())).toHaveLength(2));
    expect(store.getSnapshot()[`${ROOM}/${MSG}`]?.status).toBe("ok");
    expect(store.getSnapshot()[`${ROOM2}/${MSG2}`]?.status).toBe("unavailable");
  });

  it("ルームとメッセージの組で覚える（同じメッセージ ID でもルームが違えば別に取る）", async () => {
    const { store, requests } = setup({
      "POST /api/v1/messages/links": () => json(200, { links: [ok(ROOM, MSG)] }),
    });

    store.request([{ roomId: ROOM, messageId: MSG }]);
    await vi.waitFor(() => expect(requests()).toHaveLength(1));

    store.request([{ roomId: ROOM2, messageId: MSG }]);
    await vi.waitFor(() => expect(requests()).toHaveLength(2));
  });

  it("上限（20 件）を超えたら、リクエストを分ける", async () => {
    const { store, requests } = setup({ "POST /api/v1/messages/links": () => json(200, { links: [] }) });

    store.request(
      Array.from({ length: 25 }, (_, i) => ({ roomId: ROOM, messageId: `01J9ZQZQZQZQZQZQZQZQZQZ${String(i).padStart(3, "0")}` })),
    );

    await vi.waitFor(() => expect(requests()).toHaveLength(2));
    const sizes = requests().map((c) => JSON.parse(c.init.body as string).links.length);
    expect(sizes).toEqual([20, 5]);
  });

  it("失敗しても本文は読めるので、カードを出さないままにする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = setup({ "POST /api/v1/messages/links": () => json(500, { title: "internal" }) });

    store.request([{ roomId: ROOM, messageId: MSG }]);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());

    expect(store.getSnapshot()[`${ROOM}/${MSG}`]).toBeUndefined();
  });

  it("購読している人に、取れたことを知らせる", async () => {
    const { store } = setup({ "POST /api/v1/messages/links": () => json(200, { links: [ok(ROOM, MSG)] }) });
    const listener = vi.fn();
    store.subscribe(listener);

    store.request([{ roomId: ROOM, messageId: MSG }]);

    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
  });
});
