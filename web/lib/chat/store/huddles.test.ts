import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoomHuddle } from "@/lib/api/types.gen";
import { miyuki, naoki, room } from "@/test/chat-data";
import { setup } from "@/test/chat-store";
import { json } from "@/test/fake-api";

import { newerHuddle } from "./huddles";
import { HUDDLE_RING_MS } from "./state";

function huddle(version: number, userIds: string[], id = "h-1"): RoomHuddle {
  return {
    id,
    room_id: "r1",
    message_id: "m-1",
    started_at: "2026-09-26T02:20:00Z",
    version,
    participants: userIds.map((user_id) => ({ user_id, muted: false })),
    joining_soon: [],
  };
}

async function withRoom(overrides = {}) {
  const t = setup({ "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談", overrides)] }) });
  await t.store.loadRooms("ws-1");
  return t;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("newerHuddle（ADR 0066 決定 13）", () => {
  it("同じハドルは版が新しいときだけ受け入れ、終わり（null）と別のハドルは受け入れる", () => {
    const current = huddle(3, [miyuki.id]);
    expect(newerHuddle(current, huddle(2, []))).toBe(current);
    expect(newerHuddle(current, huddle(3, []))).toBe(current);
    expect(newerHuddle(current, huddle(4, []))).toEqual(huddle(4, []));
    expect(newerHuddle(current, null)).toBeNull();
    expect(newerHuddle(current, huddle(1, [], "h-2"))).toEqual(huddle(1, [], "h-2"));
    expect(newerHuddle(null, huddle(1, []))).toEqual(huddle(1, []));
  });
});

describe("huddle.updated", () => {
  it("ルームのハドルを更新し、古い版は捨てる", async () => {
    const { store } = await withRoom();

    store.applyEvent({ type: "huddle.updated", data: { room_id: "r1", huddle: huddle(2, [miyuki.id]) } });
    store.applyEvent({ type: "huddle.updated", data: { room_id: "r1", huddle: huddle(1, []) } });
    expect(store.getSnapshot().rooms.r1?.huddle?.version).toBe(2);

    store.applyEvent({ type: "huddle.updated", data: { room_id: "r1", huddle: null } });
    expect(store.getSnapshot().rooms.r1?.huddle).toBeNull();
  });
});

describe("huddle.ringing（ADR 0066 決定 11）", () => {
  const ringing = { type: "huddle.ringing" as const, data: { room_id: "r1", huddle_id: "h-1", caller_id: miyuki.id } };

  it("呼び出しを出し、60 秒で止める", async () => {
    vi.useFakeTimers();
    const { store } = await withRoom({ kind: "dm" });

    store.applyEvent(ringing);
    expect(store.getSnapshot().huddleRing).toEqual({ roomId: "r1", huddleId: "h-1", callerId: miyuki.id });

    vi.advanceTimersByTime(HUDDLE_RING_MS);
    expect(store.getSnapshot().huddleRing).toBeNull();
  });

  it("ミュートした DM では呼び出さない", async () => {
    const { store } = await withRoom({ kind: "dm", notifications: { level: null, muted: true, muted_until: null } });

    store.applyEvent(ringing);
    expect(store.getSnapshot().huddleRing).toBeNull();
  });

  it("自分が入った（別の端末を含む）・ハドルが終わったら止める", async () => {
    const { store } = await withRoom({ kind: "dm" });

    store.applyEvent(ringing);
    store.applyEvent({ type: "huddle.updated", data: { room_id: "r1", huddle: huddle(2, [miyuki.id]) } });
    expect(store.getSnapshot().huddleRing).not.toBeNull();
    store.applyEvent({ type: "huddle.updated", data: { room_id: "r1", huddle: huddle(3, [miyuki.id, naoki.id]) } });
    expect(store.getSnapshot().huddleRing).toBeNull();

    store.applyEvent(ringing);
    store.applyEvent({ type: "huddle.updated", data: { room_id: "r1", huddle: null } });
    expect(store.getSnapshot().huddleRing).toBeNull();
  });

  it("「もうすぐ参加する」は呼び出しを止めて、サーバーに知らせる", async () => {
    const t = setup({
      "GET /api/v1/workspaces/ws-1/rooms": () => json(200, { rooms: [room("r1", "雑談", { kind: "dm" })] }),
      "POST /api/v1/huddles/h-1/joining-soon": () => new Response(null, { status: 204 }),
    });
    await t.store.loadRooms("ws-1");

    t.store.applyEvent(ringing);
    await t.store.huddleJoiningSoon("h-1");

    expect(t.store.getSnapshot().huddleRing).toBeNull();
    expect(t.api.paths()).toContain("POST /api/v1/huddles/h-1/joining-soon");
  });
});
