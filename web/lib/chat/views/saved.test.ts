import { describe, expect, it } from "vitest";
import { message, miyuki, savedItem } from "@/test/chat-data";
import { png, tz } from "@/test/views";
import { toSavedItemView } from "./saved";

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
