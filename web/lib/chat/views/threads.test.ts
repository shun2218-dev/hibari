import { describe, expect, it } from "vitest";
import { alsoInChannelDoneLabel, alsoInChannelLabel } from "@/lib/chat/views/rooms";
import { toThreadListItemView, toThreadTimelineItems } from "@/lib/chat/views/threads";
import { toTimelineItems } from "@/lib/chat/views/timeline";
import { message, miyuki, naoki } from "@/test/chat-data";
import { outline, tz } from "@/test/views";

describe("threads (ADR 0036)", () => {
  const thread = { reply_count: 2, last_thread_seq: 3, last_reply_at: "2026-09-13T02:30:00Z" };

  it("shows the reply count under a root only while it has replies", () => {
    const items = toTimelineItems(
      [message(1, { thread }), message(2, { thread: { ...thread, reply_count: 0 } }), message(3)],
      { unreadAfterSeq: null, timeZone: tz, now: new Date("2026-09-13T03:00:00Z") },
    );
    const [withReplies, allDeleted, plain] = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(withReplies!.thread).toEqual({ replyCount: 2, lastReplyLabel: "11:30" });
    expect(allDeleted!.thread).toBeUndefined();
    expect(plain!.thread).toBeUndefined();
  });

  it("keeps my unsent thread replies out of the channel", () => {
    const items = toTimelineItems([message(1)], {
      unreadAfterSeq: null,
      me: naoki,
      outgoing: [{ clientMsgId: "c-t", body: "スレッドへ", threadRootId: "m-1", alsoInChannel: false, attachments: [], status: "pending", createdAt: "2026-09-13T01:01:00Z" }],
      timeZone: tz,
      now: new Date("2026-09-24T03:00:00Z"),
    });

    expect(outline(items)).toEqual(["[9月13日]", "本文 1"]);
  });

  it("lays out the thread panel as root, divider, replies and my unsent replies, without dates or the root's summary", () => {
    const root = message(1, { thread, body: "親" });
    const replies = [
      message(2, { body: "返信 1", thread_root_id: "m-1", thread_seq: 1, created_at: "2026-09-14T01:00:00Z" }),
      message(4, { body: "返信 2", thread_root_id: "m-1", thread_seq: 2, created_at: "2026-09-14T01:01:00Z" }),
    ];
    const items = toThreadTimelineItems(
      { root, replies },
      {
        me: naoki,
        outgoing: [
          { clientMsgId: "c-t", body: "送信中の返信", threadRootId: "m-1", alsoInChannel: false, attachments: [], status: "pending", createdAt: "2026-09-14T01:02:00Z" },
          { clientMsgId: "c-c", body: "チャンネルへ", threadRootId: null, alsoInChannel: false, attachments: [], status: "pending", createdAt: "2026-09-14T01:02:00Z" },
        ],
        timeZone: tz,
      },
    );

    expect(outline(items)).toEqual(["親", "[2 replies]", "返信 1", "+返信 2", "送信中の返信"]);
    expect(items[0]!.type === "message" && items[0].message.thread).toBeUndefined();
    expect(toThreadTimelineItems({ root: null, replies }, { timeZone: tz })).toEqual([]);
  });

  it("names the channel checkbox and the note by the room kind (ADR 0039)", () => {
    expect(alsoInChannelLabel("public")).toBe("チャンネルにも投稿する");
    expect(alsoInChannelLabel("private")).toBe("チャンネルにも投稿する");
    expect(alsoInChannelLabel("dm")).toBe("DM にも投稿する");
    expect(alsoInChannelDoneLabel("public")).toBe("チャンネルにも投稿しました");
    expect(alsoInChannelDoneLabel("dm")).toBe("DM にも投稿しました");
  });

  it("maps a followed thread to a list row, naming a dm by the peer", () => {
    const view = toThreadListItemView(
      {
        room: { id: "d1", kind: "dm", name: null, dm_peer: naoki },
        root: { id: "m-1", sender: miyuki, kind: "user", body: "親", created_at: "2026-09-12T01:00:00Z", deleted: false },
        root_seq: 1,
        reply_count: 3,
        last_reply_at: "2026-09-13T02:30:00Z",
        last_thread_seq: 3,
        last_read_thread_seq: 1,
        unread_count: 2,
        notify_replies: true,
        mention_count: 0,
      },
      new Date("2026-09-13T03:00:00Z"),
      { timeZone: tz, memberNames: { [naoki.id]: "佐藤 直樹" } },
    );

    expect(view.root.mentionNames).toEqual({ [naoki.id]: "佐藤 直樹" });
    expect(view).toMatchObject({
      key: "m-1",
      room: { kind: "dm", name: "佐藤 直樹" },
      root: { sender: { id: miyuki.id, name: "高橋 みゆき" }, timeLabel: "昨日", body: "親", deleted: false },
      replyCount: 3,
      lastReplyLabel: "11:30",
      unreadCount: 2,
    });
  });
});
