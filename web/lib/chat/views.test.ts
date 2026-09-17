import { describe, expect, it } from "vitest";

import type { TimelineItem } from "@/components/chat/types";
import { message, miyuki, naoki, room, roomMember } from "@/test/chat-data";

import { toRoomMemberView, toRoomSummaryView, toTimelineItems } from "./views";

const tz = "Asia/Tokyo";

/** 区切りは種類、メッセージは「本文（grouped なら +）」にして並びを比べる。 */
function outline(items: TimelineItem[]): string[] {
  return items.map((item) => {
    switch (item.type) {
      case "date":
        return `[${item.label}]`;
      case "unread":
        return "[unread]";
      case "message":
        return item.message.grouped ? `+${item.message.body}` : item.message.body;
    }
  });
}

describe("toRoomSummaryView", () => {
  const now = new Date("2026-09-13T02:00:00Z");

  it("prefixes the sender for channels", () => {
    const view = toRoomSummaryView(
      room("r1", "雑談", {
        last_message_at: "2026-09-13T01:22:00Z",
        unread_count: 3,
        last_message: { id: "m1", sender: miyuki, body: "喫茶店ができたらしい", created_at: "2026-09-13T01:22:00Z", deleted: false },
      }),
      now,
      tz,
    );

    expect(view).toMatchObject({ name: "雑談", lastMessage: "高橋 みゆき: 喫茶店ができたらしい", timeLabel: "10:22", unreadCount: 3 });
  });

  it("names a DM after the peer and omits the sender", () => {
    const view = toRoomSummaryView(
      room("r2", "", {
        kind: "dm",
        name: null,
        dm_peer: { ...naoki, online: true },
        last_message_at: "2026-09-12T01:00:00Z",
        last_message: { id: "m2", sender: naoki, body: "あとで見ます", created_at: "2026-09-12T01:00:00Z", deleted: false },
      }),
      now,
      tz,
    );

    expect(view).toMatchObject({
      name: "佐藤 直樹",
      peer: { id: naoki.id, online: true },
      lastMessage: "あとで見ます",
      timeLabel: "昨日",
    });
  });

  it("does not leak the body of a deleted last message", () => {
    const view = toRoomSummaryView(
      room("r3", "雑談", {
        last_message_at: "2026-09-13T01:00:00Z",
        last_message: { id: "m3", sender: miyuki, body: "", created_at: "2026-09-13T01:00:00Z", deleted: true },
      }),
      now,
      tz,
    );

    expect(view.lastMessage).toBe("高橋 みゆき: このメッセージは削除されました");
  });

  it("has no preview for a room without messages", () => {
    expect(toRoomSummaryView(room("r4", "新しい"), now, tz)).toMatchObject({ lastMessage: undefined, timeLabel: undefined });
  });
});

describe("toTimelineItems", () => {
  it("inserts a date divider whenever the local day changes", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "a", created_at: "2026-09-12T14:00:00Z" }), // 東京で 9/12 23:00
        message(2, { body: "b", created_at: "2026-09-12T15:30:00Z", sender: naoki }), // 9/13 00:30
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual(["[2026年9月12日]", "a", "[2026年9月13日]", "b"]);
  });

  it("groups consecutive messages from the same sender within five minutes", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "a", created_at: "2026-09-13T01:00:00Z" }),
        message(2, { body: "b", created_at: "2026-09-13T01:04:59Z" }),
        message(3, { body: "c", created_at: "2026-09-13T01:10:00Z" }),
        message(4, { body: "d", created_at: "2026-09-13T01:10:30Z", sender: naoki }),
        message(5, {
          body: "e",
          created_at: "2026-09-13T01:10:40Z",
          sender: naoki,
          reply_to: { id: "m-1", seq: 1, sender: miyuki, body: "a", deleted: false },
        }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "+b", "c", "d", "e"]);
  });

  it("puts the unread divider before the first message after the last read seq and breaks the group there", () => {
    const items = toTimelineItems([message(1, { body: "a" }), message(2, { body: "b" }), message(3, { body: "c" })], {
      unreadAfterSeq: 1,
      timeZone: tz,
    });

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "[unread]", "b", "+c"]);
  });

  it("has no unread divider when everything is read", () => {
    const items = toTimelineItems([message(1), message(2)], { unreadAfterSeq: 2, timeZone: tz });

    expect(items.some((item) => item.type === "unread")).toBe(false);
  });

  it("maps deleted, edited, replies and attachments", () => {
    const items = toTimelineItems(
      [
        message(1, { deleted_at: "2026-09-13T01:05:00Z", body: "" }),
        message(2, {
          sender: naoki,
          edited_at: "2026-09-13T01:06:00Z",
          reply_to: { id: "m-1", seq: 1, sender: miyuki, body: "", deleted: true },
          attachments: [
            { id: "a1", file_name: "mock.png", content_type: "image/png", size_bytes: 10, width: 260, height: 160 },
            { id: "a2", file_name: "scale.pdf", content_type: "application/pdf", size_bytes: 253_952, width: null, height: null },
          ],
        }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );
    const [deleted, edited] = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(deleted).toMatchObject({ key: "m-1", deleted: true, status: "sent", timeLabel: "10:00" });
    expect(edited).toMatchObject({
      edited: true,
      replyTo: { senderName: "高橋 みゆき", body: "このメッセージは削除されました" },
      attachments: [
        { kind: "image", id: "a1", fileName: "mock.png", width: 260, height: 160 },
        { kind: "file", id: "a2", fileName: "scale.pdf", sizeLabel: "248 KB" },
      ],
    });
  });
});

describe("toRoomMemberView", () => {
  it("labels the workspace role", () => {
    expect(toRoomMemberView(roomMember(naoki, { role: "owner", online: true }))).toEqual({
      id: naoki.id,
      name: "佐藤 直樹",
      online: true,
      roleLabel: "オーナー",
    });
  });
});
