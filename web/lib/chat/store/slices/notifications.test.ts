import { afterEach, describe, expect, it, vi } from "vitest";

import { room } from "@/test/chat-data";
import { setup, body } from "@/test/chat-store";
import { json, problem } from "@/test/fake-api";

describe("ミュートと通知の設定（ADR 0055）", () => {
  const T0 = Date.parse("2026-09-22T09:00:00Z");
  const notifications = (overrides = {}) => ({ level: null, muted: false, muted_until: null, ...overrides });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("room.notifications_updated を、ルームの本体に当てる（別のタブで変えた）", async () => {
    const { store } = setup({ "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }) });
    await store.loadRooms("ws-1");

    store.applyEvent({
      type: "room.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", level: "all", muted: true, muted_until: null },
    });

    expect(store.getSnapshot().rooms.r1?.notifications).toEqual({ level: "all", muted: true, muted_until: null });
  });

  it("notifications.updated で、そのワークスペースの全体の設定を置き換える", () => {
    const { store } = setup({});

    store.applyEvent({ type: "notifications.updated", data: { workspace_id: "ws-1", level: "none" } });

    expect(store.getSnapshot().notificationLevels["ws-1"]).toBe("none");
  });

  it("ルームの設定は全部の値で PUT し、応答で上書きする", async () => {
    let sent: unknown;
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "PUT /api/v1/rooms/r1/me/notifications": (_url, init) => {
        sent = body(init);
        return json(200, { level: "mentions", muted: true, muted_until: null });
      },
    });
    await store.loadRooms("ws-1");

    await store.setRoomNotifications("r1", notifications({ level: "mentions", muted: true }));

    expect(sent).toEqual({ level: "mentions", muted: true, muted_until: null });
    expect(store.getSnapshot().rooms.r1?.notifications).toEqual({ level: "mentions", muted: true, muted_until: null });
  });

  it("失敗したら元に戻して投げる", async () => {
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談")] }),
      "PUT /api/v1/rooms/r1/me/notifications": () => problem(403, "forbidden"),
      "PUT /api/v1/workspaces/ws-1/me/notifications": () => problem(500, "internal"),
    });
    await store.loadRooms("ws-1");

    await expect(store.setRoomNotifications("r1", notifications({ muted: true }))).rejects.toThrow();
    await expect(store.setNotificationLevel("ws-1", "all")).rejects.toThrow();

    expect(store.getSnapshot().rooms.r1?.notifications).toEqual(notifications());
    expect(store.getSnapshot().notificationLevels["ws-1"]).toBeUndefined();
  });

  it("一時的なミュートは、期限が来たら再読み込みなしで戻る（6.14a の DoD）", async () => {
    vi.useFakeTimers({ now: T0 });
    const until = new Date(T0 + 60 * 60 * 1000).toISOString();
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, {
          rooms: [
            room("r1", "雑談", { notifications: notifications({ muted: true, muted_until: until }) }),
            // 期限なしのミュートは、時間がたっても戻らない
            room("r2", "リリース", { notifications: notifications({ muted: true }) }),
          ],
        }),
    });
    await store.loadRooms("ws-1");
    const listener = vi.fn();
    store.subscribe(listener);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
    expect(store.getSnapshot().rooms.r1?.notifications?.muted).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot().rooms.r1?.notifications).toEqual(notifications());
    expect(store.getSnapshot().rooms.r2?.notifications?.muted).toBe(true);
    // 描き直しのきっかけになる（サイドバーの薄い表示が戻る）
    expect(listener).toHaveBeenCalled();
    store.dispose();
  });

  it("期限を延ばしたら、前のタイマーでは戻さない", async () => {
    vi.useFakeTimers({ now: T0 });
    const hour = 60 * 60 * 1000;
    const { store } = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () =>
        json(200, { rooms: [room("r1", "雑談", { notifications: notifications({ muted: true, muted_until: new Date(T0 + hour).toISOString() }) })] }),
    });
    await store.loadRooms("ws-1");

    store.applyEvent({
      type: "room.notifications_updated",
      data: { workspace_id: "ws-1", room_id: "r1", level: null, muted: true, muted_until: new Date(T0 + 3 * hour).toISOString() },
    });
    await vi.advanceTimersByTimeAsync(2 * hour);

    expect(store.getSnapshot().rooms.r1?.notifications?.muted).toBe(true);
    await vi.advanceTimersByTimeAsync(hour);
    expect(store.getSnapshot().rooms.r1?.notifications?.muted).toBe(false);
    store.dispose();
  });
});
