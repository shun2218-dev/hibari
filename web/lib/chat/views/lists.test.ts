import { describe, expect, it } from "vitest";
import { toActivityItemView, toPinnedMessageView, toSavedItemView } from "@/lib/chat/views/lists";
import { systemMessageText } from "@/lib/chat/views/message";
import { toTimelineItems } from "@/lib/chat/views/timeline";
import { message, miyuki, naoki, savedItem, systemMessage } from "@/test/chat-data";
import { png, tz } from "@/test/views";

describe("ピン留め（ADR 0054）", () => {
  const pin = { by: { id: naoki.id, handle: "naoki", display_name: "佐藤 直樹" }, at: "2026-09-22T01:00:00Z" };

  it("still reads a pin log written before the decision was changed (ADR 0054 決定 3 の追記)", () => {
    const log = systemMessage(3, { type: "message_pinned", message_id: "m-1" }, { sender: miyuki });

    expect(systemMessageText(log)).toBe("高橋 みゆき がこのチャンネルにメッセージをピン留めしました");
  });

  it("marks who pinned a message on the message itself", () => {
    const items = toTimelineItems([message(1, { pinned: pin }), message(2)], { unreadAfterSeq: null, timeZone: tz });
    const messages = items.flatMap((i) => (i.type === "message" ? [i.message] : []));

    expect(messages.map((m) => m.pinnedBy)).toEqual(["佐藤 直樹", undefined]);
  });

  it("makes a pin card that jumps to the message (and its thread)", () => {
    const view = toPinnedMessageView(message(2, { thread_root_id: "m-1", pinned: pin, attachments: [png] }), {
      workspaceId: "ws-1",
      now: new Date("2026-09-22T12:00:00Z"),
      timeZone: tz,
    });

    expect(view).toMatchObject({ key: "m-2", href: "/w/ws-1/r/room-1?m=m-2&t=m-1", attachmentCount: 1, inThread: true });
  });
});

describe("「後で」（ADR 0054）", () => {
  it("makes a row that jumps to the saved message, naming the DM by the peer", () => {
    const item = savedItem(2, {
      room: { id: "room-1", kind: "dm", name: "", dm_peer: miyuki },
      message: message(2, { thread_root_id: "m-1", attachments: [png] }),
    });

    expect(toSavedItemView(item, { now: new Date("2026-09-22T12:00:00Z"), timeZone: tz })).toMatchObject({
      key: "m-2",
      status: "ok",
      href: "/w/ws-1/r/room-1?m=m-2&t=m-1",
      room: { kind: "dm", name: "高橋 みゆき" },
      attachmentCount: 1,
    });
  });

  it("does not tell unreadable and deleted apart", () => {
    const view = toSavedItemView(savedItem(2, { status: "unavailable", room: null, message: null }));

    expect(view).toEqual({ key: "m-2", status: "unavailable" });
  });
});

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
