import { describe, expect, it, vi } from "vitest";

import { message, miyuki, naoki, room } from "@/test/chat-data";
import { setup } from "@/test/chat-store";
import { type Handler, json } from "@/test/fake-api";

describe("アクティビティ（ADR 0058）", () => {
  const design = room("r1", "デザインレビュー", { last_user_seq: 2, last_read_user_seq: 2 });
  const mention = { mentions: [{ kind: "user" as const, user: naoki }] };
  const page = (items: unknown[], next: string | null = null) => json(200, { items, next_cursor: next, has_more: next !== null });
  const listed = (seq: number, overrides: Record<string, unknown> = {}) => ({
    id: `m:${seq}`,
    type: "message",
    reasons: ["mention"],
    unread: true,
    occurred_at: `2026-09-13T01:0${seq}:00Z`,
    room: { id: "r1", kind: "public", name: "デザインレビュー", dm_peer: null },
    message: message(seq, { id: `m-${seq}`, room_id: "r1", ...mention }),
    reaction: null,
    ...overrides,
  });

  function activityStore(routes: Record<string, Handler> = {}) {
    const env = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [design] }),
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50": () => page([listed(2)]),
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50&unread=true": () => page([listed(2)]),
      "GET /api/v1/workspaces/ws-1/activity/unread_count": () => json(200, { count: 1 }),
      ...routes,
    });
    return env;
  }

  const items = (store: ReturnType<typeof setup>["store"], key = "all:all") =>
    store.getSnapshot().activity["ws-1"]?.lists[key]?.items.map((i) => i.message.id);

  it("自分宛てのメンションが届いたら先頭に足し、未読の件数を 1 つ増やす（同じメッセージは 1 回だけ）", async () => {
    const { store } = activityStore();
    await store.loadRooms("ws-1");
    await Promise.all([store.loadActivity("ws-1", "all", false), store.loadActivityUnreadCount("ws-1")]);

    const created = message(3, { id: "m-3", room_id: "r1", user_seq: 3, created_at: "2026-09-13T01:09:00Z", ...mention });
    store.applyEvent({ type: "message.created", data: created });
    store.applyEvent({ type: "message.created", data: created });

    expect(items(store)).toEqual(["m-3", "m-2"]);
    expect(store.getSnapshot().activity["ws-1"]?.lists["all:all"]?.items[0]).toMatchObject({ reasons: ["mention"], unread: true });
    expect(store.getSnapshot().activity["ws-1"]?.unreadCount).toBe(2);
  });

  it("規則に当たらない投稿と、自分の投稿は足さない", async () => {
    const { store } = activityStore();
    await store.loadRooms("ws-1");
    await store.loadActivity("ws-1", "all", false);

    store.applyEvent({ type: "message.created", data: message(3, { id: "m-3", room_id: "r1" }) });
    store.applyEvent({ type: "message.created", data: message(4, { id: "m-4", room_id: "r1", sender: naoki, ...mention }) });

    expect(items(store)).toEqual(["m-2"]);
  });

  it("ルームを読むと 1 件を既読にし、「未読メッセージ」の一覧からは外して、件数を取り直す", async () => {
    let count = 1;
    const { store, requests } = activityStore({
      "GET /api/v1/workspaces/ws-1/activity/unread_count": () => json(200, { count }),
    });
    await store.loadRooms("ws-1");
    await Promise.all([
      store.loadActivity("ws-1", "all", false),
      store.loadActivity("ws-1", "all", true),
      store.loadActivityUnreadCount("ws-1"),
    ]);

    count = 0;
    store.applyEvent({
      type: "room.read",
      data: { workspace_id: "ws-1", room_id: "r1", last_read_seq: 2, last_read_user_seq: 2, unread_count: 0, mention_count: 0 },
    });

    expect(store.getSnapshot().activity["ws-1"]?.lists["all:all"]?.items[0]?.unread).toBe(false);
    expect(items(store, "all:unread")).toEqual([]);
    await vi.waitFor(() => expect(store.getSnapshot().activity["ws-1"]?.unreadCount).toBe(0));
    expect(requests().filter((p) => p.endsWith("/activity/unread_count"))).toHaveLength(2);
  });

  it("削除されたメッセージは外す", async () => {
    const { store } = activityStore();
    await store.loadRooms("ws-1");
    await store.loadActivity("ws-1", "all", false);

    store.applyEvent({ type: "message.deleted", data: message(2, { id: "m-2", room_id: "r1", deleted_at: "2026-09-13T02:00:00Z" }) });

    expect(items(store)).toEqual([]);
  });

  it("自分のメッセージへのリアクションを足し・外す（リアクションのタブにも、未読の一覧には入れない）", async () => {
    const { store } = activityStore({
      "GET /api/v1/workspaces/ws-1/activity?filter=reaction&limit=50": () => page([]),
    });
    await store.loadRooms("ws-1");
    await Promise.all([
      store.loadActivity("ws-1", "all", false),
      store.loadActivity("ws-1", "reaction", false),
      store.loadActivity("ws-1", "all", true),
    ]);
    const reacted = listed(5, {
      id: "r:m-5:u:👍",
      type: "reaction",
      reasons: ["reaction"],
      unread: false,
      occurred_at: "2026-09-13T01:09:00Z",
      message: message(5, { id: "m-5", room_id: "r1", sender: naoki }),
      reaction: { emoji: "👍", user: miyuki },
    });

    store.applyEvent({ type: "activity.reaction_added", data: { workspace_id: "ws-1", item: reacted as never } });
    expect(items(store)).toEqual(["m-5", "m-2"]);
    expect(items(store, "reaction:all")).toEqual(["m-5"]);
    expect(items(store, "all:unread")).toEqual(["m-2"]);

    store.applyEvent({ type: "activity.reaction_removed", data: { workspace_id: "ws-1", id: "r:m-5:u:👍" } });
    expect(items(store)).toEqual(["m-2"]);
  });

  it("通知の設定が変わったら、読み込んでいる一覧と件数を取り直す（そのときの設定で当てはめるため）", async () => {
    const { store, requests } = activityStore();
    await store.loadRooms("ws-1");
    await Promise.all([store.loadActivity("ws-1", "all", false), store.loadActivityUnreadCount("ws-1")]);

    store.applyEvent({
      type: "room.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", level: null, muted: true, muted_until: null },
    });

    await vi.waitFor(() =>
      expect(requests().filter((p) => p === "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50")).toHaveLength(2),
    );
    expect(requests().filter((p) => p.endsWith("/activity/unread_count"))).toHaveLength(2);
  });

  it("続きを取ると、前のページの next_cursor を before に渡して後ろに足す", async () => {
    const { store, requests } = activityStore({
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50": () => page([listed(3)], "c1"),
      "GET /api/v1/workspaces/ws-1/activity?filter=all&limit=50&before=c1": () => page([listed(2)]),
    });
    await store.loadActivity("ws-1", "all", false);

    await store.loadMoreActivity("ws-1", "all", false);
    await store.loadMoreActivity("ws-1", "all", false);

    expect(items(store)).toEqual(["m-3", "m-2"]);
    expect(requests().filter((p) => p.includes("before="))).toHaveLength(1);
  });
});
