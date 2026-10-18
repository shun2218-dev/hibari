import { describe, expect, it } from "vitest";
import { message, miyuki, naoki } from "@/test/chat-data";

import { toActivityItemView } from "./activity";

describe("toActivityItemView（ADR 0058）", () => {
  const tz = "Asia/Tokyo";
  const now = new Date("2026-09-22T03:00:00Z");
  const base = {
    id: "m:x",
    type: "message" as const,
    reasons: ["mention" as const],
    unread: true,
    occurred_at: "2026-09-21T14:30:00Z",
    room: { id: "r1", kind: "public" as const, name: "雑談", dm_peer: null },
    message: message(4, { id: "m-4", room_id: "r1", sender: miyuki, body: `<@${naoki.id}> 見て`, mentions: [{ kind: "user", user: naoki }] }),
    reaction: null,
  };

  it("行き先に左のメニューを残し、日付の区切りと時刻を見る人のタイムゾーンで出す", () => {
    expect(toActivityItemView(base, { workspaceId: "ws-1", now, timeZone: tz, side: "activity" })).toMatchObject({
      key: "m:x",
      href: "/w/ws-1/r/r1?m=m-4&side=activity",
      reasons: ["mention"],
      unread: true,
      room: { kind: "public", name: "雑談" },
      actor: { id: miyuki.id, name: miyuki.display_name },
      mentionNames: { [naoki.id]: naoki.display_name },
      dateLabel: "昨日",
      timeLabel: "23:30",
    });
  });

  it("リアクションは付けた人を出し、DM はルーム名の代わりに相手の名前にする。スレッドの返信はパネルも開く", () => {
    const view = toActivityItemView(
      {
        ...base,
        type: "reaction",
        reasons: ["reaction"],
        unread: false,
        room: { id: "d1", kind: "dm", name: "", dm_peer: naoki },
        message: message(5, { id: "m-5", room_id: "d1", sender: naoki, thread_root_id: "m-1", thread_seq: 2 }),
        reaction: { emoji: "👍", user: miyuki },
      },
      { workspaceId: "ws-1", now, timeZone: tz },
    );
    expect(view).toMatchObject({
      href: "/w/ws-1/r/d1?m=m-5&t=m-1",
      actor: { id: miyuki.id },
      reactionEmoji: "👍",
      room: { kind: "dm", name: naoki.display_name },
    });
  });
});
