import { describe, expect, it } from "vitest";

import type { ActivityItem } from "@/lib/api/types.gen";
import { message, miyuki, room } from "@/test/chat-data";

import {
  activityListKey,
  applyRoomReadToActivity,
  applyThreadReadToActivity,
  belongsTo,
  insertActivity,
  messageActivityItem,
  parseActivityListKey,
  removeActivity,
} from "./activity-feed";

function item(id: string, occurredAt: string, overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id,
    type: "message",
    reasons: ["mention"],
    unread: true,
    occurred_at: occurredAt,
    room: { id: "r1", kind: "public", name: "雑談", dm_peer: null },
    message: message(1, { id: id.replace("m:", ""), room_id: "r1" }),
    reaction: null,
    ...overrides,
  };
}

describe("activity-feed（ADR 0058）", () => {
  it("一覧の組をキーにして、戻せる", () => {
    expect(parseActivityListKey(activityListKey("mention", true))).toEqual({ filter: "mention", unreadOnly: true });
    expect(parseActivityListKey(activityListKey("all", false))).toEqual({ filter: "all", unreadOnly: false });
  });

  it("タブは理由で、「未読メッセージ」は未読で絞る", () => {
    const read = item("m:1", "2026-09-13T01:00:00Z", { unread: false, reasons: ["dm", "mention"] });
    expect(belongsTo(read, "all", false)).toBe(true);
    expect(belongsTo(read, "dm", false)).toBe(true);
    expect(belongsTo(read, "thread", false)).toBe(false);
    expect(belongsTo(read, "all", true)).toBe(false);
  });

  it("新しい順の位置に足し、同じメッセージは置き換える（手元の id とサーバーの id が違っても）", () => {
    const list = [item("m:c", "2026-09-13T03:00:00Z"), item("m:a", "2026-09-13T01:00:00Z")];
    const middle = item("m:b", "2026-09-13T02:00:00Z");
    expect(insertActivity(list, middle).map((i) => i.id)).toEqual(["m:c", "m:b", "m:a"]);

    // サーバーの 1 件（m:<uuid>）と、届いたメッセージから作った 1 件（m:<ULID>）は、メッセージの ID で同じものとみなす
    const fromEvent = { ...item("m:a", "2026-09-13T01:00:00Z"), id: "m:other-form", unread: false };
    const replaced = insertActivity(list, fromEvent);
    expect(replaced).toHaveLength(2);
    expect(replaced[1]).toMatchObject({ id: "m:other-form", unread: false });
  });

  it("届いたメッセージの 1 件は、ルームを LinkedRoom の形にする", () => {
    const dm = room("d1", "", { kind: "dm", name: null, dm_peer: { ...miyuki, presence: "active" } });
    const got = messageActivityItem(message(3, { id: "m-3", room_id: "d1" }), dm, ["dm"], true);
    expect(got).toMatchObject({ id: "m:m-3", type: "message", room: { id: "d1", kind: "dm", name: "", dm_peer: { id: miyuki.id } } });
  });

  it("ルームの既読はチャンネルに出たものだけ、スレッドの既読はスレッドだけの返信だけに当てる", () => {
    const channel = item("m:1", "2026-09-13T01:00:00Z", { message: message(1, { id: "1", room_id: "r1", user_seq: 5 }) });
    const reply = item("m:2", "2026-09-13T02:00:00Z", {
      message: message(2, { id: "2", room_id: "r1", user_seq: 5, thread_root_id: "root", thread_seq: 3 }),
    });
    const list = [reply, channel];

    const roomRead = applyRoomReadToActivity(list, "r1", 5);
    expect(roomRead.map((i) => i.unread)).toEqual([true, false]);
    expect(applyThreadReadToActivity(roomRead, "root", 3).map((i) => i.unread)).toEqual([false, false]);
    // 変わらなければ同じ配列
    expect(applyRoomReadToActivity(list, "r1", 4)).toBe(list);
  });

  it("外すものがなければ同じ配列を返す", () => {
    const list = [item("m:1", "2026-09-13T01:00:00Z")];
    expect(removeActivity(list, (i) => i.id === "m:x")).toBe(list);
    expect(removeActivity(list, (i) => i.id === "m:1")).toEqual([]);
  });
});
