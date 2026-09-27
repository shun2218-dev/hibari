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

describe("「後で」に保存したハドルのメッセージ（ADR 0067 決定 6）", () => {
  it("送り主と本文の代わりに、会話と同じ見出しと所要時間を出す", () => {
    const huddleMessage = message(3, {
      kind: "system",
      body: "",
      sender: miyuki,
      system: { type: "huddle", huddle_id: "h-1" },
      huddle: { id: "h-1", started_at: "2026-09-26T02:00:00Z", ended_at: "2026-09-26T02:38:00Z", participant_ids: [miyuki.id] },
    });
    const view = toSavedItemView(savedItem(3, { message: huddleMessage }), { memberNames: { [miyuki.id]: miyuki.display_name } });

    expect(view).toMatchObject({
      status: "ok",
      huddle: { title: "ハドルミーティングは終了しました", detail: `38 分 · ${miyuki.display_name}が 1 人で参加しました` },
    });
  });
});
