import { describe, expect, it } from "vitest";
import type { RoomNotifications } from "@/lib/api/types.gen";
import { toRoomSummaryView } from "@/lib/chat/views/rooms";
import { miyuki, naoki, room } from "@/test/chat-data";
import { tz } from "@/test/views";

describe("toRoomSummaryView", () => {
  const now = new Date("2026-09-13T02:00:00Z");

  it("prefixes the sender for channels", () => {
    const view = toRoomSummaryView(
      room("r1", "雑談", {
        last_message_at: "2026-09-13T01:22:00Z",
        unread_count: 3,
        last_message: { id: "m1", sender: miyuki, kind: "user", body: "喫茶店ができたらしい", created_at: "2026-09-13T01:22:00Z", deleted: false },
      }),
      now,
      { timeZone: tz },
    );

    expect(view).toMatchObject({ name: "雑談", lastMessage: "高橋 みゆき: 喫茶店ができたらしい", timeLabel: "10:22", unreadCount: 3 });
  });

  it("ミュートを、期限と比べてから muted にする（ADR 0055）", () => {
    const muted = (notifications: RoomNotifications | null) =>
      toRoomSummaryView(room("r1", "雑談", { notifications }), now, { timeZone: tz }).muted;

    expect(muted({ level: null, muted: true, muted_until: null })).toBe(true);
    expect(muted({ level: null, muted: true, muted_until: "2026-09-13T03:00:00Z" })).toBe(true);
    // 期限の来たミュートは、ストアのタイマーが戻す前でも薄くしない
    expect(muted({ level: null, muted: true, muted_until: "2026-09-13T01:00:00Z" })).toBe(false);
    // 参加していない public ルームは設定を持たない
    expect(muted(null)).toBe(false);
  });

  it("names a DM after the peer and omits the sender", () => {
    const view = toRoomSummaryView(
      room("r2", "", {
        kind: "dm",
        name: null,
        dm_peer: { ...naoki, presence: "active" },
        last_message_at: "2026-09-12T01:00:00Z",
        last_message: { id: "m2", sender: naoki, kind: "user", body: "あとで見ます", created_at: "2026-09-12T01:00:00Z", deleted: false },
      }),
      now,
      { timeZone: tz, avatarUrls: { [naoki.id]: "https://storage.test/naoki.png" } },
    );

    expect(view).toMatchObject({
      name: "佐藤 直樹",
      peer: { id: naoki.id, presence: "online", avatarUrl: "https://storage.test/naoki.png" },
      lastMessage: "あとで見ます",
      timeLabel: "昨日",
    });
  });

  it("does not leak the body of a deleted last message", () => {
    const view = toRoomSummaryView(
      room("r3", "雑談", {
        last_message_at: "2026-09-13T01:00:00Z",
        last_message: { id: "m3", sender: miyuki, kind: "user", body: "", created_at: "2026-09-13T01:00:00Z", deleted: true },
      }),
      now,
      { timeZone: tz },
    );

    expect(view.lastMessage).toBe("高橋 みゆき: このメッセージは削除されました");
  });

  it("shows a placeholder for a message with only attachments", () => {
    const view = toRoomSummaryView(
      room("r5", "雑談", {
        last_message_at: "2026-09-13T01:00:00Z",
        last_message: { id: "m5", sender: miyuki, kind: "user", body: "", created_at: "2026-09-13T01:00:00Z", deleted: false },
      }),
      now,
      { timeZone: tz },
    );

    expect(view.lastMessage).toBe("高橋 みゆき: 添付ファイル");
  });

  it("has no preview for a room without messages", () => {
    expect(toRoomSummaryView(room("r4", "新しい"), now, { timeZone: tz })).toMatchObject({ lastMessage: undefined, timeLabel: undefined });
  });
});
