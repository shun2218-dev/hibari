import { describe, expect, it } from "vitest";

import type { TimelineItem } from "@/components/chat/types";
import type { MessageAttachment } from "@/lib/api/types.gen";
import { kei, member, message, miyuki, naoki, room, roomMember, systemMessage } from "@/test/chat-data";

import {
  messageActions,
  previewImageIds,
  toAttachmentDraftView,
  systemMessageText,
  toDmCandidates,
  toRoomMemberRows,
  toRoomMemberView,
  toRoomSummaryView,
  toThreadListItemView,
  toThreadTimelineItems,
  toTimelineItems,
} from "./views";

const tz = "Asia/Tokyo";

/** 区切りは種類、メッセージは「本文（grouped なら +）」にして並びを比べる。 */
function outline(items: TimelineItem[]): string[] {
  return items.map((item) => {
    switch (item.type) {
      case "date":
        return `[${item.label}]`;
      case "unread":
        return "[unread]";
      case "system":
        return `[system: ${item.text}]`;
      case "thread-divider":
        return `[${item.replyCount} replies]`;
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
        last_message: { id: "m1", sender: miyuki, kind: "user", body: "喫茶店ができたらしい", created_at: "2026-09-13T01:22:00Z", deleted: false },
      }),
      now,
      { timeZone: tz },
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
        last_message: { id: "m2", sender: naoki, kind: "user", body: "あとで見ます", created_at: "2026-09-12T01:00:00Z", deleted: false },
      }),
      now,
      { timeZone: tz, avatarUrls: { [naoki.id]: "https://storage.test/naoki.png" } },
    );

    expect(view).toMatchObject({
      name: "佐藤 直樹",
      peer: { id: naoki.id, online: true, avatarUrl: "https://storage.test/naoki.png" },
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

const png: MessageAttachment = {
  id: "a1",
  file_name: "mock.png",
  content_type: "image/png",
  size_bytes: 10,
  width: 260,
  height: 160,
};
const pdf: MessageAttachment = {
  id: "a2",
  file_name: "scale.pdf",
  content_type: "application/pdf",
  size_bytes: 253_952,
  width: null,
  height: null,
};

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
        message(5, { body: "e", created_at: "2026-09-13T01:10:40Z", sender: naoki }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "+b", "c", "d", "+e"]);
  });

  it("leaves thread replies out of the channel timeline (ADR 0036)", () => {
    const items = toTimelineItems(
      [
        message(1, { body: "親" }),
        message(2, { body: "返信", thread_root_id: "m-1", thread_seq: 1 }),
        message(3, { body: "チャンネル", sender: naoki }),
      ],
      { unreadAfterSeq: 1, timeZone: tz },
    );

    // 返信（seq 2）は出さず、未読の区切りは次のチャンネルの発言の前に出す
    expect(outline(items)).toEqual(["[2026年9月13日]", "親", "[unread]", "チャンネル"]);
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

  it("fills in the avatar and image urls that have been loaded", () => {
    const items = toTimelineItems(
      [
        message(1, { attachments: [png, { ...png, id: "a3" }, { ...png, id: "a4", content_type: "image/svg+xml" }] }),
        message(2, { sender: naoki }),
      ],
      {
        unreadAfterSeq: null,
        avatarUrls: { [miyuki.id]: "https://storage.test/miyuki.png", [naoki.id]: null },
        attachmentUrls: { a1: "https://storage.test/a1", a3: null },
        timeZone: tz,
      },
    );
    const [first, second] = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(first.sender.avatarUrl).toBe("https://storage.test/miyuki.png");
    expect(second.sender.avatarUrl).toBeUndefined();
    // SVG はブラウザで開かせない（ADR 0013）ので、ファイルとして出す
    expect(first.attachments).toEqual([
      expect.objectContaining({ kind: "image", id: "a1", url: "https://storage.test/a1" }),
      expect.objectContaining({ kind: "image", id: "a3", url: undefined }),
      expect.objectContaining({ kind: "file", id: "a4" }),
    ]);
  });

  it("maps deleted, edited and attachments", () => {
    const items = toTimelineItems(
      [
        message(1, { deleted_at: "2026-09-13T01:05:00Z", body: "" }),
        message(2, {
          sender: naoki,
          edited_at: "2026-09-13T01:06:00Z",
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
      attachments: [
        { kind: "image", id: "a1", fileName: "mock.png", width: 260, height: 160 },
        { kind: "file", id: "a2", fileName: "scale.pdf", sizeLabel: "248 KB" },
      ],
    });
  });

  it("appends my unconfirmed messages after the confirmed ones, grouped with my last message", () => {
    const items = toTimelineItems([message(1, { body: "a", sender: naoki }), message(2, { body: "b" })], {
      unreadAfterSeq: 1,
      me: naoki,
      outgoing: [
        {
          clientMsgId: "c-x",
          body: "送信中",
          threadRootId: null,
          attachments: [pdf],
          status: "pending",
          createdAt: "2026-09-13T01:01:00Z",
        },
        {
          clientMsgId: "c-y",
          body: "失敗",
          threadRootId: null,
          attachments: [],
          status: "failed",
          createdAt: "2026-09-13T01:02:00Z",
        },
      ],
      timeZone: tz,
    });
    const messages = items.flatMap((item) => (item.type === "message" ? [item.message] : []));

    expect(outline(items)).toEqual(["[2026年9月13日]", "a", "[unread]", "b", "送信中", "+失敗"]);
    expect(messages[2]).toMatchObject({
      key: "c-x",
      status: "pending",
      sender: { id: naoki.id },
      timeLabel: "10:01",
      attachments: [{ kind: "file", id: "a2", fileName: "scale.pdf" }],
    });
    expect(messages[3]).toMatchObject({ key: "c-y", status: "failed" });
  });
});

describe("previewImageIds", () => {
  it("lists the images of messages that are not deleted", () => {
    expect(
      previewImageIds([
        message(1, { attachments: [png, pdf] }),
        message(2, { attachments: [{ ...png, id: "a5" }], deleted_at: "2026-09-13T01:00:00Z" }),
        message(3, { attachments: [{ ...png, id: "a6", content_type: "image/jpeg" }] }),
      ]),
    ).toEqual(["a1", "a6"]);
  });
});

describe("toAttachmentDraftView", () => {
  const file = new File(["x".repeat(2048)], "サイドバー改訂.fig");
  const base = { key: "draft-1", file, fileName: file.name, progress: 0, attachment: null };

  it("maps each upload status", () => {
    expect(toAttachmentDraftView({ ...base, status: "uploading", progress: 62 })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "uploading",
      progress: 62,
    });
    expect(toAttachmentDraftView({ ...base, status: "failed" })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "failed",
    });
    expect(toAttachmentDraftView({ ...base, status: "uploaded", progress: 100, attachment: pdf })).toEqual({
      id: "draft-1",
      fileName: "サイドバー改訂.fig",
      status: "uploaded",
      sizeLabel: "2 KB",
    });
  });
});

describe("toRoomMemberView", () => {
  it("labels the workspace role", () => {
    expect(
      toRoomMemberView(roomMember(naoki, { role: "owner", online: true }), { [naoki.id]: "https://storage.test/n" }),
    ).toEqual({
      id: naoki.id,
      name: "佐藤 直樹",
      avatarUrl: "https://storage.test/n",
      online: true,
      roleLabel: "オーナー",
    });
  });
});

describe("messageActions", () => {
  const channel = room("r1", "雑談");
  const base = { userId: naoki.id, room: channel, myRole: "member" as const, senderRole: undefined };

  it("lets me edit and delete my own messages while I can post", () => {
    expect(messageActions(message(1, { sender: naoki }), base)).toEqual({ canEdit: true, canDelete: true });
    expect(messageActions(message(1, { sender: naoki }), { ...base, room: { ...channel, is_member: false } })).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });

  it("lets admins and above delete messages of lower roles, but never edit them", () => {
    const theirs = message(1, { sender: miyuki });
    expect(messageActions(theirs, base)).toEqual({ canEdit: false, canDelete: false });
    expect(messageActions(theirs, { ...base, myRole: "admin" })).toEqual({ canEdit: false, canDelete: true });
    expect(messageActions(theirs, { ...base, myRole: "admin", senderRole: "admin" }).canDelete).toBe(false);
    expect(messageActions(theirs, { ...base, myRole: "owner", senderRole: "admin" }).canDelete).toBe(true);
    // 相手のロールが分からなければ出し、サーバーに判断させる
    expect(messageActions(theirs, { ...base, myRole: "admin", senderRole: undefined }).canDelete).toBe(true);
  });

  it("does not moderate DMs or deleted messages", () => {
    const dm = room("d1", "", { kind: "dm" });
    expect(messageActions(message(1, { sender: miyuki }), { ...base, room: dm, myRole: "owner" }).canDelete).toBe(false);
    expect(messageActions(message(1, { sender: naoki, deleted_at: "2026-09-13T01:00:00Z" }), base)).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });
});

describe("toDmCandidates", () => {
  const members = [
    member(naoki, { role: "owner", online: true }),
    member(miyuki),
    member(kei, { online: true }),
  ];

  it("leaves out the viewer and anyone already in the room", () => {
    expect(toDmCandidates(members, { userId: naoki.id, exclude: [kei.id] })).toEqual([
      { id: miyuki.id, name: miyuki.display_name, handle: miyuki.handle, online: false },
    ]);
  });

  it("filters by display name or handle", () => {
    expect(toDmCandidates(members, { userId: naoki.id, search: "みゆき" }).map((c) => c.id)).toEqual([miyuki.id]);
    expect(toDmCandidates(members, { userId: naoki.id, search: "KEI" }).map((c) => c.id)).toEqual([kei.id]);
    expect(toDmCandidates(members, { userId: naoki.id, search: "いない人" })).toEqual([]);
  });
});

describe("toRoomMemberRows", () => {
  it("lets admins remove members below them, but never themselves", () => {
    const rows = toRoomMemberRows([roomMember(naoki, { role: "admin" }), roomMember(miyuki), roomMember(kei, { role: "admin" })], {
      userId: naoki.id,
      myRole: "admin",
    });

    expect(rows.map((r) => [r.id, r.isSelf, r.canRemove])).toEqual([
      [naoki.id, true, false],
      [miyuki.id, false, true],
      // 同じロールの人は外せない（authz.CanManage）
      [kei.id, false, false],
    ]);
  });

  it("offers nothing to a member", () => {
    const rows = toRoomMemberRows([roomMember(miyuki)], { userId: naoki.id, myRole: "member" });

    expect(rows[0].canRemove).toBe(false);
  });
});

describe("システムメッセージ（ADR 0033）", () => {
  it("writes each kind of log with the subject first", () => {
    const by = (system: Parameters<typeof systemMessage>[1]) =>
      systemMessageText(systemMessage(2, system, { sender: miyuki }));

    expect(by({ type: "room_created" })).toBe("高橋 みゆき がこのチャンネルを作成しました");
    expect(by({ type: "member_joined" })).toBe("高橋 みゆき がチャンネルに参加しました");
    expect(by({ type: "member_left" })).toBe("高橋 みゆき がチャンネルを退出しました");
    expect(by({ type: "member_removed" })).toBe("高橋 みゆき がチャンネルから外されました");
    expect(by({ type: "room_renamed", old_name: "雑談", new_name: "雑談 改" })).toBe(
      "高橋 みゆき がチャンネル名を 雑談 から 雑談 改 に変更しました",
    );
  });

  it("puts the log between messages without grouping them", () => {
    const items = toTimelineItems(
      [
        message(1, { sender: miyuki, body: "おはよう" }),
        systemMessage(2, { type: "member_joined" }, { sender: naoki }),
        message(3, { sender: miyuki, body: "今日もよろしく" }),
      ],
      { unreadAfterSeq: null, timeZone: tz },
    );

    expect(outline(items)).toEqual([
      "[2026年9月13日]",
      "おはよう",
      "[system: 佐藤 直樹 がチャンネルに参加しました]",
      // ログを挟んだので、同じ人の発言でも続けて表示（+）にしない
      "今日もよろしく",
    ]);
  });

  it("does not put the unread divider before a log", () => {
    const items = toTimelineItems(
      [
        message(1, { sender: miyuki, body: "既読の発言" }),
        systemMessage(2, { type: "member_joined" }, { sender: naoki }),
        message(3, { sender: miyuki, body: "未読の発言" }),
      ],
      { unreadAfterSeq: 1, timeZone: tz },
    );

    // 区切りはログを飛ばして、未読の「人の発言」の前に出す
    expect(outline(items)).toEqual([
      "[2026年9月13日]",
      "既読の発言",
      "[system: 佐藤 直樹 がチャンネルに参加しました]",
      "[unread]",
      "未読の発言",
    ]);
  });

  it("does not show the divider when only logs are new", () => {
    const items = toTimelineItems(
      [message(1, { sender: miyuki, body: "既読の発言" }), systemMessage(2, { type: "member_joined" })],
      { unreadAfterSeq: 1, timeZone: tz },
    );

    expect(outline(items)).not.toContain("[unread]");
  });

  it("shows the log itself in the sidebar, without the sender prefix", () => {
    const view = toRoomSummaryView(
      room("r1", "雑談", {
        last_message_at: "2026-09-13T01:22:00Z",
        last_message: {
          id: "m2",
          sender: naoki,
          kind: "system",
          system: { type: "member_joined" },
          body: "",
          created_at: "2026-09-13T01:22:00Z",
          deleted: false,
        },
      }),
      new Date("2026-09-13T02:00:00Z"),
      { timeZone: tz },
    );

    expect(view.lastMessage).toBe("佐藤 直樹 がチャンネルに参加しました");
  });
});

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
      outgoing: [{ clientMsgId: "c-t", body: "スレッドへ", threadRootId: "m-1", attachments: [], status: "pending", createdAt: "2026-09-13T01:01:00Z" }],
      timeZone: tz,
    });

    expect(outline(items)).toEqual(["[2026年9月13日]", "本文 1"]);
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
          { clientMsgId: "c-t", body: "送信中の返信", threadRootId: "m-1", attachments: [], status: "pending", createdAt: "2026-09-14T01:02:00Z" },
          { clientMsgId: "c-c", body: "チャンネルへ", threadRootId: null, attachments: [], status: "pending", createdAt: "2026-09-14T01:02:00Z" },
        ],
        timeZone: tz,
      },
    );

    expect(outline(items)).toEqual(["親", "[2 replies]", "返信 1", "+返信 2", "送信中の返信"]);
    expect(items[0]!.type === "message" && items[0].message.thread).toBeUndefined();
    expect(toThreadTimelineItems({ root: null, replies }, { timeZone: tz })).toEqual([]);
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
      },
      new Date("2026-09-13T03:00:00Z"),
      { timeZone: tz },
    );

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

