import { describe, expect, it } from "vitest";

import { systemMessageText } from "@/lib/chat/views/message";
import { toTimelineItems } from "@/lib/chat/views/timeline";
import { message, miyuki, naoki, systemMessage } from "@/test/chat-data";
import { png, tz } from "@/test/views";
import { toPinnedMessageView } from "./pins";

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
